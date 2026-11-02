import { useState, useRef, useCallback, useEffect } from "react";
import type { AgentEvent, ToolCallState, AIProvider, AgentMessage, MCPServer, ImageAttachment, Mention, TokenUsage, AgentSafetyProfile } from "@/types";
import {
  buildWireHistory,
  cancelInFlightToolCalls,
  condenseWindow,
  SWITCH_CANCEL_NOTE,
} from "@/lib/agent/thread";

const STOP_CANCEL_NOTE = "Stopped before this finished.";

interface UseAgentStreamOptions {
  provider: AIProvider;
  model: string;
  workspaceRoot: string | null;
  conversationId?: string | null;
  memory?: string;
  mcpServers?: MCPServer[];
  requireWriteApproval?: boolean;
  planMode?: boolean;
  liteAgentMode?: boolean;
  autoVerifyEnabled?: boolean;
  autoVerifyCommands?: string;
  safetyProfile?: AgentSafetyProfile;
  onUsage?: (usage: TokenUsage) => void;
}

export function useAgentStream({
  provider,
  model,
  workspaceRoot,
  conversationId,
  memory,
  mcpServers,
  requireWriteApproval,
  planMode,
  liteAgentMode,
  autoVerifyEnabled,
  autoVerifyCommands,
  safetyProfile,
  onUsage,
}: UseAgentStreamOptions) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveTerminalOutput, setLiveTerminalOutput] = useState<string>("");
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // Synchronous double-send guard — state updates don't re-render before a
  // second invoke of send() would read stale `isRunning`.
  const isRunningRef = useRef(false);
  // Bumped whenever a stream starts or the message thread is replaced, so
  // event handlers belonging to a superseded stream become no-ops instead of
  // writing into whatever conversation is now loaded.
  const streamGenRef = useRef(0);
  const planPendingCallIdRef = useRef<string | null>(null);
  const planModeOverrideRef = useRef<boolean | null>(null);
  // Latest committed thread, readable from stable callbacks (loadMessages
  // needs the outgoing thread at switch time). loadMessages/clearMessages also
  // set it synchronously so a send() in the same tick sees the new thread.
  const messagesRef = useRef<AgentMessage[]>(messages);
  messagesRef.current = messages;

  const addMessage = (msg: AgentMessage) =>
    setMessages((prev) => [...prev, msg]);

  const updateLastAssistant = (updater: (msg: AgentMessage) => AgentMessage) =>
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          next[i] = updater(next[i]);
          break;
        }
      }
      return next;
    });

  const parseCommandList = useCallback((raw: string | undefined): string[] => {
    return (raw ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }, []);

  const estimateTokens = useCallback((text: string): number => {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return Math.max(1, Math.ceil(trimmed.length / 4));
  }, []);

  const consumeSse = useCallback(async (
    res: Response,
    onEvent: (event: AgentEvent) => void | Promise<void>,
  ) => {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const dec = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";

      for (const part of parts) {
        const lines = part.trim().split("\n");
        let eventType = "";
        let dataLine = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) eventType = line.slice(7);
          if (line.startsWith("data: ")) dataLine = line.slice(6);
        }
        if (!eventType || !dataLine) continue;

        let event: AgentEvent;
        try { event = JSON.parse(dataLine); } catch { continue; }
        await onEvent(event);
      }
    }
  }, []);

  const send = useCallback(async (
    prompt: string,
    opts?: {
      attachments?: ImageAttachment[];
      mentions?: Mention[];
      /**
       * The exact thread this turn continues. Pass it when the caller has
       * just replaced the thread (e.g. editing a message truncates it) — the
       * replacement may not have rendered yet, so without this the turn
       * would be built on the previous, untruncated thread.
       */
      baseMessages?: AgentMessage[];
    },
  ) => {
    const attachments = opts?.attachments;
    const mentions = opts?.mentions;
    if (!prompt.trim() || isRunningRef.current) return;
    isRunningRef.current = true;
    const gen = ++streamGenRef.current;
    setError(null);
    setIsRunning(true);

    const userMsg: AgentMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: prompt,
      ...(attachments?.length ? { attachments } : {}),
    };
    const assistantMsg: AgentMessage = {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: "",
      toolCalls: [],
    };

    // Read the thread from the ref, not a render closure: loadMessages()
    // updates the ref synchronously, so a send in the same tick sees it.
    const base = opts?.baseMessages ?? messagesRef.current;
    const threadWithTurn: AgentMessage[] = [...base, userMsg, assistantMsg];
    if (opts?.baseMessages) {
      // Make the visible thread exactly base + this turn.
      setMessages(threadWithTurn);
    } else {
      addMessage(userMsg);
      addMessage(assistantMsg);
    }
    messagesRef.current = threadWithTurn;
    let activeMessages = threadWithTurn;

    // Condense only the thread this turn is actually built on.
    const condense = workspaceRoot && provider && model ? condenseWindow(threadWithTurn) : null;
    if (condense) {
      const { oldMessages, recentMessages } = condense;

      try {
        const summarizeRes = await fetch("/api/agent/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: oldMessages
              .filter((m) => !m.isSummary)
              .map((m) => ({
                role: m.role,
                content: m.content || (m.toolCalls?.length
                  ? `[Used tools: ${m.toolCalls.map((tc) => tc.tool).join(", ")}]`
                  : ""),
              }))
              .filter((m) => m.content),
            provider,
            model,
          }),
        });

        if (summarizeRes.ok) {
          const { summary } = await summarizeRes.json();
          const trimmedSummary = typeof summary === "string" ? summary.trim() : "";
          // An empty summary (e.g. the provider rate-limited us and the route
          // returned "") would silently truncate the thread to the recent
          // window — skip condensation instead of persisting that loss.
          if (trimmedSummary) {
            const summaryMsg: AgentMessage = {
              id: `summary-${Date.now()}`,
              role: "assistant",
              content: trimmedSummary,
              isSummary: true,
            };
            // Replace old messages with summary in state — unless the thread
            // was swapped (conversation switch / stop) while summarizing.
            const condensed = [summaryMsg, ...recentMessages];
            if (gen === streamGenRef.current) {
              setMessages(condensed);
              messagesRef.current = condensed;
            }
            activeMessages = condensed;
          }
        }
      } catch {
        // On failure, continue without summarizing
      }
      // Stopped or switched away while summarizing: don't start a stream
      // nobody will read (stop/loadMessages already reset the running flags).
      if (gen !== streamGenRef.current) return;
    }

    // History for the wire excludes the current turn — the stream route
    // appends `prompt` itself, so including userMsg here would duplicate it.
    // (assistantMsg is empty and filtered below regardless.)
    const history = buildWireHistory(activeMessages);

    const abort = new AbortController();
    abortRef.current = abort;
    // True once this stream has been superseded (conversation switched,
    // stopped) or aborted — late events must not touch the now-active thread.
    const staleStream = () => gen !== streamGenRef.current || abort.signal.aborted;

    // Consume a one-shot planMode override (used when re-triggering after plan approval)
    const effectivePlanMode = planModeOverrideRef.current !== null ? planModeOverrideRef.current : (planMode ?? false);
    planModeOverrideRef.current = null;
    const callIdToTool = new Map<string, string>();
    let wroteFiles = false;
    let streamHadError = false;
    let completionChars = 0;
    const promptEstimate = estimateTokens([
      memory ?? "",
      prompt,
      ...history.map((entry) => entry.content),
    ].join("\n"));

    try {
      const res = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, history, provider, model, workspaceRoot, conversationId, memory, mcpServers: (mcpServers ?? []).filter((s) => s.enabled), requireWriteApproval: requireWriteApproval ?? false, planMode: effectivePlanMode, attachments: attachments ?? [], liteAgentMode, safetyProfile, mentions: mentions ?? [] }),
        signal: abort.signal,
      });
      if (!res.ok) {
        throw new Error(await res.text().catch(() => `Agent request failed (${res.status})`));
      }
      await consumeSse(res, async (event) => {
        if (staleStream()) return;
        if (event.type === "tool_call") {
          callIdToTool.set(event.callId, event.tool);
          updateLastAssistant((msg) => ({
            ...msg,
            toolCalls: [
              ...(msg.toolCalls ?? []),
              {
                callId: event.callId,
                tool: event.tool,
                args: event.args,
                status: "running" as const,
              },
            ],
          }));
          return;
        }

        if (event.type === "tool_result") {
          const tool = callIdToTool.get(event.callId);
          if (tool === "write_file" || tool === "apply_patch") wroteFiles = true;
          setLiveTerminalOutput("");
          completionChars += event.output.length;
          updateLastAssistant((msg) => ({
            ...msg,
            toolCalls: (msg.toolCalls ?? []).map((tc) => {
              if (tc.callId !== event.callId) return tc;
              const nextStatus: ToolCallState["status"] =
                tc.status === "awaiting_approval" ? "rejected" : "done";
              return { ...tc, status: nextStatus, output: event.output };
            }),
          }));
          return;
        }

        if (event.type === "tool_progress") {
          setLiveTerminalOutput((prev) => {
            const next = prev + event.chunk;
            const lines = next.split("\n");
            if (lines.length > 500) return lines.slice(-500).join("\n");
            return next;
          });
          updateLastAssistant((msg) => ({
            ...msg,
            toolCalls: (msg.toolCalls ?? []).map((tc) =>
              tc.callId === event.callId
                ? { ...tc, liveOutput: (tc.liveOutput ?? "") + event.chunk }
                : tc
            ),
          }));
          return;
        }

        if (event.type === "pending_approval") {
          if (event.tool === "__plan__") {
            planPendingCallIdRef.current = event.callId;
            updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: [
                ...(msg.toolCalls ?? []),
                {
                  callId: event.callId,
                  tool: "__plan__",
                  args: event.args,
                  status: "awaiting_approval" as const,
                },
              ],
            }));
          } else {
            updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: (msg.toolCalls ?? []).map((tc) =>
                tc.callId === event.callId
                  ? { ...tc, status: "awaiting_approval" as const, ...(event.preview ? { preview: event.preview } : {}) }
                  : tc
              ),
            }));
          }
          return;
        }

        if (event.type === "checkpoint") {
          setCheckpoints((prev) => prev.includes(event.path) ? prev : [...prev, event.path]);
          return;
        }

        if (event.type === "text_delta") {
          completionChars += event.delta.length;
          updateLastAssistant((msg) => ({
            ...msg,
            content: msg.content + event.delta,
          }));
          return;
        }

        if (event.type === "model_fallback") {
          const note = `\n\n> ⚡ ${event.from} was unavailable (${event.reason}) — continuing with **${event.to}**.\n`;
          completionChars += note.length;
          updateLastAssistant((msg) => ({
            ...msg,
            content: msg.content + note,
          }));
          return;
        }

        if (event.type === "error") {
          streamHadError = true;
          setError(event.message);
          updateLastAssistant((msg) => ({
            ...msg,
            toolCalls: (msg.toolCalls ?? []).map((tc) =>
              tc.status === "running" ? { ...tc, status: "error" as const } : tc
            ),
          }));
        }
      });

      const verifyCommands = parseCommandList(autoVerifyCommands);
      if (
        !staleStream() &&
        !streamHadError &&
        wroteFiles &&
        autoVerifyEnabled &&
        workspaceRoot
      ) {
        addMessage({
          id: `verify-${Date.now()}`,
          role: "assistant",
          content: "",
          toolCalls: [],
        });

        const verifyRes = await fetch("/api/agent/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceRoot,
            commands: verifyCommands,
          }),
          signal: abort.signal,
        });
        if (!verifyRes.ok) {
          throw new Error(await verifyRes.text().catch(() => `Verify request failed (${verifyRes.status})`));
        }

        await consumeSse(verifyRes, async (event) => {
          if (staleStream()) return;
          if (event.type === "tool_call") {
            updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: [
                ...(msg.toolCalls ?? []),
                {
                  callId: event.callId,
                  tool: event.tool,
                  args: event.args,
                  status: "running" as const,
                },
              ],
            }));
            return;
          }

          if (event.type === "tool_progress") {
            setLiveTerminalOutput((prev) => {
              const next = prev + event.chunk;
              const lines = next.split("\n");
              if (lines.length > 500) return lines.slice(-500).join("\n");
              return next;
            });
            updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: (msg.toolCalls ?? []).map((tc) =>
                tc.callId === event.callId
                  ? { ...tc, liveOutput: (tc.liveOutput ?? "") + event.chunk }
                  : tc
              ),
            }));
            return;
          }

          if (event.type === "tool_result") {
            setLiveTerminalOutput("");
            completionChars += event.output.length;
            updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: (msg.toolCalls ?? []).map((tc) =>
                tc.callId === event.callId
                  ? { ...tc, status: "done" as const, output: event.output }
                  : tc
              ),
            }));
            return;
          }

          if (event.type === "text_delta") {
            completionChars += event.delta.length;
            updateLastAssistant((msg) => ({
              ...msg,
              content: msg.content + event.delta,
            }));
            return;
          }

          if (event.type === "error") {
            setError(event.message);
            updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: (msg.toolCalls ?? []).map((tc) =>
                tc.status === "running" ? { ...tc, status: "error" as const } : tc
              ),
            }));
          }
        });
      }

      const completionEstimate = Math.max(0, Math.ceil(completionChars / 4));
      onUsage?.({
        promptTokens: promptEstimate,
        completionTokens: completionEstimate,
        totalTokens: promptEstimate + completionEstimate,
        source: "estimated",
      });
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      // Only the current stream owns the running flags: a superseded one
      // (stop / conversation switch already reset them) must not clear the
      // flags of a newer run that started meanwhile.
      if (gen === streamGenRef.current) {
        isRunningRef.current = false;
        setIsRunning(false);
      }
    }
  }, [provider, model, workspaceRoot, conversationId, memory, mcpServers, planMode, liteAgentMode, safetyProfile, consumeSse, autoVerifyCommands, autoVerifyEnabled, parseCommandList, estimateTokens, onUsage]);

  const stop = useCallback(() => {
    const wasRunning = isRunningRef.current;
    streamGenRef.current++;
    abortRef.current?.abort();
    isRunningRef.current = false;
    setIsRunning(false);
    // The aborted stream's handlers are now no-ops, so nothing else would ever
    // move its in-flight tool calls out of "running".
    if (wasRunning) {
      setMessages((prev) => cancelInFlightToolCalls(prev, STOP_CANCEL_NOTE));
    }
  }, []);

  // Abort any in-flight stream if the consuming component unmounts, so the
  // fetch/SSE reader doesn't keep running and calling setState after teardown.
  useEffect(() => () => abortRef.current?.abort(), []);

  const clearMessages = useCallback(() => {
    messagesRef.current = [];
    setMessages([]);
    setError(null);
  }, []);

  // Used when switching between agent conversations — aborts any in-flight
  // stream first (bumping the generation so its queued handlers no-op) and
  // restores the full message thread of the conversation we're switching to.
  //
  // Returns the OUTGOING thread when a run was aborted by this call, with its
  // in-flight tool calls marked cancelled, so the caller can save it to the
  // outgoing conversation (otherwise the partial output would be lost and the
  // tool calls saved as "running" forever). Returns null when nothing was
  // running.
  const loadMessages = useCallback((next: AgentMessage[]): AgentMessage[] | null => {
    const outgoing = isRunningRef.current
      ? cancelInFlightToolCalls(messagesRef.current, SWITCH_CANCEL_NOTE)
      : null;
    streamGenRef.current++;
    abortRef.current?.abort();
    isRunningRef.current = false;
    setIsRunning(false);
    messagesRef.current = next;
    setMessages(next);
    setError(null);
    setLiveTerminalOutput("");
    setCheckpoints([]);
    return outgoing;
  }, []);

  const injectAssistantMessage = useCallback((content: string) => {
    const msg: AgentMessage = {
      id: `sys-${Date.now()}`,
      role: "assistant",
      content,
      toolCalls: [],
    };
    setMessages((prev) => [...prev, msg]);
  }, []);

  const approve = useCallback(async (callId: string, accept: boolean) => {
    // Plan approvals are handled client-side — no HTTP round-trip needed
    if (planPendingCallIdRef.current === callId) {
      planPendingCallIdRef.current = null;
      updateLastAssistant((msg) => ({
        ...msg,
        toolCalls: (msg.toolCalls ?? []).map((tc) =>
          tc.callId === callId
            ? { ...tc, status: accept ? ("done" as const) : ("rejected" as const) }
            : tc
        ),
      }));
      if (!accept) return;
      // Re-trigger the agent with planMode=false so it executes instead of planning
      planModeOverrideRef.current = false;
      await send("Plan approved. Please proceed with execution step by step.");
      return;
    }

    const res = await fetch("/api/agent/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId, accept }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error("[approve] failed:", res.status, data);
    }
  }, [send]);

  return {
    messages, isRunning, error, send, stop, clearMessages, loadMessages, injectAssistantMessage,
    liveTerminalOutput, checkpoints, approve,
  };
}
