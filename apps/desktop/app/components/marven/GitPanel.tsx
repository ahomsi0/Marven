"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { AIProvider } from "@/types";

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
  provider: AIProvider;
  model: string;
}

type AssistantMode =
  | "commit_message"
  | "commit_groups"
  | "pr_summary"
  | "explain_changes";

type DetailView = "diff" | "assistant";

function StatusBadge({ code }: { code: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    M: { label: "M", cls: "bg-amber-500/15 text-amber-300" },
    A: { label: "A", cls: "bg-green-500/15 text-green-300" },
    D: { label: "D", cls: "bg-red-500/15 text-red-300" },
    R: { label: "R", cls: "bg-blue-500/15 text-blue-300" },
    C: { label: "C", cls: "bg-purple-500/15 text-purple-300" },
    "?": { label: "U", cls: "bg-slate-500/15 text-slate-300" },
  };
  const entry = map[code] ?? {
    label: code,
    cls: "bg-[var(--m-surface-2)] text-[var(--m-text-muted)]",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-mono ${entry.cls}`}>
      {entry.label}
    </span>
  );
}

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

function SegmentedButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-[10px] transition-colors ${
        active
          ? "bg-[var(--m-accent)]/15 text-[var(--m-accent)]"
          : "text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
      }`}
    >
      {label}
    </button>
  );
}

function Section({
  title,
  count,
  open,
  onToggle,
  children,
  action,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="border-b border-[var(--m-border-subtle)] last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <svg
          className={`h-3 w-3 shrink-0 text-[var(--m-text-faint)] transition-transform ${open ? "rotate-90" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 4 10 8 6 12" />
        </svg>
        <span className="text-[11px] font-medium text-[var(--m-text)]">{title}</span>
        <span className="rounded-full bg-[var(--m-surface-2)] px-1.5 py-0.5 text-[9px] text-[var(--m-text-muted)]">
          {count}
        </span>
        <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
          {action}
        </span>
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

export function GitPanel({ workspaceRoot, onClose, provider, model }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ path: string; staged: boolean } | null>(null);
  const [diff, setDiff] = useState("");
  const [diffLoading, setDiffLoading] = useState(false);
  const [detailView, setDetailView] = useState<DetailView>("diff");
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("commit_message");
  const [assistantText, setAssistantText] = useState("");
  const [assistantLoading, setAssistantLoading] = useState(false);
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
        setStatus((await res.json()) as GitStatus);
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
      setTimeout(() => setActionMsg(null), 3500);
    } catch {
      setActionMsg("Commit failed.");
      setTimeout(() => setActionMsg(null), 3500);
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
      setTimeout(() => setActionMsg(null), 3500);
    } catch {
      setActionMsg("Push failed.");
      setTimeout(() => setActionMsg(null), 3500);
    } finally {
      setPushing(false);
      fetchStatus();
    }
  }

  async function handleSelectFile(path: string, staged: boolean) {
    setDetailView("diff");
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

  async function handleAssist(mode: AssistantMode) {
    if (!workspaceRoot) return;
    setAssistantMode(mode);
    setDetailView("assistant");
    setAssistantLoading(true);
    try {
      const res = await fetch("/api/workspace/git-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot, provider, model, mode }),
      });
      const data = await res.json();
      const text = data.text ?? data.error ?? "";
      setAssistantText(text);
      if (res.ok && mode === "commit_message" && text) {
        setCommitMsg(text.trim());
      }
    } catch {
      setAssistantText("Could not generate git assistance.");
    } finally {
      setAssistantLoading(false);
    }
  }

  const branch = status?.branch ?? "…";
  const totalChanged = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) + (status?.untracked.length ?? 0);
  const hasStaged = (status?.staged.length ?? 0) > 0;

  const detailTitle = useMemo(() => {
    if (detailView === "assistant") {
      return {
        commit_message: "Commit Message",
        commit_groups: "Commit Groups",
        pr_summary: "PR Summary",
        explain_changes: "Change Explanation",
      }[assistantMode];
    }
    if (!selectedFile) return "Diff";
    return `${selectedFile.path} (${selectedFile.staged ? "staged" : "unstaged"})`;
  }, [assistantMode, detailView, selectedFile]);

  function renderFileRow(file: GitFileEntry, staged: boolean) {
    const active = selectedFile?.path === file.path && selectedFile?.staged === staged && detailView === "diff";
    return (
      <div
        key={`${staged ? "staged" : "unstaged"}:${file.path}`}
        className={`group flex items-center gap-2 px-3 py-1.5 ${active ? "bg-[var(--m-surface-2)]" : "hover:bg-[var(--m-surface-2)]"}`}
      >
        <button
          type="button"
          onClick={() => (staged ? handleUnstage(file.path) : handleStage(file.path))}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--m-border)] text-[10px] text-[var(--m-text-faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)]"
          title={staged ? "Unstage" : "Stage"}
        >
          {staged ? "−" : "+"}
        </button>
        <button
          type="button"
          onClick={() => handleSelectFile(file.path, staged)}
          className="min-w-0 flex-1 text-left"
          title={file.path}
        >
          <div className="truncate text-[11px] text-[var(--m-text)]">{file.path.split("/").pop()}</div>
          <div className="truncate font-mono text-[9px] text-[var(--m-text-faint)]">{file.path}</div>
        </button>
        <StatusBadge code={staged ? file.statusCode : file.statusCode} />
      </div>
    );
  }

  if (loading && !status) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--m-bg)] text-[11px] text-[var(--m-text-faint)]">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--m-bg)]">
      <div className="flex items-center gap-2 border-b border-[var(--m-border-subtle)] px-3 py-2.5">
        <svg
          className="h-3.5 w-3.5 shrink-0 text-[var(--m-accent)]"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          viewBox="0 0 24 24"
        >
          <circle cx="6" cy="5" r="2" />
          <circle cx="18" cy="5" r="2" />
          <circle cx="6" cy="19" r="2" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 7v10M6 7c0 4 12 5 12-2" />
        </svg>
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-[var(--m-text)]">Git</div>
          <div className="text-[9px] text-[var(--m-text-faint)]">{totalChanged} changed · {branch}</div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={fetchStatus}
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

      <div className="border-b border-[var(--m-border-subtle)] px-3 py-2">
        <div className="flex items-center gap-1 rounded-lg bg-[var(--m-surface)] p-1">
          <SegmentedButton active={assistantMode === "commit_message" && detailView === "assistant"} label="Message" onClick={() => handleAssist("commit_message")} />
          <SegmentedButton active={assistantMode === "commit_groups" && detailView === "assistant"} label="Groups" onClick={() => handleAssist("commit_groups")} />
          <SegmentedButton active={assistantMode === "pr_summary" && detailView === "assistant"} label="PR" onClick={() => handleAssist("pr_summary")} />
          <SegmentedButton active={assistantMode === "explain_changes" && detailView === "assistant"} label="Explain" onClick={() => handleAssist("explain_changes")} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 overflow-y-auto border-b border-[var(--m-border-subtle)]">
            <Section title="Staged" count={status?.staged.length ?? 0} open={stagedOpen} onToggle={() => setStagedOpen((v) => !v)}>
              {(status?.staged ?? []).length === 0 ? (
                <p className="px-3 py-1 text-[10px] text-[var(--m-text-faint)]">Nothing staged.</p>
              ) : (
                (status?.staged ?? []).map((file) => renderFileRow(file, true))
              )}
            </Section>
            <Section title="Unstaged" count={status?.unstaged.length ?? 0} open={unstagedOpen} onToggle={() => setUnstagedOpen((v) => !v)}>
              {(status?.unstaged ?? []).length === 0 ? (
                <p className="px-3 py-1 text-[10px] text-[var(--m-text-faint)]">Nothing to stage.</p>
              ) : (
                (status?.unstaged ?? []).map((file) => renderFileRow(file, false))
              )}
            </Section>
            <Section
              title="Untracked"
              count={status?.untracked.length ?? 0}
              open={untrackedOpen}
              onToggle={() => setUntrackedOpen((v) => !v)}
              action={
                (status?.untracked.length ?? 0) > 0 ? (
                  <button
                    type="button"
                    onClick={handleStageAll}
                    className="rounded border border-[var(--m-border)] px-1.5 py-0.5 text-[9px] text-[var(--m-text-muted)] hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)]"
                  >
                    Stage all
                  </button>
                ) : undefined
              }
            >
              {(status?.untracked ?? []).length === 0 ? (
                <p className="px-3 py-1 text-[10px] text-[var(--m-text-faint)]">No untracked files.</p>
              ) : (
                (status?.untracked ?? []).map((file) => (
                  <div key={`untracked:${file.path}`} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--m-surface-2)]">
                    <button
                      type="button"
                      onClick={() => handleStage(file.path)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[var(--m-border)] text-[10px] text-[var(--m-text-faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)]"
                      title="Stage"
                    >
                      +
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] text-[var(--m-text)]">{file.path.split("/").pop()}</div>
                      <div className="truncate font-mono text-[9px] text-[var(--m-text-faint)]">{file.path}</div>
                    </div>
                    <StatusBadge code="?" />
                  </div>
                ))
              )}
            </Section>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--m-border-subtle)] px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-[11px] font-medium text-[var(--m-text)]">{detailTitle}</div>
                <div className="text-[9px] text-[var(--m-text-faint)]">
                  {detailView === "assistant" ? `${provider} · ${model}` : selectedFile ? "Diff preview" : "Select a file or assistant action"}
                </div>
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-[var(--m-surface)] p-1">
                <SegmentedButton active={detailView === "diff"} label="Diff" onClick={() => setDetailView("diff")} />
                <SegmentedButton active={detailView === "assistant"} label="Assistant" onClick={() => setDetailView("assistant")} />
              </div>
            </div>

            <div className="h-full overflow-auto px-3 py-2">
              {detailView === "assistant" ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-[var(--m-text-muted)]">
                  {assistantLoading ? "Generating…" : assistantText || "Pick an assistant action above to generate commit or PR help from the current diff."}
                </pre>
              ) : diffLoading ? (
                <div className="text-[10px] text-[var(--m-text-faint)]">Loading diff…</div>
              ) : diff ? (
                <pre className="font-mono text-[10px] leading-relaxed">
                  {diff.split("\n").map((line, i) => <DiffLine key={i} line={line} />)}
                </pre>
              ) : (
                <div className="text-[10px] text-[var(--m-text-faint)]">
                  {selectedFile ? "No diff available." : "Select a changed file to inspect its diff."}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-3">
        {actionMsg && (
          <div className="mb-2 rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] px-2.5 py-1.5 text-[10px] text-[var(--m-text-muted)]">
            {actionMsg}
          </div>
        )}
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-medium text-[var(--m-text)]">Commit</div>
            <div className="text-[9px] text-[var(--m-text-faint)]">
              {hasStaged ? "Ready to commit staged changes" : "Stage changes to commit"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleAssist("commit_message")}
            className="rounded-md border border-[var(--m-border)] px-2 py-1 text-[10px] text-[var(--m-text-muted)] hover:border-[var(--m-accent)]/40 hover:text-[var(--m-accent)]"
          >
            Suggest message
          </button>
        </div>
        <textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          placeholder="Write a commit message…"
          rows={3}
          className="w-full resize-none rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)] px-3 py-2 text-[11px] text-[var(--m-text)] placeholder:text-[var(--m-text-faint)] outline-none focus:border-[var(--m-accent)]/60"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleCommit();
            }
          }}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={handleCommit}
            disabled={committing || !commitMsg.trim() || !hasStaged}
            className="flex-1 rounded-md border border-[var(--m-accent)]/35 bg-[var(--m-accent)]/10 px-3 py-2 text-[10px] font-medium text-[var(--m-accent)] transition-colors hover:bg-[var(--m-accent)]/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {committing ? "Committing…" : "Commit staged"}
          </button>
          <button
            type="button"
            onClick={handlePush}
            disabled={pushing}
            className="flex-1 rounded-md border border-[var(--m-border)] px-3 py-2 text-[10px] text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pushing ? "Pushing…" : "Push"}
          </button>
        </div>
      </div>
    </div>
  );
}
