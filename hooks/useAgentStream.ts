import { useState, useRef, useCallback } from "react";
import type { AgentEvent, ToolCallState, AIProvider, AgentMessage, MCPServer } from "@/types";

interface UseAgentStreamOptions {
  provider: AIProvider;
  model: string;
  workspaceRoot: string | null;
  memory?: string;
  mcpServers?: MCPServer[];
}

export function useAgentStream({ provider, model, workspaceRoot, memory, mcpServers }: UseAgentStreamOptions) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const send = useCallback(async (prompt: string) => {
    if (!prompt.trim() || isRunning) return;
    setError(null);
    setIsRunning(true);

    const userMsg: AgentMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: prompt,
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
        body: JSON.stringify({ prompt, history, provider, model, workspaceRoot, memory, mcpServers: (mcpServers ?? []).filter((s) => s.enabled) }),
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
            updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: (msg.toolCalls ?? []).map((tc) =>
                tc.callId === event.callId
                  ? { ...tc, status: "done" as const, output: event.output }
                  : tc
              ),
            }));
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
  }, [isRunning, messages, provider, model, workspaceRoot]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
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

  return { messages, isRunning, error, send, stop, clearMessages, injectAssistantMessage };
}
