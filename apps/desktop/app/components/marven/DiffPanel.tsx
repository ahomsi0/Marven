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
    <div className="flex h-full flex-col bg-[var(--m-bg)]">
      <header className="flex items-center justify-between border-b border-[var(--m-border)] px-3 py-2">
        <span className="font-mono text-[10px] tracking-widest text-[var(--m-text-faint)] uppercase">
          Changes ({diffs.length})
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[var(--m-text-faint)] hover:text-[var(--m-text)]"
          aria-label="Close diff panel"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && <p className="text-[11px] text-[var(--m-text-faint)]">Loading diffs…</p>}
        {!loading && diffs.length === 0 && (
          <p className="text-[11px] text-[var(--m-text-faint)]">No changes since the last agent run.</p>
        )}
        {diffs.map((d) => (
          <div key={d.path} className="rounded border border-[var(--m-border)] overflow-hidden">
            <div className="flex items-center justify-between bg-[var(--m-surface)] px-2 py-1.5">
              <span className="font-mono text-[10px] text-[var(--m-text)] truncate">{d.path}</span>
              <button
                type="button"
                onClick={() => revert(d.path)}
                className="text-[10px] text-[var(--m-text-muted)] hover:text-[#d19a66]"
              >
                Revert
              </button>
            </div>
            <pre className="bg-[var(--m-bg)] px-2 py-1.5 overflow-x-auto font-mono text-[10px] leading-relaxed">
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
