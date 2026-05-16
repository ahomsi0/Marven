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

const URL_RE = /(https?:\/\/[^\s]+)/;

function OutputWithLinks({ output }: { output: string }) {
  const parts = output.split(URL_RE);
  return (
    <p className="font-mono text-[10px] text-[#888] leading-5 whitespace-pre-wrap break-all line-clamp-3">
      {parts.map((part, i) =>
        URL_RE.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#d19a66] underline underline-offset-2 hover:text-[#e0b07a]"
          >
            {part}
          </a>
        ) : (
          part
        )
      )}
    </p>
  );
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
          ? "border-[#3d3020] bg-[rgba(209,154,102,0.07)]"
          : "border-[#333] bg-[#1e1e1e]"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
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
                  key={i}
                  className="inline-block h-1 w-1 rounded-full bg-[#d19a66]"
                  style={{ opacity: 1 - i * 0.3 }}
                />
              ))}
            </span>
          )}
          {isDone && <span className="text-[10px] text-[#666]">✓</span>}
          {isError && <span className="text-[10px] text-red-500">✗</span>}
        </div>
      </div>

      {output && (
        <div className="border-t border-[#333] px-3 py-1.5">
          <OutputWithLinks output={output} />
        </div>
      )}
    </div>
  );
}
