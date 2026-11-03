"use client";

import { useEffect, useRef, useState } from "react";
import { GlobeIcon } from "../Icons";
import { useT } from "@/lib/i18n";
import { hostOf, type BrowserBridge, type BrowserSnapshot } from "@/lib/inAppBrowser";

const isMac =
  typeof window !== "undefined" &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).marvenElectron?.platform === "darwin";

export function TabStrip({ bridge, snapshot }: { bridge: BrowserBridge; snapshot: BrowserSnapshot }) {
  const { t } = useT();
  const [dragId, setDragId] = useState<string | null>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());

  // Keep the active tab visible when the strip overflows.
  useEffect(() => {
    if (!snapshot.activeId) return;
    tabRefs.current.get(snapshot.activeId)?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [snapshot.activeId]);

  function focusTab(index: number) {
    const tab = snapshot.tabs[index];
    if (!tab) return;
    bridge.activateTab(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  }

  function onTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>, index: number, id: string) {
    const rtl = document.documentElement.dir === "rtl";
    const last = snapshot.tabs.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = rtl ? index + 1 : index - 1;
    else if (e.key === "ArrowRight") next = rtl ? index - 1 : index + 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next !== null) {
      e.preventDefault();
      focusTab(Math.min(Math.max(next, 0), last));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      bridge.activateTab(id);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      bridge.closeTab(id);
    }
  }

  return (
    <div
      role="tablist"
      aria-label={t("browser.tabs")}
      onWheel={(e) => {
        // Mouse wheels scroll vertically; move the strip sideways instead
        // (towards the end of the strip in either direction).
        if (e.deltaX !== 0 || e.deltaY === 0) return;
        e.currentTarget.scrollLeft += document.documentElement.dir === "rtl" ? -e.deltaY : e.deltaY;
      }}
      className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-[var(--m-border-subtle)] px-1.5 pt-1.5 [scrollbar-width:none]"
    >
      {snapshot.tabs.map((tab, index) => {
        const active = tab.id === snapshot.activeId;
        const label = tab.title || hostOf(tab.url) || t("browser.newTab");
        return (
          <div
            key={tab.id}
            ref={(el) => {
              if (el) tabRefs.current.set(tab.id, el);
              else tabRefs.current.delete(tab.id);
            }}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={label}
            draggable
            onDragStart={(e) => {
              setDragId(tab.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (dragId) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dragId !== tab.id) bridge.moveTab(dragId, index);
              setDragId(null);
            }}
            onDragEnd={() => setDragId(null)}
            onClick={() => bridge.activateTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) bridge.closeTab(tab.id);
            }}
            onKeyDown={(e) => onTabKeyDown(e, index, tab.id)}
            className={`group flex h-full min-w-[80px] max-w-[180px] flex-1 cursor-default items-center gap-1.5 rounded-t-md border border-b-0 px-2 text-[12px] ${
              active
                ? "border-[var(--m-border-subtle)] bg-[var(--m-surface)] text-[var(--m-text)]"
                : "border-transparent text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)]"
            }`}
          >
            {tab.loading ? (
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-[var(--m-text-faint)] border-t-[var(--m-text)]" />
            ) : tab.favicon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tab.favicon} alt="" className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <GlobeIcon className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <button
              type="button"
              tabIndex={-1}
              aria-label={t("browser.closeTab")}
              title={t("browser.closeTab")}
              onClick={(e) => {
                e.stopPropagation();
                bridge.closeTab(tab.id);
              }}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-[var(--m-surface-3)] ${
                active ? "" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        );
      })}
      {snapshot.canReopen && (
        <button
          type="button"
          onClick={() => bridge.reopenClosedTab()}
          aria-label={t("browser.reopenTab")}
          title={`${t("browser.reopenTab")} (${isMac ? "⇧⌘T" : "Ctrl+Shift+T"})`}
          className="mb-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
        >
          <svg className="h-3.5 w-3.5 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      )}
      <button
        type="button"
        onClick={() => void bridge.newTab()}
        aria-label={t("browser.newTab")}
        title={t("browser.newTab")}
        className="mb-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
