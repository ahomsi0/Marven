import { useState, useRef, useCallback } from "react";
import type { AgentEvent, ToolCallState, AIProvider, AgentMessage, MCPServer, ImageAttachment, Mention } from "@/types";

const SUMMARIZE_THRESHOLD = 30; // auto-summarize when thread exceeds this many messages
const KEEP_RECENT = 10; // always keep this many recent messages uncompressed

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
}: UseAgentStreamOptions) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveTerminalOutput, setLiveTerminalOutput] = useState<string>("");
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const planPendingCallIdRef = useRef<string | null>(null);
  const planModeOverrideRef = useRef<boolean | null>(null);

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
    opts?: { attachments?: ImageAttachment[]; mentions?: Mention[] },
  ) => {
    const attachments = opts?.attachments;
    const mentions = opts?.mentions;
    if (!prompt.trim() || isRunning) return;
    setError(null);
    setIsRunning(true);

    const userMsg: AgentMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: prompt,
      ...(attachments?.length ? { attachments } : {}),
    };
    addMessage(userMsg);

    const assistantMsg: AgentMessage = {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: "",
      toolCalls: [],
    };
    addMessage(assistantMsg);

    // Auto-summarize if thread is too long
    let activeMessages = messages; // the messages list at the time of send

    if (messages.length > SUMMARIZE_THRESHOLD && workspaceRoot && provider && model) {
      const oldMessages = messages.slice(0, messages.length - KEEP_RECENT);
      const recentMessages = messages.slice(messages.length - KEEP_RECENT);

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
          const summaryMsg: AgentMessage = {
            id: `summary-${Date.now()}`,
            role: "assistant",
            content: summary,
            isSummary: true,
          };
          // Replace old messages with summary in state
          const condensed = [summaryMsg, ...recentMessages];
          setMessages(condensed);
          activeMessages = condensed;
        }
      } catch {
        // On failure, continue without summarizing
      }
    }

    const history = activeMessages
      .map((m) => ({
        role: m.role,
        content: m.content || (m.toolCalls?.length
          ? `[Used tools: ${m.toolCalls.map((tc) => tc.tool).join(", ")}]`
          : ""),
      }))
      .filter((m) => m.content);

    const abort = new AbortController();
    abortRef.current = abort;

    // Consume a one-shot planMode override (used when re-triggering after plan approval)
    const effectivePlanMode = planModeOverrideRef.current !== null ? planModeOverrideRef.current : (planMode ?? false);
    planModeOverrideRef.current = null;
    const callIdToTool = new Map<string, string>();
    let wroteFiles = false;
    let streamHadError = false;

    try {
      const res = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, history, provider, model, workspaceRoot, conversationId, memory, mcpServers: (mcpServers ?? []).filter((s) => s.enabled), requireWriteApproval: requireWriteApproval ?? false, planMode: effectivePlanMode, attachments: attachments ?? [], liteAgentMode, mentions: mentions ?? [] }),
        signal: abort.signal,
      });
      if (!res.ok) {
        throw new Error(await res.text().catch(() => `Agent request failed (${res.status})`));
      }
      await consumeSse(res, async (event) => {
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
          updateLastAssistant((msg) => ({
            ...msg,
            content: msg.content + event.delta,
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
        !abort.signal.aborted &&
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
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, messages, provider, model, workspaceRoot, conversationId, memory, mcpServers, planMode, liteAgentMode, consumeSse, autoVerifyCommands, autoVerifyEnabled, parseCommandList]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  // Used when switching between agent conversations — restores the full
  // message thread of the conversation we're switching to.
  const loadMessages = useCallback((next: AgentMessage[]) => {
    setMessages(next);
    setError(null);
    setLiveTerminalOutput("");
    setCheckpoints([]);
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
