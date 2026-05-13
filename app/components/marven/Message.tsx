"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message as ChatMessage } from "@/types";

interface MessageProps {
  message: ChatMessage;
}

export function Message({ message }: MessageProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard errors
    }
  }

  const timeLabel = message.timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`message-in group flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      {isUser ? (
        <div className="relative max-w-[86%] sm:max-w-[78%]">
          <div className="bg-[#252525] border border-[#383838] rounded-2xl rounded-br-sm px-4 py-3">
            <p className="text-[14px] text-[#d4d4d4] leading-7 whitespace-pre-wrap break-words">
              {message.content}
            </p>
          </div>
          {/* Timestamp shown on hover */}
          <span className="mt-1 block text-right text-[10px] text-[#555] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {timeLabel}
          </span>
        </div>
      ) : (
        <div className="relative max-w-[88%] sm:max-w-[82%]">
          {/* Copy button — top-right, visible on hover */}
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy message"
            className="absolute -right-2 -top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-[#252525] border border-[#383838] text-[11px] text-[#777] opacity-0 shadow transition-all duration-150 hover:bg-[#2a2a2a] hover:text-[#ccc] group-hover:opacity-100"
            title={copied ? "Copied!" : "Copy"}
          >
            {copied ? (
              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>

          <div className="pl-3 border-l border-[#333]">
            <div className="text-[14px] text-[#d4d4d4] leading-7">
              {message.isStreaming && !message.content ? (
                /* Blinking cursor before first token */
                <span className="streaming-cursor" />
              ) : (
                <div className="prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {message.content}
                  </ReactMarkdown>
                  {message.isStreaming && (
                    <span className="streaming-cursor" />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Timestamp shown on hover */}
          <span className="mt-1 block pl-4 text-left text-[10px] text-[#555] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {timeLabel}
          </span>
        </div>
      )}
    </div>
  );
}
