"use client";

import type { EditorProblem } from "@/types";

interface ProblemsPanelProps {
  problems: EditorProblem[];
  onSelect: (path: string, line: number, column: number) => void;
}

export function ProblemsPanel({ problems, onSelect }: ProblemsPanelProps) {
  if (problems.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 py-6 font-mono text-[11px] text-[var(--m-text-faint)]">
        No problems — LSP diagnostics appear here when a language server is active.
      </div>
    );
  }

  return (
    <div className="marven-scroll h-full min-h-0 overflow-y-auto">
      <ul className="divide-y divide-[var(--m-border-subtle)] font-mono text-[11px]">
        {problems.map((p, i) => (
          <li key={`${p.path}:${p.line}:${p.column}:${i}`}>
            <button
              type="button"
              onClick={() => onSelect(p.path, p.line, p.column)}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-[var(--m-surface-2)]"
            >
              <span className="flex w-full items-center gap-2">
                <span
                  className={
                    p.severity === "error"
                      ? "text-red-400"
                      : p.severity === "warning"
                        ? "text-[#d19a66]"
                        : "text-[var(--m-text-muted)]"
                  }
                >
                  {p.severity === "error" ? "●" : p.severity === "warning" ? "◆" : "○"}
                </span>
                <span className="truncate text-[var(--m-text-muted)]">
                  {p.path}:{p.line + 1}:{p.column + 1}
                </span>
              </span>
              <span className="pl-5 text-[var(--m-text)]">{p.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
