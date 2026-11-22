"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentMessage, WorkspaceFile } from "@/types";
import {
  getRequireWriteApproval,
  setRequireWriteApproval,
  setPlanMode,
} from "@/lib/agentSettings";

type TabKey = "scan" | "timeline" | "review" | "release" | "memory";

interface ProjectScan {
  name: string;
  version: string | null;
  packageManager: string | null;
  stack: string[];
  scripts: Record<string, string>;
  verificationCommands: string[];
  entrypoints: string[];
  importantFiles: string[];
  envFiles: string[];
  recommendations: string[];
  scannedAt: string;
}

interface ReviewFinding {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  file?: string;
}

interface ReviewResult {
  status: string;
  diffStat: string;
  changedFiles: string[];
  findings: ReviewFinding[];
  summary: string;
}

interface ReleaseChecklist {
  version: string | null;
  tag: string | null;
  branch: string;
  latestTag: string;
  suggestedCommands: string[];
  artifacts: string[];
  checklist: Array<{ label: string; done: boolean; detail: string }>;
}

interface TimelineItem {
  id: string;
  label: string;
  detail: string;
  tone: "neutral" | "running" | "done" | "warn" | "error";
}

interface WorkflowPanelProps {
  workspaceRoot: string | null;
  files: WorkspaceFile[];
  messages: AgentMessage[];
  isRunning: boolean;
  planMode?: boolean;
  onPlanModeChange?: (value: boolean) => void;
  onRunAgentPrompt?: (prompt: string) => void;
  onSelectFile?: (path: string) => void;
  onClose: () => void;
}

function compactRoot(root: string | null): string {
  if (!root) return "No workspace";
  const parts = root.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/");
}

function buildTimeline(messages: AgentMessage[], isRunning: boolean): TimelineItem[] {
  const items: TimelineItem[] = [];
  const lastUser = [...messages].reverse().find((msg) => msg.role === "user");
  if (lastUser) {
    items.push({
      id: `${lastUser.id}-prompt`,
      label: "Prompt",
      detail: lastUser.content.slice(0, 120),
      tone: "neutral",
    });
  }

  for (const msg of messages.slice(-8)) {
    for (const call of msg.toolCalls ?? []) {
      const statusTone: TimelineItem["tone"] =
        call.status === "running" ? "running" :
        call.status === "done" ? "done" :
        call.status === "error" || call.status === "rejected" ? "error" :
        call.status === "awaiting_approval" ? "warn" :
        "neutral";
      items.push({
        id: call.callId,
        label: call.tool,
        detail: summarizeArgs(call.args),
        tone: statusTone,
      });
    }
  }

  if (isRunning && items.length === 0) {
    items.push({ id: "running", label: "Agent", detail: "Preparing the next step", tone: "running" });
  }
  return items.slice(-12);
}

function summarizeArgs(args: Record<string, unknown>): string {
  const path = typeof args.path === "string" ? args.path : typeof args.file === "string" ? args.file : "";
  const command = typeof args.command === "string" ? args.command : "";
  const query = typeof args.query === "string" ? args.query : "";
  return path || command || query || JSON.stringify(args).slice(0, 100);
}

function badgeClass(tone: TimelineItem["tone"]): string {
  if (tone === "running") return "border-[#5b9cf6]/40 bg-[#5b9cf6]/10 text-[#8cbcff]";
  if (tone === "done") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (tone === "warn") return "border-[#d19a66]/40 bg-[#d19a66]/10 text-[#d19a66]";
  if (tone === "error") return "border-red-500/30 bg-red-500/10 text-red-300";
  return "border-[var(--m-border)] bg-[var(--m-surface-2)] text-[var(--m-text-muted)]";
}

export function WorkflowPanel({
  workspaceRoot,
  files,
  messages,
  isRunning,
  planMode,
  onPlanModeChange,
  onRunAgentPrompt,
  onSelectFile,
  onClose,
}: WorkflowPanelProps) {
  const [tab, setTab] = useState<TabKey>("scan");
  const [scan, setScan] = useState<ProjectScan | null>(null);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [release, setRelease] = useState<ReleaseChecklist | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifyOutput, setVerifyOutput] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memorySaved, setMemorySaved] = useState(false);
  const [writeApproval, setWriteApprovalState] = useState(false);

  useEffect(() => {
    setWriteApprovalState(getRequireWriteApproval());
  }, []);

  const timeline = useMemo(() => buildTimeline(messages, isRunning), [messages, isRunning]);
  const docs = useMemo(
    () => files.filter((file) => /\.(md|mdx|txt|rst)$/i.test(file.path)).slice(0, 24),
    [files],
  );

  async function postJson<T>(url: string, payload: Record<string, unknown>, label: string): Promise<T | null> {
    if (!workspaceRoot) return null;
    setLoading(label);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `${label} failed`);
      return data as T;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(null);
    }
  }

  async function runScan() {
    const data = await postJson<ProjectScan>("/api/workspace/scan", { workspaceRoot }, "scan");
    if (data) setScan(data);
  }

  async function runReview() {
    const data = await postJson<ReviewResult>("/api/workspace/review", { workspaceRoot }, "review");
    if (data) setReview(data);
  }

  async function runRelease() {
    const data = await postJson<ReleaseChecklist>("/api/workspace/release-checklist", { workspaceRoot }, "release");
    if (data) setRelease(data);
  }

  async function runVerify() {
    if (!workspaceRoot) return;
    setLoading("verify");
    setError(null);
    setVerifyOutput("");
    try {
      const res = await fetch("/api/agent/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text().catch(() => "Verify failed"));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const event = part.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
          const data = part.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
          if (!event || !data) continue;
          const parsed = JSON.parse(data) as { delta?: string; chunk?: string; output?: string; message?: string };
          if (event === "text_delta") setVerifyOutput((prev) => prev + (parsed.delta ?? ""));
          if (event === "tool_progress") setVerifyOutput((prev) => prev + (parsed.chunk ?? ""));
          if (event === "tool_result") setVerifyOutput((prev) => `${prev}\n${parsed.output ?? ""}\n`);
          if (event === "error") throw new Error(parsed.message ?? "Verify failed");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function saveProjectMemory() {
    const content = memoryDraft.trim();
    if (!content || !workspaceRoot) return;
    const data = await postJson<{ ok: boolean }>("/api/memory", { workspaceRoot, scope: "project", content }, "memory");
    if (data?.ok) {
      setMemoryDraft("");
      setMemorySaved(true);
      window.setTimeout(() => setMemorySaved(false), 1800);
    }
  }

  function applyPermissionProfile(profile: "read" | "ask" | "auto" | "full") {
    const nextPlan = profile === "read";
    const nextApproval = profile === "ask" || profile === "read";
    setPlanMode(nextPlan);
    onPlanModeChange?.(nextPlan);
    setRequireWriteApproval(nextApproval);
    setWriteApprovalState(nextApproval);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--m-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--m-border)] px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-[var(--m-text-faint)]">Workflow</div>
          <div className="truncate text-[12px] text-[var(--m-text)]">{compactRoot(workspaceRoot)}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]" title="Close workflow panel">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-5 border-b border-[var(--m-border-subtle)]">
        {(["scan", "timeline", "review", "release", "memory"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`truncate px-1.5 py-2 text-[10px] capitalize transition-colors ${
              tab === key ? "bg-[var(--m-surface)] text-[#d19a66]" : "text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!workspaceRoot ? (
          <p className="text-[12px] text-[var(--m-text-faint)]">Open a workspace to use workflow tools.</p>
        ) : (
          <>
            {error && (
              <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                {error}
              </div>
            )}

            {tab === "scan" && (
              <div className="space-y-3">
                <button type="button" onClick={runScan} disabled={loading !== null} className="w-full rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] px-3 py-2 text-[12px] text-[var(--m-text)] hover:bg-[var(--m-surface-2)] disabled:opacity-50">
                  {loading === "scan" ? "Scanning..." : "Scan Project"}
                </button>
                {scan && (
                  <div className="space-y-3 text-[11px]">
                    <Info label="Stack" value={scan.stack.join(", ") || "Not detected"} />
                    <Info label="Package manager" value={scan.packageManager ?? "Unknown"} />
                    <Info label="Version" value={scan.version ?? "Unknown"} />
                    <Section title="Verify commands" items={scan.verificationCommands} />
                    <Section title="Entrypoints" items={scan.entrypoints} onItemClick={onSelectFile} />
                    <Section title="Docs and config" items={scan.importantFiles} onItemClick={onSelectFile} />
                    <Section title="Recommendations" items={scan.recommendations} />
                  </div>
                )}
                <div className="rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] p-2">
                  <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--m-text-faint)]">Docs explorer</div>
                  {docs.length === 0 ? (
                    <p className="text-[11px] text-[var(--m-text-faint)]">No docs found in the current file list.</p>
                  ) : (
                    <div className="space-y-1">
                      {docs.map((file) => (
                        <button key={file.path} type="button" onClick={() => onSelectFile?.(file.path)} className="block w-full truncate rounded px-2 py-1 text-left text-[11px] text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]">
                          {file.path}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === "timeline" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={runVerify} disabled={loading !== null} className="rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] px-2 py-2 text-[11px] text-[var(--m-text)] hover:bg-[var(--m-surface-2)] disabled:opacity-50">
                    {loading === "verify" ? "Running..." : "Verify Changes"}
                  </button>
                  <button type="button" onClick={() => onRunAgentPrompt?.("Review the current workspace changes, identify bugs or risks first, then fix the highest-confidence issues and run verification.")} disabled={isRunning} className="rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] px-2 py-2 text-[11px] text-[var(--m-text)] hover:bg-[var(--m-surface-2)] disabled:opacity-50">
                    Review + Fix
                  </button>
                </div>
                {verifyOutput && (
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--m-border)] bg-black/20 p-2 text-[10px] text-[var(--m-text-muted)]">
                    {verifyOutput.trim()}
                  </pre>
                )}
                <div className="space-y-2">
                  {timeline.length === 0 ? (
                    <p className="text-[12px] text-[var(--m-text-faint)]">No agent activity yet.</p>
                  ) : timeline.map((item) => (
                    <div key={item.id} className="rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] p-2">
                      <div className="mb-1 flex items-center gap-2">
                        <span className={`rounded border px-1.5 py-0.5 text-[9px] ${badgeClass(item.tone)}`}>{item.tone}</span>
                        <span className="truncate text-[11px] text-[var(--m-text)]">{item.label}</span>
                      </div>
                      <div className="break-words text-[10px] text-[var(--m-text-muted)]">{item.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "review" && (
              <div className="space-y-3">
                <button type="button" onClick={runReview} disabled={loading !== null} className="w-full rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] px-3 py-2 text-[12px] text-[var(--m-text)] hover:bg-[var(--m-surface-2)] disabled:opacity-50">
                  {loading === "review" ? "Reviewing..." : "Review Git Diff"}
                </button>
                {review && (
                  <div className="space-y-3">
                    <p className="text-[12px] text-[var(--m-text-muted)]">{review.summary}</p>
                    <Section title="Changed files" items={review.changedFiles} onItemClick={onSelectFile} />
                    {review.findings.map((finding, i) => (
                      <div key={`${finding.title}-${i}`} className="rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] p-2">
                        <div className={`mb-1 inline-flex rounded border px-1.5 py-0.5 text-[9px] ${finding.severity === "high" ? "border-red-500/30 bg-red-500/10 text-red-300" : finding.severity === "medium" ? "border-[#d19a66]/40 bg-[#d19a66]/10 text-[#d19a66]" : "border-[var(--m-border)] bg-[var(--m-surface-2)] text-[var(--m-text-muted)]"}`}>
                          {finding.severity}
                        </div>
                        <div className="text-[12px] text-[var(--m-text)]">{finding.title}</div>
                        {finding.file && <div className="text-[10px] text-[var(--m-text-faint)]">{finding.file}</div>}
                        <p className="mt-1 text-[11px] leading-relaxed text-[var(--m-text-muted)]">{finding.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "release" && (
              <div className="space-y-3">
                <button type="button" onClick={runRelease} disabled={loading !== null} className="w-full rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] px-3 py-2 text-[12px] text-[var(--m-text)] hover:bg-[var(--m-surface-2)] disabled:opacity-50">
                  {loading === "release" ? "Checking..." : "Build Release Checklist"}
                </button>
                {release && (
                  <div className="space-y-3">
                    <Info label="Release" value={`${release.tag ?? "No tag"} on ${release.branch || "unknown branch"}`} />
                    {release.checklist.map((item) => (
                      <div key={item.label} className="rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] p-2">
                        <div className="flex items-center gap-2">
                          <span className={item.done ? "text-emerald-300" : "text-[#d19a66]"}>{item.done ? "OK" : "!"}</span>
                          <span className="text-[12px] text-[var(--m-text)]">{item.label}</span>
                        </div>
                        <div className="mt-1 break-words text-[10px] text-[var(--m-text-muted)]">{item.detail}</div>
                      </div>
                    ))}
                    <Section title="Suggested checks" items={release.suggestedCommands} />
                    <Section title="Artifacts" items={release.artifacts} />
                  </div>
                )}
              </div>
            )}

            {tab === "memory" && (
              <div className="space-y-4">
                <div className="rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] p-2">
                  <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--m-text-faint)]">Permission profiles</div>
                  <div className="grid grid-cols-2 gap-2">
                    <ProfileButton label="Read-only" active={Boolean(planMode) && writeApproval} onClick={() => applyPermissionProfile("read")} />
                    <ProfileButton label="Ask edits" active={!planMode && writeApproval} onClick={() => applyPermissionProfile("ask")} />
                    <ProfileButton label="Auto edit" active={!planMode && !writeApproval} onClick={() => applyPermissionProfile("auto")} />
                    <ProfileButton label="Full flow" active={!planMode && !writeApproval} onClick={() => applyPermissionProfile("full")} />
                  </div>
                </div>
                <div className="rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] p-2">
                  <div className="mb-2 text-[10px] uppercase tracking-wider text-[var(--m-text-faint)]">Project memory</div>
                  <textarea
                    value={memoryDraft}
                    onChange={(e) => setMemoryDraft(e.target.value)}
                    rows={4}
                    placeholder="Example: Use npm test before release. Keep Aurora plum/slate."
                    className="w-full resize-none rounded-md border border-[var(--m-border)] bg-[var(--m-bg)] px-2 py-2 text-[11px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] focus:border-[#d19a66]/50"
                  />
                  <button type="button" onClick={saveProjectMemory} disabled={!memoryDraft.trim() || loading !== null} className="mt-2 w-full rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)] px-3 py-2 text-[11px] text-[var(--m-text)] hover:border-[#d19a66]/40 disabled:opacity-50">
                    {memorySaved ? "Saved" : "Remember for this project"}
                  </button>
                </div>
                <button type="button" onClick={() => onRunAgentPrompt?.("Create a task branch for the current issue, implement the change, verify it, summarize the diff, and prepare a commit message and PR description. Ask before committing or pushing.")} disabled={isRunning} className="w-full rounded-md border border-[#d19a66]/40 bg-[#d19a66]/10 px-3 py-2 text-[12px] text-[#d19a66] hover:bg-[#d19a66]/15 disabled:opacity-50">
                  Start Issue-to-PR Flow
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] p-2">
      <div className="text-[9px] uppercase tracking-wider text-[var(--m-text-faint)]">{label}</div>
      <div className="mt-1 break-words text-[12px] text-[var(--m-text)]">{value}</div>
    </div>
  );
}

function Section({ title, items, onItemClick }: { title: string; items: string[]; onItemClick?: (item: string) => void }) {
  return (
    <div className="rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] p-2">
      <div className="mb-1.5 text-[9px] uppercase tracking-wider text-[var(--m-text-faint)]">{title}</div>
      {items.length === 0 ? (
        <p className="text-[11px] text-[var(--m-text-faint)]">None</p>
      ) : (
        <div className="space-y-1">
          {items.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onItemClick?.(item)}
              disabled={!onItemClick}
              className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] text-[var(--m-text-muted)] enabled:hover:bg-[var(--m-surface-2)] enabled:hover:text-[var(--m-text)] disabled:cursor-default"
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-1.5 text-[10px] transition-colors ${
        active
          ? "border-[#d19a66]/50 bg-[#d19a66]/10 text-[#d19a66]"
          : "border-[var(--m-border)] bg-[var(--m-bg)] text-[var(--m-text-muted)] hover:text-[var(--m-text)]"
      }`}
    >
      {label}
    </button>
  );
}
