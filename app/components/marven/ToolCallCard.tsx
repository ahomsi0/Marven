"use client";

import { useState, useEffect } from "react";
import type { ToolCallState } from "@/types";

const APPROVAL_TIMEOUT_SECONDS = 60;

function DiffBlock({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  const [showAll, setShowAll] = useState(false);
  const COLLAPSE = 60;
  const isLong = lines.length > COLLAPSE;
  const visible = isLong && !showAll ? lines.slice(0, COLLAPSE) : lines;

  function lineColor(line: string): string {
    if (line.startsWith("+++") || line.startsWith("---")) return "text-[var(--m-text-faint)]";
    if (line.startsWith("+")) return "text-green-400/80";
    if (line.startsWith("-")) return "text-red-400/80";
    if (line.startsWith("@@")) return "text-[var(--m-text-faint)]";
    return "text-[var(--m-text-muted)]";
  }

  return (
    <div className="border-t border-[var(--m-border-subtle)]">
      <div className="overflow-y-auto max-h-[300px] bg-[var(--m-bg)]">
        <pre className="px-3 py-2 text-[10px] font-mono leading-relaxed select-text">
          {visible.map((line, i) => (
            <span key={i} className={lineColor(line)}>
              {line}
              {"\n"}
            </span>
          ))}
        </pre>
      </div>
      {isLong && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full py-1 text-center text-[10px] text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)] border-t border-[var(--m-border-subtle)]"
        >
          Show {lines.length - COLLAPSE} more lines
        </button>
      )}
    </div>
  );
}

// Subtle gold-tinted SVG glyphs that match the rest of the workspace look
function ToolGlyph({ tool }: { tool: string }) {
  const cls = "h-3 w-3 shrink-0 text-[#d19a66]/70";
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (tool) {
    case "list_files":
      return <svg className={cls} viewBox="0 0 24 24" {...stroke}><path d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25" /></svg>;
    case "read_file":
      return <svg className={cls} viewBox="0 0 24 24" {...stroke}><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5A3.375 3.375 0 0010.125 2.25H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>;
    case "write_file":
      return <svg className={cls} viewBox="0 0 24 24" {...stroke}><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>;
    case "run_command":
      return <svg className={cls} viewBox="0 0 24 24" {...stroke}><path d="M6.75 7.5l3 2.25-3 2.25M12.75 12.75h4.5" /><rect x="2.5" y="3" width="19" height="18" rx="2" /></svg>;
    case "search_files":
      return <svg className={cls} viewBox="0 0 24 24" {...stroke}><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></svg>;
    case "web_search":
    case "fetch_url":
      return <svg className={cls} viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></svg>;
    case "remember":
      return <svg className={cls} viewBox="0 0 24 24" {...stroke}><path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>;
    default:
      if (tool.startsWith("git_")) {
        return <svg className={cls} viewBox="0 0 24 24" {...stroke}><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><circle cx="6" cy="18" r="2" /><path d="M6 8v8M8 18h8M18 16V8a2 2 0 00-2-2H8" /></svg>;
      }
      return <svg className={cls} viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>;
  }
}

interface ToolCallCardProps {
  toolCall: ToolCallState;
  onApprove?: (callId: string, accept: boolean) => void;
}

function basename(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}

function ArgSummary({ tool, args }: { tool: string; args: Record<string, unknown> | null }) {
  if (!args) return null;
  if (tool === "read_file" || tool === "write_file" || tool === "list_files") {
    const raw = String(args.path ?? "");
    if (!raw) return null;
    return <span className="truncate font-mono text-[10px] text-[var(--m-text-muted)]" title={raw}>{basename(raw) || raw}</span>;
  }
  if (tool === "run_command") {
    const cmd = String(args.command ?? "");
    return <span className="truncate font-mono text-[10px] text-[var(--m-text-muted)]" title={cmd}>{cmd}</span>;
  }
  if (tool === "search_files") {
    return <span className="truncate font-mono text-[10px] text-[var(--m-text-muted)]">&quot;{String(args.query ?? "")}&quot;</span>;
  }
  if (tool === "web_search") {
    return <span className="truncate font-mono text-[10px] text-[var(--m-text-muted)]">&quot;{String(args.query ?? "")}&quot;</span>;
  }
  if (tool === "fetch_url") {
    const url = String(args.url ?? "");
    return <span className="truncate font-mono text-[10px] text-[var(--m-text-muted)]" title={url}>{url.replace(/^https?:\/\//, "").split("/")[0]}</span>;
  }
  if (tool.startsWith("git_")) {
    const message = String(args.message ?? args.target ?? args.name ?? args.path ?? "");
    if (message) return <span className="truncate font-mono text-[10px] text-[var(--m-text-muted)]">{message}</span>;
  }
  return null;
}


export function ToolCallCard({ toolCall, onApprove }: ToolCallCardProps) {
  const { tool, args, status, output } = toolCall;

  const isActive = status === "running";
  const isDone = status === "done";
  const isError = status === "error";

  const [expanded, setExpanded] = useState(false);
  const canExpand = output !== undefined || toolCall.liveOutput !== undefined;

  // 60-second countdown shown while awaiting approval. Resets whenever status
  // re-enters awaiting_approval; clears on unmount or status change. When the
  // counter reaches 0 we stop ticking — the agent loop auto-rejects via its
  // own timeout in registerApproval, and the next status update reflects it.
  const [approvalSecondsLeft, setApprovalSecondsLeft] = useState<number>(APPROVAL_TIMEOUT_SECONDS);
  useEffect(() => {
    if (status !== "awaiting_approval") {
      setApprovalSecondsLeft(APPROVAL_TIMEOUT_SECONDS);
      return;
    }
    setApprovalSecondsLeft(APPROVAL_TIMEOUT_SECONDS);
    const id = setInterval(() => {
      setApprovalSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  return (
    <div
      className={`overflow-hidden rounded-md border-l-2 transition-colors ${
        isActive
          ? "border-l-[#d19a66] bg-[rgba(209,154,102,0.05)]"
          : isError
          ? "border-l-red-500/60 bg-[var(--m-surface)]"
          : "border-l-[#d19a66]/35 bg-[var(--m-surface)] hover:bg-[var(--m-surface)]"
      }`}
    >
      <button
        type="button"
        aria-expanded={canExpand ? expanded : undefined}
        disabled={!canExpand}
        className={`flex w-full items-center gap-2 px-2.5 py-1 text-left bg-transparent border-0 ${canExpand ? "cursor-pointer" : "cursor-default"}`}
        onClick={() => setExpanded((v) => !v)}
      >
        <ToolGlyph tool={tool} />
        <span
          className={`text-[11px] shrink-0 tracking-tight ${
            isActive ? "text-[#d19a66]" : isDone ? "text-[var(--m-text-muted)]" : isError ? "text-red-400" : "text-[var(--m-text-muted)]"
          }`}
        >
          {tool === "__plan__" ? "Plan" : tool}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <ArgSummary tool={tool} args={args} />
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
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
          {isDone && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#d19a66]/70" aria-label="done" />
          )}
          {isError && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" aria-label="error" />
          )}
          {toolCall.status === "awaiting_approval" && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#d19a66] animate-pulse" aria-label="awaiting approval" />
          )}
          {toolCall.status === "rejected" && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-400/70" aria-label="rejected" />
          )}
          {canExpand && (
            <svg
              className="h-3 w-3 text-[var(--m-text-faint)] transition-transform duration-150"
              style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          )}
        </div>
      </button>

      {toolCall.status === "awaiting_approval" && toolCall.preview && (
        <DiffBlock diff={toolCall.preview.diff} />
      )}

      {toolCall.tool === "__plan__" && toolCall.status === "awaiting_approval" && (
        <div className="border-t border-[var(--m-border-subtle)] px-3 py-3 space-y-3">
          <p className="text-[11px] font-medium text-[var(--m-text-muted)] uppercase tracking-wider">Agent&apos;s plan</p>
          <pre className="whitespace-pre-wrap rounded border border-[var(--m-border)] bg-[var(--m-surface)] px-3 py-2 text-[11px] text-[var(--m-text-muted)] font-sans leading-relaxed">
            {String(toolCall.args?.plan ?? "")}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onApprove?.(toolCall.callId, true); }}
              className="rounded-md border border-green-700/40 bg-green-950/30 px-4 py-1.5 text-[11px] text-green-400 transition-colors hover:border-green-600/60 hover:bg-green-950/50"
            >
              Execute plan
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onApprove?.(toolCall.callId, false); }}
              className="rounded-md border border-[var(--m-border)] px-4 py-1.5 text-[11px] text-[var(--m-text-muted)] transition-colors hover:border-red-700/40 hover:text-red-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {toolCall.tool === "__plan__" && (toolCall.status === "done" || toolCall.status === "rejected") && (
        <div className="border-t border-[var(--m-border-subtle)] px-3 py-2">
          <p className="text-[11px] text-[var(--m-text-faint)]">
            {toolCall.status === "done" ? "Plan approved — executing" : "Plan cancelled"}
          </p>
        </div>
      )}

      {toolCall.tool !== "__plan__" && toolCall.status === "awaiting_approval" && (
        <div className="border-t border-[var(--m-border-subtle)] px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-[#d19a66]">
            {approvalSecondsLeft > 0
              ? `Awaiting approval — ${approvalSecondsLeft}s remaining`
              : "Awaiting approval — timed out"}
          </span>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onApprove?.(toolCall.callId, false); }}
              className="rounded-md border border-[var(--m-border)] px-2 py-0.5 text-[10px] text-[var(--m-text-muted)] hover:text-red-400 hover:border-red-400/40"
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

      {expanded && canExpand && toolCall.tool !== "__plan__" && (
        <div className="border-t border-[var(--m-border-subtle)] px-3 py-2 space-y-2">
          <div>
            <p className="text-[9px] uppercase tracking-widest text-[var(--m-border)] mb-1">Input</p>
            <div className="overflow-y-auto max-h-[200px]">
              <pre className="font-mono text-[10px] text-[var(--m-text-muted)] whitespace-pre-wrap break-all bg-[var(--m-bg)] rounded p-2">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          </div>
          {toolCall.liveOutput && toolCall.status === "running" && (
            <div>
              <p className="text-[9px] uppercase tracking-widest text-[var(--m-border)] mb-1">Live</p>
              <div className="overflow-y-auto max-h-[200px]">
                <pre className="font-mono text-[10px] text-[#d19a66] whitespace-pre-wrap break-all bg-[var(--m-bg)] rounded p-2">
                  {toolCall.liveOutput}
                </pre>
              </div>
            </div>
          )}
          <div>
            <p className="text-[9px] uppercase tracking-widest text-[var(--m-border)] mb-1">Output</p>
            <div className="overflow-y-auto max-h-[300px]">
              <pre className="font-mono text-[10px] text-[var(--m-text-muted)] whitespace-pre-wrap break-all bg-[var(--m-bg)] rounded p-2">
                {output}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
