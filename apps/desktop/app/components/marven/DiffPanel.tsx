"use client";

import { useEffect, useState } from "react";
import { createPatch } from "diff";

interface DiffPanelProps {
  checkpoints: string[];
  onClose: () => void;
}

interface FileDiff {
  path: string;
  patch: string;
  hasChanges: boolean;
}

export function DiffPanel({ checkpoints, onClose }: DiffPanelProps) {
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/agent/checkpoints")
      .then((r) => r.json())
      .then(async (data: { items: Array<{ path: string; before: string | null }> }) => {
        const entries = await Promise.all(
          data.items.map(async (item) => {
            const res = await fetch(`/api/files/read?path=${encodeURIComponent(item.path)}`);
            const after = ((await res.json()) as { content: string | null }).content ?? "";
            const before = item.before ?? "";
            const patch = createPatch(item.path, before, after, "before", "after");
            const hasChanges = before !== after;
            return { path: item.path, patch, hasChanges };
          })
        );
        setDiffs(entries.filter((d) => d.hasChanges));
      })
      .catch(() => setDiffs([]))
      .finally(() => setLoading(false));
  }, [checkpoints]);

  async function revert(path: string) {
    const res = await fetch("/api/agent/checkpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, action: "revert" }),
    });
    if (res.ok) {
      setDiffs((prev) => prev.filter((d) => d.path !== path));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--m-surface)]">
      <header className="flex h-9 shrink-0 items-center justify-between border-b border-[var(--m-border)] bg-[var(--m-bg)] ps-3 pe-1.5">
        <span className="text-[12px] font-medium text-[var(--m-text)]">
          Changes <span className="text-[var(--m-text-faint)]">{diffs.length}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Back to editor"
          aria-label="Back to editor"
          className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--m-text-faint)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && <p className="text-[12px] text-[var(--m-text-faint)]">Loading changes…</p>}
        {!loading && diffs.length === 0 && (
          <p className="text-[12px] text-[var(--m-text-faint)]">No changes since the last agent run.</p>
        )}
        {diffs.map((d) => (
          <div key={d.path} className="rounded border border-[var(--m-border)] overflow-hidden">
            <div className="flex items-center justify-between bg-[var(--m-surface)] px-2 py-1.5">
              <span className="truncate font-mono text-[11.5px] text-[var(--m-text)]">{d.path}</span>
              <button
                type="button"
                onClick={() => revert(d.path)}
                className="rounded px-1.5 py-0.5 text-[11px] text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
              >
                Revert
              </button>
            </div>
            <pre className="overflow-x-auto bg-[var(--m-bg)] px-3 py-2 font-mono text-[12px] leading-relaxed">
              {d.patch.split("\n").map((line, i) => {
                const color = line.startsWith("+") && !line.startsWith("+++")
                  ? "text-green-400"
                  : line.startsWith("-") && !line.startsWith("---")
                  ? "text-red-400"
                  : line.startsWith("@@")
                  ? "text-cyan-400"
                  : "text-[var(--m-text-faint)]";
                return <div key={i} className={color}>{line}</div>;
              })}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
