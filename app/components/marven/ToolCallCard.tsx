"use client";

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
}

function ArgSummary({ tool, args }: { tool: string; args: Record<string, unknown> }) {
  if (tool === "read_file" || tool === "write_file") {
    return <span className="text-[#555]">{String(args.path ?? "")}</span>;
  }
  if (tool === "run_command") {
    return <span className="text-[#555] font-mono">{String(args.command ?? "").slice(0, 40)}</span>;
  }
  if (tool === "search_files") {
    return <span className="text-[#555]">&quot;{String(args.query ?? "")}&quot;</span>;
  }
  if (tool === "list_files") {
    return <span className="text-[#555]">{String(args.path ?? ".")}</span>;
  }
  return null;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const { tool, args, status, output } = toolCall;
  const icon = TOOL_ICONS[tool] ?? "🔧";

  const isActive = status === "running";
  const isDone = status === "done";
  const isError = status === "error";

  return (
    <div
      className={`overflow-hidden rounded-md border transition-colors ${
        isActive
          ? "border-[#2a2a1a] bg-[rgba(209,154,102,0.04)]"
          : "border-[#1a1a1a] bg-[#0d0d0d]"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[11px]">{icon}</span>
        <span
          className={`font-mono text-[11px] ${
            isActive ? "text-[#d19a66]" : isDone ? "text-[#666]" : "text-[#444]"
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
                  key={i}
                  className="inline-block h-1 w-1 rounded-full bg-[#d19a66]"
                  style={{ opacity: 1 - i * 0.3 }}
                />
              ))}
            </span>
          )}
          {isDone && <span className="text-[10px] text-[#444]">✓</span>}
          {isError && <span className="text-[10px] text-red-800">✗</span>}
        </div>
      </div>

      {output && (
        <div className="border-t border-[#1a1a1a] px-3 py-1.5">
          <p className="font-mono text-[10px] text-[#333] leading-5 whitespace-pre-wrap break-all line-clamp-3">
            {output}
          </p>
        </div>
      )}
    </div>
  );
}
