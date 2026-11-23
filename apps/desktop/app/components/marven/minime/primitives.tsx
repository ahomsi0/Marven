"use client";

import type { ReactNode } from "react";

/** Settings card: matches the other Settings pages. */
export function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-surface)] p-4">
      <h3 className="text-[13px] font-medium text-[var(--m-text)]">{title}</h3>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--m-text-faint)]">{hint}</p>}
      <div className="mt-3 space-y-3 border-t border-[var(--m-border-subtle)] pt-3">{children}</div>
    </section>
  );
}

/** A label (with optional hint) on one side and its control on the other. */
export function Row({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div id={id} className="text-[12px] text-[var(--m-text)]">{label}</div>
        {hint && <p className="mt-0.5 text-[11px] leading-snug text-[var(--m-text-faint)]">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Switch({
  labelledBy,
  checked,
  onChange,
}: {
  labelledBy: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-labelledby={labelledBy}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--m-accent-soft)] ${
        checked ? "bg-[var(--m-accent)]" : "bg-[var(--m-border)]"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-5 rtl:-translate-x-5" : "translate-x-1 rtl:-translate-x-1"
        }`}
      />
    </button>
  );
}
