"use client";

import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolCallCard } from "./ToolCallCard";
import type { AgentMessage } from "@/types";

interface AgentPanelProps {
  messages: AgentMessage[];
  input: string;
  isRunning: boolean;
  error: string | null;
  onInputChange: (value: string) => void;
  onSend: () => void;
}

export function AgentPanel({
  messages,
  input,
  isRunning,
  error,
  onInputChange,
  onSend,
}: AgentPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isRunning]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#1a1a1a]">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !isRunning && (
          <p className="text-[12px] text-[#555]">
            Open a folder and describe what you want to build or change.
          </p>
        )}

        <div className="flex flex-col gap-4">
          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.role === "user" ? (
                <div className="rounded-md bg-[#252525] border border-[#383838] px-3 py-2 text-[12px] text-[#ccc]">
                  {msg.content}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {(msg.toolCalls ?? []).map((tc) => (
                    <ToolCallCard key={tc.callId} toolCall={tc} />
                  ))}
                  {msg.content && (
                    <div className="prose prose-invert prose-sm max-w-none text-[12px] text-[#ccc] [&_code]:bg-[#252525] [&_code]:text-[#d19a66] [&_pre]:bg-[#1e1e1e] [&_pre]:border [&_pre]:border-[#333]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {isRunning && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex items-center gap-2 text-[11px] text-[#666]">
              <span>Agent running</span>
              {[0, 1, 2].map((i) => (
                <span key={i} className="inline-block h-1 w-1 rounded-full bg-[#555]" />
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-700/40 bg-red-950/30 px-3 py-2 text-[11px] text-red-400">
              {error}
            </div>
          )}
        </div>

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[#333] bg-[#1a1a1a] px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
            rows={1}
            placeholder="Describe what to build or change..."
            className="min-h-[36px] flex-1 resize-none rounded-md border border-[#383838] bg-[#252525] px-3 py-2 text-[12px] text-[#ddd] placeholder-[#555] outline-none transition-colors focus:border-[#555] disabled:opacity-40"
            style={{ maxHeight: 120, overflowY: "auto" }}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!input.trim() || isRunning}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[#383838] bg-[#252525] text-[#d19a66] transition-colors hover:border-[#d19a66]/50 disabled:opacity-30"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
