"use client";

import { useEffect, useRef, useState } from "react";
import packageJson from "@/package.json";
import { getRelease } from "@/lib/changelog";
import type { ChangeTag } from "@/lib/changelog";

const STORAGE_KEY = "marven_last_seen_version";

// Colour config for each tag type
const TAG_STYLE: Record<ChangeTag, { bg: string; text: string; label: string }> = {
  new: { bg: "bg-[#98c379]/10", text: "text-[#98c379]", label: "NEW" },
  fix: { bg: "bg-[#e5c07b]/10", text: "text-[#e5c07b]", label: "FIX" },
  imp: { bg: "bg-[#61afef]/10", text: "text-[#61afef]", label: "IMP" },
};

export function WhatsNewCard() {
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const version = packageJson.version;
  const release = getRelease(version);

  useEffect(() => {
    if (!release) return;
    const seen = localStorage.getItem(STORAGE_KEY);
    if (seen !== version) {
      setVisible(true);
    }
  }, [version, release]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  function dismiss() {
    setDismissing(true);
    localStorage.setItem(STORAGE_KEY, version);
    timerRef.current = setTimeout(() => setVisible(false), 150);
  }

  if (!visible || !release) return null;

  return (
    <div
      className={`fixed bottom-5 right-5 z-50 w-64 rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] shadow-2xl transition-all duration-150 ${
        dismissing ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"
      }`}
      style={{ animation: dismissing ? undefined : "whatsNewIn 0.2s ease-out" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--m-border-subtle)] px-3 py-2">
        <span className="text-[11px] font-semibold tracking-wide text-[var(--m-text)]">
          ✦ What&apos;s new in v{version}
        </span>
        <button
          type="button"
          onClick={dismiss}
          className="text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)] text-base leading-none"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      {/* Items */}
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {release.items.map((item, i) => {
          const s = TAG_STYLE[item.tag];
          return (
            <div key={i} className="flex items-center gap-2">
              <span
                className={`shrink-0 rounded px-1.5 py-px text-[9px] font-semibold tracking-widest ${s.bg} ${s.text}`}
              >
                {s.label}
              </span>
              <span className="text-[11px] text-[var(--m-text-muted)]">{item.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
