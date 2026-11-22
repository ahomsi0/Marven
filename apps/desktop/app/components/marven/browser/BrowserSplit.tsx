"use client";

import { useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { BrowserPanel } from "./BrowserPanel";

const BROWSER_WIDTH_KEY = "marven-browser-width";
/** The browser panel's minimum width, and the space the content always keeps. */
export const BROWSER_MIN_WIDTH = 360;

interface BrowserSplitProps {
  open: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  /** The chat column (chat mode) or the agent workspace (agent mode). */
  children: ReactNode;
}

/**
 * Lays the in-app browser beside `children`: a resizable side panel, or the
 * whole row while expanded. Used by chat mode and agent mode, so both show the
 * same browser.
 */
export function BrowserSplit({ open, expanded, onToggleExpand, onClose, children }: BrowserSplitProps) {
  const { t } = useT();
  // Browser panel width in px, set by dragging its edge; null = half the row.
  const [width, setWidth] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = Number(localStorage.getItem(BROWSER_WIDTH_KEY));
      return saved >= BROWSER_MIN_WIDTH ? saved : null;
    } catch {
      return null;
    }
  });
  const [resizing, setResizing] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);

  // The content keeps at least BROWSER_MIN_WIDTH next to the browser.
  function clamp(value: number) {
    const row = rowRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const max = Math.max(BROWSER_MIN_WIDTH, row - BROWSER_MIN_WIDTH);
    return Math.round(Math.min(Math.max(value, BROWSER_MIN_WIDTH), max));
  }

  function save(value: number | null) {
    setWidth(value);
    try {
      if (value === null) localStorage.removeItem(BROWSER_WIDTH_KEY);
      else localStorage.setItem(BROWSER_WIDTH_KEY, String(value));
    } catch { /* best effort */ }
  }

  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    const row = rowRef.current;
    if (e.button !== 0 || !row) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rtl = document.documentElement.dir === "rtl";
    let latest: number | null = null;
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      const r = row.getBoundingClientRect();
      latest = clamp(rtl ? ev.clientX - r.left : r.right - ev.clientX);
      setWidth(latest);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizing(false);
      if (latest !== null) save(latest);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function nudge(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const rtl = document.documentElement.dir === "rtl";
    // The handle sits on the browser's start edge: moving it outward widens it.
    const grow = (e.key === "ArrowLeft") !== rtl;
    const current = width ?? asideRef.current?.getBoundingClientRect().width ?? BROWSER_MIN_WIDTH;
    save(clamp(current + (grow ? 24 : -24)));
  }

  return (
    <div ref={rowRef} className="flex min-h-0 flex-1 overflow-hidden">
      <div className={`flex min-w-0 flex-1 flex-col ${open && expanded ? "hidden" : ""}`}>{children}</div>
      {open && !expanded && (
        // A sibling of the aside, not inside it: the native page covers the
        // aside's interior and would take the pointer.
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("browser.resize")}
          aria-valuemin={BROWSER_MIN_WIDTH}
          aria-valuenow={width ?? undefined}
          title={t("browser.resize")}
          tabIndex={0}
          onPointerDown={startResize}
          onDoubleClick={() => save(null)}
          onKeyDown={nudge}
          className="relative z-10 -me-px w-1 shrink-0 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-[var(--m-accent)]/70 focus-visible:after:bg-[var(--m-accent)] active:after:bg-[var(--m-accent)]"
        />
      )}
      {open && (
        <aside
          ref={asideRef}
          className={
            expanded
              ? "flex min-w-0 flex-1 flex-col"
              : `flex min-w-[360px] flex-col border-s border-[var(--m-border)] ${width === null ? "w-1/2" : "shrink-0"}`
          }
          style={expanded || width === null ? undefined : { width, maxWidth: `calc(100% - ${BROWSER_MIN_WIDTH}px)` }}
        >
          <BrowserPanel expanded={expanded} resizing={resizing} onToggleExpand={onToggleExpand} onClose={onClose} />
        </aside>
      )}
    </div>
  );
}
