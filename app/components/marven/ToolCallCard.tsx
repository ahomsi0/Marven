"use client";

import { useState } from "react";
import type { ToolCallState } from "@/types";

const TOOL_ICONS: Record<string, string> = {
  list_files: "📂",
  read_file: "📄",
  write_file: "✏️",
  run_command: "⚡",
  search_files: "🔍",
};

interface ToolCallCardProps {
  toolCall: ToolCallState;
  onApprove?: (callId: string, accept: boolean) => void;
}

function ArgSummary({ tool, args }: { tool: string; args: Record<string, unknown> | null }) {
  if (!args) return null;
  if (tool === "read_file" || tool === "write_file") {
    return <span className="text-[#888]">{String(args.path ?? "")}</span>;
  }
  if (tool === "run_command") {
    return <span className="text-[#888] font-mono">{String(args.command ?? "").slice(0, 40)}</span>;
  }
  if (tool === "search_files") {
    return <span className="text-[#888]">&quot;{String(args.query ?? "")}&quot;</span>;
  }
  if (tool === "list_files") {
    return <span className="text-[#888]">{String(args.path ?? ".")}</span>;
  }
  return null;
}


export function ToolCallCard({ toolCall, onApprove }: ToolCallCardProps) {
  const { tool, args, status, output } = toolCall;
  const icon = TOOL_ICONS[tool] ?? "🔧";

  const isActive = status === "running";
  const isDone = status === "done";
  const isError = status === "error";

  const [expanded, setExpanded] = useState(false);
  const canExpand = output !== undefined || toolCall.liveOutput !== undefined;

  return (
    <div
      className={`overflow-hidden rounded-md border transition-colors ${
        isActive
          ? "border-[#3d3020] bg-[rgba(209,154,102,0.07)]"
          : "border-[#333] bg-[#1e1e1e]"
      }`}
    >
      <button
        type="button"
        aria-expanded={canExpand ? expanded : undefined}
        disabled={!canExpand}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left bg-transparent border-0 ${canExpand ? "cursor-pointer" : "cursor-default"}`}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-[11px]">{icon}</span>
        <span
          className={`font-mono text-[11px] ${
            isActive ? "text-[#d19a66]" : isDone ? "text-[#999]" : "text-[#777]"
          }`}
        >
          {tool}
        </span>
        <ArgSummary tool={tool} args={args} />
        <div className="ml-auto flex items-center gap-1.5">
          {isActive && (
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={`dot-${i}`}
                  className="inline-block h-1 w-1 rounded-full bg-[#d19a66]"
                  style={{ opacity: 1 - i * 0.3 }}
                />
              ))}
            </span>
          )}
          {isDone && <span className="text-[10px] text-[#666]">✓</span>}
          {isError && <span className="text-[10px] text-red-500">✗</span>}
          {toolCall.status === "awaiting_approval" && <span className="text-[10px] text-[#d19a66]">⏸</span>}
          {toolCall.status === "rejected" && <span className="text-[10px] text-red-400">⊘</span>}
          {canExpand && (
            <span className="text-[10px] text-[#444] ml-1">
              {expanded ? "▲" : "▼"}
            </span>
          )}
        </div>
      </button>

      {toolCall.status === "awaiting_approval" && (
        <div className="border-t border-[#2a2a2a] px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-[#d19a66]">
            Awaiting approval — this will modify your repository.
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onApprove?.(toolCall.callId, false); }}
              className="rounded-md border border-[#383838] px-2 py-0.5 text-[10px] text-[#888] hover:text-red-400 hover:border-red-400/40"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onApprove?.(toolCall.callId, true); }}
              className="rounded-md border border-[#d19a66]/30 bg-[#d19a66]/10 px-2 py-0.5 text-[10px] text-[#d19a66] hover:bg-[#d19a66]/20"
            >
              Approve
            </button>
          </div>
        </div>
      )}

      {expanded && canExpand && (
        <div className="border-t border-[#2a2a2a] px-3 py-2 space-y-2">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-[#444] mb-1">Input</p>
            <div className="overflow-y-auto max-h-[200px]">
              <pre className="font-mono text-[10px] text-[#888] whitespace-pre-wrap break-all bg-[#161616] rounded p-2">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          </div>
          {toolCall.liveOutput && toolCall.status === "running" && (
            <div>
              <p className="text-[9px] uppercase tracking-widest text-[#444] mb-1">Live</p>
              <div className="overflow-y-auto max-h-[200px]">
                <pre className="font-mono text-[10px] text-[#d19a66] whitespace-pre-wrap break-all bg-[#161616] rounded p-2">
                  {toolCall.liveOutput}
                </pre>
              </div>
            </div>
          )}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-[#444] mb-1">Output</p>
            <div className="overflow-y-auto max-h-[300px]">
              <pre className="font-mono text-[10px] text-[#888] whitespace-pre-wrap break-all bg-[#161616] rounded p-2">
                {output}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
