"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

interface WorkspaceAccessButtonProps {
  trusted: boolean;
  onChange: (trusted: boolean) => void;
}

function LockGlyph({ open }: { open: boolean }) {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="1.5" />
      {open ? <path d="M8 11V7.5a4 4 0 0 1 7.6-1.7" /> : <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />}
    </svg>
  );
}

/**
 * Shows whether the agent may change this folder, and explains it on click.
 * Always visible, so switching to "Can edit" doesn't make the control vanish.
 */
export function WorkspaceAccessButton({ trusted, onChange }: WorkspaceAccessButtonProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("agent.accessTitle")}
        className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors hover:bg-[var(--m-surface-2)] ${
          trusted ? "text-[var(--m-text-muted)] hover:text-[var(--m-text)]" : "text-amber-300"
        }`}
      >
        <LockGlyph open={trusted} />
        {trusted ? t("agent.canEdit") : t("agent.readOnly")}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("agent.accessTitle")}
          className="absolute end-0 top-full z-50 mt-1.5 w-72 rounded-lg border border-[var(--m-border)] bg-[var(--m-surface-2)] p-3 shadow-2xl"
        >
          <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-[var(--m-text)]">
            <span className={trusted ? "text-[var(--m-text-muted)]" : "text-amber-300"}>
              <LockGlyph open={trusted} />
            </span>
            {trusted ? t("agent.canEdit") : t("agent.readOnly")}
          </div>
          <p className="text-[12px] leading-5 text-[var(--m-text-muted)]">
            {trusted ? t("agent.canEditBody") : t("agent.readOnlyBody")}
          </p>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                onChange(!trusted);
                setOpen(false);
              }}
              className={
                trusted
                  ? "rounded-md border border-[var(--m-border)] px-2.5 py-1 text-[12px] text-[var(--m-text)] transition-colors hover:bg-[var(--m-surface-3)]"
                  : "rounded-md bg-[var(--m-accent)] px-2.5 py-1 text-[12px] font-medium text-[var(--m-bg)] transition-opacity hover:opacity-90"
              }
            >
              {trusted ? t("agent.menuReadOnly") : t("agent.allowEdits")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
