"use client";

// Small circular indicator that sits next to the model picker. Click to open
// a popover with token usage details. Modeled on Claude Code's status pill —
// a faint ring whose stroke fills as the conversation consumes more of the
// model's context window.

import { useEffect, useRef, useState } from "react";
import type { TokenUsage, AIProvider } from "@/types";

interface UsageIndicatorProps {
  usage: TokenUsage;
  provider: AIProvider;
  model: string;
}

// Rough context-window sizes by model family. Used purely to drive the visual
// fill — actual API limits vary slightly per checkpoint.
function contextWindowFor(model: string): number {
  const m = model.toLowerCase();
  if (m.includes("claude")) return 200_000;
  if (m.includes("gpt-4o")) return 128_000;
  if (m.includes("gpt-4")) return 128_000;
  if (m.includes("o1") || m.includes("o3")) return 128_000;
  if (m.includes("llama-3.3")) return 128_000;
  if (m.includes("llama-3.1-8b")) return 131_072;
  if (m.includes("llama-3.1-70b")) return 131_072;
  if (m.includes("llama-3")) return 8_192;
  if (m.includes("mixtral")) return 32_768;
  if (m.includes("gemma")) return 8_192;
  if (m.includes("qwen")) return 32_768;
  if (m.includes("deepseek")) return 128_000;
  if (m.includes("nemotron")) return 128_000;
  return 32_000;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function UsageIndicator({ usage, provider, model }: UsageIndicatorProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on click outside / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ctxWindow = contextWindowFor(model);
  // Visual fill — clamp at 100%. We use total tokens vs. context window as the
  // proxy, which roughly tracks "how full this conversation feels".
  const pct = Math.min(1, usage.totalTokens / Math.max(1, ctxWindow));
  // SVG circumference for a 7px radius (stroke draws inside the 16x16 box).
  const r = 7;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - pct);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Token usage: ${usage.totalTokens.toLocaleString()} tokens`}
        title={`${usage.totalTokens.toLocaleString()} tokens · click for details`}
        className="ml-1.5 flex h-5 w-5 items-center justify-center rounded-full text-[var(--m-text-faint)] transition-colors hover:text-[var(--m-accent)]"
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4 -rotate-90" aria-hidden>
          {/* Track */}
          <circle
            cx="8"
            cy="8"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.25"
          />
          {/* Fill */}
          <circle
            cx="8"
            cy="8"
            r={r}
            fill="none"
            stroke="var(--m-accent)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 0.4s ease" }}
          />
        </svg>
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute bottom-full right-0 z-40 mb-2 w-[240px] rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
        >
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--m-text-faint)]">
            Token usage
          </div>

          <div className="space-y-1.5 text-[11px]">
            <Row label="Prompt"     value={formatTokens(usage.promptTokens)} />
            <Row label="Completion" value={formatTokens(usage.completionTokens)} />
            <Row label="Total"      value={formatTokens(usage.totalTokens)} accent />
          </div>

          <div className="my-2.5 h-px bg-[var(--m-border-subtle)]" />

          <div className="space-y-1.5 text-[11px]">
            <Row label="Provider" value={provider} />
            <Row label="Model"    value={model || "—"} mono />
            <Row label="Context"  value={`${formatTokens(usage.totalTokens)} / ${formatTokens(ctxWindow)}`} />
          </div>

          <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--m-surface-3)]">
            <div
              className="h-full rounded-full bg-[var(--m-accent)] transition-all"
              style={{ width: `${(pct * 100).toFixed(1)}%` }}
            />
          </div>
          <div className="mt-1 text-right text-[9px] text-[var(--m-text-faint)]">
            {(pct * 100).toFixed(1)}% of context
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, accent, mono }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[var(--m-text-faint)]">{label}</span>
      <span
        className={[
          accent ? "text-[var(--m-accent)] font-semibold" : "text-[var(--m-text)]",
          mono ? "font-mono text-[10px]" : "",
        ].filter(Boolean).join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
