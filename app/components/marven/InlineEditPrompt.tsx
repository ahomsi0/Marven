"use client";

// InlineEditPrompt — Cursor-style ⌘K bar. Anchored at the bottom of the editor
// area as a command-bar (pragmatic v1 — see spec). Three states:
//   • input    — user types an instruction
//   • streaming — fetches from /api/agent/inline-edit, accumulates tokens
//   • review   — user can Accept (⏎) or Reject (Esc)
// Esc cancels at any state. Mid-stream Esc aborts the fetch via AbortController.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AIProvider } from "@/types";
import { stripCodeFences } from "@/lib/inlineEdit";

export interface InlineEditPromptProps {
  selection: string;
  language: string;
  provider: AIProvider;
  model: string;
  onAccept: (newText: string) => void;
  onReject: () => void;
  onStream?: (partial: string) => void;
}

type Phase = "input" | "streaming" | "review" | "error";

export function InlineEditPrompt({
  selection,
  language,
  provider,
  model,
  onAccept,
  onReject,
  onStream,
}: InlineEditPromptProps) {
  const [phase, setPhase] = useState<Phase>("input");
  const [instruction, setInstruction] = useState("");
  const [streamed, setStreamed] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Focus the input on mount.
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Cleanup any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const cleanedStreamed = stripCodeFences(streamed);

  const submit = useCallback(async () => {
    const text = instruction.trim();
    if (!text) return;
    setPhase("streaming");
    setStreamed("");
    setErrorMsg(null);
    onStream?.("");

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/agent/inline-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selection,
          instruction: text,
          language,
          provider,
          model,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let detail = "";
        try {
          const j = await res.json();
          detail = j?.error ?? "";
        } catch {
          detail = await res.text().catch(() => "");
        }
        throw new Error(detail || `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        // Drop the `__USAGE__{...}` sentinel emitted by some providers.
        const usageIdx = acc.indexOf("\n\n__USAGE__");
        const visible = usageIdx >= 0 ? acc.slice(0, usageIdx) : acc;
        setStreamed(visible);
        onStream?.(stripCodeFences(visible));
      }
      setPhase("review");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // User cancelled mid-stream — close the prompt cleanly.
        onReject();
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  }, [instruction, selection, language, provider, model, onStream, onReject]);

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // Global keyboard handler — Esc always closes; in review mode ⏎ accepts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (phase === "streaming") {
          cancelStream();
        } else {
          onReject();
        }
        return;
      }
      if (phase === "review" && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onAccept(cleanedStreamed);
      }
    }
    // Capture so we beat the editor textarea's own listeners.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase, cancelStream, onReject, onAccept, cleanedStreamed]);

  return (
    <div
      className="border-t border-[var(--m-border)] bg-[var(--m-surface)] shadow-[0_-4px_16px_rgba(0,0,0,0.25)]"
      data-testid="inline-edit-prompt"
    >
      {/* Header strip — small label and close button */}
      <div className="flex items-center gap-2 border-b border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-1">
        <svg
          className="h-3 w-3 text-[var(--m-accent)]"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 7.5L7 11.5 13 4.5" />
        </svg>
        <span className="text-[9px] uppercase tracking-[0.18em] text-[var(--m-text-faint)]">
          Inline edit
        </span>
        <span className="text-[10px] text-[var(--m-text-muted)]">{language || "auto"}</span>
        <span className="ml-auto rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-1.5 py-[1px] font-mono text-[9px] text-[var(--m-text-muted)]">
          {provider}
        </span>
        <button
          type="button"
          onClick={onReject}
          aria-label="Close inline edit"
          className="rounded p-0.5 text-[var(--m-text-faint)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Input row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          ref={inputRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && phase === "input") {
              e.preventDefault();
              submit();
            }
          }}
          disabled={phase === "streaming" || phase === "review"}
          placeholder="Describe the change…"
          spellCheck={false}
          className="flex-1 rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1.5 font-mono text-[12px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-accent)]/60 disabled:opacity-40"
        />
        {phase === "input" && (
          <button
            type="button"
            onClick={submit}
            disabled={!instruction.trim()}
            className="rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1 text-[10px] text-[var(--m-text-muted)] transition-colors hover:border-[var(--m-accent)]/60 hover:text-[var(--m-text)] disabled:opacity-40 disabled:hover:border-[var(--m-border)] disabled:hover:text-[var(--m-text-muted)]"
          >
            Rewrite <span className="ml-1 font-mono text-[9px]">⏎</span>
          </button>
        )}
        {phase === "streaming" && (
          <button
            type="button"
            onClick={cancelStream}
            className="rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1 text-[10px] text-[var(--m-text-muted)] transition-colors hover:border-red-400/40 hover:text-red-400"
          >
            Cancel <span className="ml-1 font-mono text-[9px]">Esc</span>
          </button>
        )}
        {phase === "review" && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onAccept(cleanedStreamed)}
              className="rounded border border-[var(--m-accent)]/60 bg-[var(--m-accent-soft)] px-2 py-1 text-[10px] text-[var(--m-accent)] transition-colors hover:bg-[var(--m-accent)]/20"
            >
              Accept <span className="ml-1 font-mono text-[9px]">⏎</span>
            </button>
            <button
              type="button"
              onClick={onReject}
              className="rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1 text-[10px] text-[var(--m-text-muted)] transition-colors hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)]"
            >
              Reject <span className="ml-1 font-mono text-[9px]">Esc</span>
            </button>
          </div>
        )}
      </div>

      {/* Streaming / review preview */}
      {(phase === "streaming" || phase === "review") && (
        <div className="border-t border-[var(--m-border-subtle)] bg-[var(--m-bg)]">
          <div className="flex items-center gap-2 px-3 py-1">
            {phase === "streaming" ? (
              <>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--m-accent)] opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--m-accent)]" />
                </span>
                <span className="text-[9px] uppercase tracking-[0.18em] text-[var(--m-text-faint)]">
                  AI is editing…
                </span>
              </>
            ) : (
              <span className="text-[9px] uppercase tracking-[0.18em] text-[var(--m-text-faint)]">
                Preview
              </span>
            )}
          </div>
          <pre className="marven-scroll max-h-[200px] overflow-auto px-3 pb-2 font-mono text-[12px] leading-6 text-[var(--m-text)] whitespace-pre-wrap">
            {cleanedStreamed || (phase === "streaming" ? " " : "")}
          </pre>
        </div>
      )}

      {/* Error state */}
      {phase === "error" && errorMsg && (
        <div className="border-t border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-[11px] text-red-400">
          {errorMsg}
        </div>
      )}
    </div>
  );
}
