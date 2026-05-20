"use client";

import { useEffect, useState, useCallback } from "react";

interface GitFileEntry {
  path: string;
  statusCode: string;
}

interface GitStatus {
  branch: string;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: GitFileEntry[];
}

interface GitPanelProps {
  workspaceRoot: string | null;
  onClose: () => void;
}

// Map status code to a small badge label + color class
function StatusBadge({ code }: { code: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    M: { label: "M", cls: "bg-amber-500/20 text-amber-400" },
    A: { label: "A", cls: "bg-green-500/20 text-green-400" },
    D: { label: "D", cls: "bg-red-500/20 text-red-400" },
    R: { label: "R", cls: "bg-blue-400/20 text-blue-400" },
    C: { label: "C", cls: "bg-purple-400/20 text-purple-400" },
    "?": { label: "U", cls: "bg-slate-400/20 text-slate-400" },
  };
  const entry = map[code] ?? { label: code, cls: "bg-[var(--m-surface-2)] text-[var(--m-text-muted)]" };
  return (
    <span className={`ml-auto shrink-0 rounded px-1 py-px text-[9px] font-mono font-medium ${entry.cls}`}>
      {entry.label}
    </span>
  );
}

// Color a diff line by its first character
function DiffLine({ line }: { line: string }) {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return <span className="text-green-400">{line}{"\n"}</span>;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return <span className="text-red-400">{line}{"\n"}</span>;
  }
  if (line.startsWith("@@")) {
    return <span className="text-blue-400/80">{line}{"\n"}</span>;
  }
  return <span className="text-[var(--m-text-muted)]">{line}{"\n"}</span>;
}

// Collapsible section header
function SectionHeader({
  title,
  count,
  open,
  onToggle,
  action,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)] transition-colors"
    >
      <svg
        className={`h-2.5 w-2.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
      </svg>
      <span className="flex-1">{title}</span>
      <span className="rounded-full bg-[var(--m-surface-2)] px-1.5 py-px text-[9px] text-[var(--m-text-muted)]">
        {count}
      </span>
      {action && <span onClick={(e) => e.stopPropagation()}>{action}</span>}
    </button>
  );
}

export function GitPanel({ workspaceRoot, onClose }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ path: string; staged: boolean } | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [diffLoading, setDiffLoading] = useState(false);

  // Section collapse state
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [untrackedOpen, setUntrackedOpen] = useState(true);

  const fetchStatus = useCallback(async () => {
    if (!workspaceRoot) return;
    setLoading(true);
    try {
      const res = await fetch("/api/workspace/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot, action: "status" }),
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data as GitStatus);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Close with Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function gitAction(body: Record<string, string>) {
    if (!workspaceRoot) return;
    await fetch("/api/workspace/git", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceRoot, ...body }),
    });
  }

  async function handleStage(path: string) {
    await gitAction({ action: "stage", path });
    fetchStatus();
  }

  async function handleUnstage(path: string) {
    await gitAction({ action: "unstage", path });
    fetchStatus();
  }

  async function handleStageAll() {
    await gitAction({ action: "stage_all" });
    fetchStatus();
  }

  async function handleCommit() {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    try {
      const res = await fetch("/api/workspace/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot, action: "commit", message: commitMsg.trim() }),
      });
      const data = await res.json();
      setCommitMsg("");
      setActionMsg(data.output ?? "Committed.");
      setTimeout(() => setActionMsg(null), 3000);
    } catch {
      setActionMsg("Commit failed.");
      setTimeout(() => setActionMsg(null), 3000);
    } finally {
      setCommitting(false);
      fetchStatus();
    }
  }

  async function handlePush() {
    setPushing(true);
    try {
      const res = await fetch("/api/workspace/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot, action: "push" }),
      });
      const data = await res.json();
      setActionMsg(data.output ?? "Pushed.");
      setTimeout(() => setActionMsg(null), 3000);
    } catch {
      setActionMsg("Push failed.");
      setTimeout(() => setActionMsg(null), 3000);
    } finally {
      setPushing(false);
      fetchStatus();
    }
  }

  async function handleSelectFile(path: string, staged: boolean) {
    if (selectedFile?.path === path && selectedFile?.staged === staged) {
      setSelectedFile(null);
      setDiff("");
      return;
    }
    setSelectedFile({ path, staged });
    setDiffLoading(true);
    try {
      const res = await fetch("/api/workspace/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot, action: "diff", path, staged: String(staged) }),
      });
      const data = await res.json();
      setDiff(data.diff ?? "");
    } catch {
      setDiff("");
    } finally {
      setDiffLoading(false);
    }
  }

  const branch = status?.branch ?? "…";

  return (
    <div className="flex h-full flex-col bg-[var(--m-bg)]">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[var(--m-border-subtle)] px-3 py-2.5">
        <svg
          className="h-3.5 w-3.5 shrink-0 text-[var(--m-accent)]"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          viewBox="0 0 24 24"
        >
          {/* Git branch icon: two-path fork */}
          <circle cx="6" cy="5" r="2" />
          <circle cx="18" cy="5" r="2" />
          <circle cx="6" cy="19" r="2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 7v10M6 7c0 4 12 5 12-2" />
        </svg>
        <span className="text-[11px] font-medium text-[var(--m-text)]">Git</span>
        <span className="ml-1 flex items-center gap-1 rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-1.5 py-px text-[9px] font-mono text-[var(--m-text-muted)]">
          <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l3-3 3 3M12 2v13m-6 4h12" />
          </svg>
          {branch}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => fetchStatus()}
            title="Refresh"
            className="rounded p-1 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M4 10A9.01 9.01 0 0120 14M20 14a9.01 9.01 0 01-16 4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="rounded p-1 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
      </div>

      {loading && !status ? (
        <div className="flex flex-1 items-center justify-center text-[11px] text-[var(--m-text-faint)]">
          Loading…
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* STAGED */}
          <div className="border-b border-[var(--m-border-subtle)]">
            <SectionHeader
              title="Staged"
              count={status?.staged.length ?? 0}
              open={stagedOpen}
              onToggle={() => setStagedOpen((v) => !v)}
            />
            {stagedOpen && (
              <div className="pb-1">
                {(status?.staged ?? []).length === 0 ? (
                  <p className="px-6 py-1 text-[10px] text-[var(--m-text-faint)]">Nothing staged.</p>
                ) : (
                  (status?.staged ?? []).map((f) => (
                    <div
                      key={f.path}
                      className={`group flex w-full items-center gap-1.5 py-[3px] pl-5 pr-2 transition-colors hover:bg-[var(--m-surface-2)] ${
                        selectedFile?.path === f.path && selectedFile?.staged
                          ? "bg-[var(--m-surface-2)]"
                          : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleUnstage(f.path)}
                        title="Unstage"
                        className="shrink-0 rounded border border-[var(--m-border)] px-1 py-px text-[9px] text-[var(--m-text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)]"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectFile(f.path, true)}
                        className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-[var(--m-text)]"
                        title={f.path}
                      >
                        {f.path.split("/").pop()}
                      </button>
                      <StatusBadge code={f.statusCode} />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* UNSTAGED */}
          <div className="border-b border-[var(--m-border-subtle)]">
            <SectionHeader
              title="Unstaged"
              count={status?.unstaged.length ?? 0}
              open={unstagedOpen}
              onToggle={() => setUnstagedOpen((v) => !v)}
            />
            {unstagedOpen && (
              <div className="pb-1">
                {(status?.unstaged ?? []).length === 0 ? (
                  <p className="px-6 py-1 text-[10px] text-[var(--m-text-faint)]">Nothing to stage.</p>
                ) : (
                  (status?.unstaged ?? []).map((f) => (
                    <div
                      key={f.path}
                      className={`group flex w-full items-center gap-1.5 py-[3px] pl-5 pr-2 transition-colors hover:bg-[var(--m-surface-2)] ${
                        selectedFile?.path === f.path && !selectedFile?.staged
                          ? "bg-[var(--m-surface-2)]"
                          : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleStage(f.path)}
                        title="Stage"
                        className="shrink-0 rounded border border-[var(--m-border)] px-1 py-px text-[9px] text-[var(--m-text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)]"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectFile(f.path, false)}
                        className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-[var(--m-text)]"
                        title={f.path}
                      >
                        {f.path.split("/").pop()}
                      </button>
                      <StatusBadge code={f.statusCode} />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* UNTRACKED */}
          <div className="border-b border-[var(--m-border-subtle)]">
            <SectionHeader
              title="Untracked"
              count={status?.untracked.length ?? 0}
              open={untrackedOpen}
              onToggle={() => setUntrackedOpen((v) => !v)}
              action={
                (status?.untracked.length ?? 0) > 0 ? (
                  <button
                    type="button"
                    onClick={() => handleStageAll()}
                    title="Stage all"
                    className="rounded border border-[var(--m-border)] px-1.5 py-px text-[9px] text-[var(--m-text-muted)] transition-colors hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)]"
                  >
                    +all
                  </button>
                ) : undefined
              }
            />
            {untrackedOpen && (
              <div className="pb-1">
                {(status?.untracked ?? []).length === 0 ? (
                  <p className="px-6 py-1 text-[10px] text-[var(--m-text-faint)]">No untracked files.</p>
                ) : (
                  (status?.untracked ?? []).map((f) => (
                    <div
                      key={f.path}
                      className="group flex w-full items-center gap-1.5 py-[3px] pl-5 pr-2 transition-colors hover:bg-[var(--m-surface-2)]"
                    >
                      <button
                        type="button"
                        onClick={() => handleStage(f.path)}
                        title="Stage"
                        className="shrink-0 rounded border border-[var(--m-border)] px-1 py-px text-[9px] text-[var(--m-text-muted)] opacity-0 transition-opacity group-hover:opacity-100 hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)]"
                      >
                        +
                      </button>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--m-text)]" title={f.path}>
                        {f.path.split("/").pop()}
                      </span>
                      <StatusBadge code="?" />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Diff preview */}
          {selectedFile && (
            <div className="border-b border-[var(--m-border-subtle)]">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="truncate font-mono text-[9px] text-[var(--m-text-faint)]">
                  {selectedFile.path} ({selectedFile.staged ? "staged" : "unstaged"})
                </span>
                <button
                  type="button"
                  onClick={() => { setSelectedFile(null); setDiff(""); }}
                  className="rounded p-0.5 text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
                  </svg>
                </button>
              </div>
              <pre className="max-h-48 overflow-auto px-3 pb-2 font-mono text-[10px] leading-relaxed">
                {diffLoading ? (
                  <span className="text-[var(--m-text-faint)]">Loading diff…</span>
                ) : diff ? (
                  diff.split("\n").map((line, i) => <DiffLine key={i} line={line} />)
                ) : (
                  <span className="text-[var(--m-text-faint)]">No diff available.</span>
                )}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Commit / Push footer */}
      <div className="shrink-0 border-t border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-2.5">
        {actionMsg && (
          <p className="mb-2 rounded bg-[var(--m-surface-2)] px-2 py-1 text-[10px] text-[var(--m-text-muted)]">
            {actionMsg}
          </p>
        )}
        <textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          placeholder="Commit message…"
          rows={2}
          className="w-full resize-none rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1.5 text-[11px] text-[var(--m-text)] placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-accent)]/60 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleCommit();
            }
          }}
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCommit}
            disabled={committing || !commitMsg.trim() || (status?.staged.length ?? 0) === 0}
            className="flex-1 rounded border border-[var(--m-border)] px-2 py-1 text-[10px] text-[var(--m-text-muted)] transition-colors hover:border-[var(--m-accent)]/40 hover:bg-[var(--m-accent)]/10 hover:text-[var(--m-accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {committing ? "Committing…" : "Commit"}
          </button>
          <button
            type="button"
            onClick={handlePush}
            disabled={pushing}
            className="flex-1 rounded border border-[var(--m-border)] px-2 py-1 text-[10px] text-[var(--m-text-muted)] transition-colors hover:border-[var(--m-border)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pushing ? "Pushing…" : "Push"}
          </button>
        </div>
      </div>
    </div>
  );
}
