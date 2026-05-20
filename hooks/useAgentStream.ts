import { useState, useRef, useCallback } from "react";
import type { AgentEvent, ToolCallState, AIProvider, AgentMessage, MCPServer, ImageAttachment } from "@/types";

interface UseAgentStreamOptions {
  provider: AIProvider;
  model: string;
  workspaceRoot: string | null;
  memory?: string;
  mcpServers?: MCPServer[];
  requireWriteApproval?: boolean;
  planMode?: boolean;
}

export function useAgentStream({ provider, model, workspaceRoot, memory, mcpServers, requireWriteApproval, planMode }: UseAgentStreamOptions) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveTerminalOutput, setLiveTerminalOutput] = useState<string>("");
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

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

  const send = useCallback(async (prompt: string, attachments?: ImageAttachment[]) => {
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

    const history = messages
      .map((m) => ({
        role: m.role,
        content: m.content || (m.toolCalls?.length
          ? `[Used tools: ${m.toolCalls.map((tc) => tc.tool).join(", ")}]`
          : ""),
      }))
      .filter((m) => m.content);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, history, provider, model, workspaceRoot, memory, mcpServers: (mcpServers ?? []).filter((s) => s.enabled), requireWriteApproval: requireWriteApproval ?? false, planMode: planMode ?? false, attachments: attachments ?? [] }),
        signal: abort.signal,
      });

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
          }

          if (event.type === "tool_result") {
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
          }

          if (event.type === "pending_approval") {
            if (event.tool === "__plan__") {
              // Plan approval: no prior tool_call was emitted — insert the entry now
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
          }

          if (event.type === "checkpoint") {
            setCheckpoints((prev) => prev.includes(event.path) ? prev : [...prev, event.path]);
          }

          if (event.type === "text_delta") {
            updateLastAssistant((msg) => ({
              ...msg,
              content: msg.content + event.delta,
            }));
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
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, messages, provider, model, workspaceRoot, memory, mcpServers, planMode]);

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
    await fetch("/api/agent/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId, accept }),
    });
  }, []);

  return {
    messages, isRunning, error, send, stop, clearMessages, loadMessages, injectAssistantMessage,
    liveTerminalOutput, checkpoints, approve,
  };
}
