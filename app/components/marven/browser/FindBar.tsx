"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import type { BrowserBridge, BrowserTab } from "@/lib/inAppBrowser";
import { ChevronDownIcon, CloseIcon } from "../Icons";

const iconButton =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * Find in page (⌘F), in a row above the page. Mount it per tab (key by tab
 * id): unmounting ends the search and clears its highlight.
 */
export function FindBar({
  bridge,
  tab,
  focusRequest,
  onClose,
}: {
  bridge: BrowserBridge;
  tab: BrowserTab;
  /** Bumped on every ⌘F, to focus the field again. */
  focusRequest: number;
  onClose: () => void;
}) {
  const { t } = useT();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const tabId = tab.id;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  useEffect(() => () => bridge.stopFind(tabId), [bridge, tabId]);

  const step = (forward: boolean) => {
    if (text) bridge.find(tabId, text, { forward, again: true });
  };
  const total = tab.find?.total ?? 0;
  const count = !text || !tab.find ? "" : total === 0 ? t("browser.findNone") : t("browser.findCount", { active: tab.find.active, total });

  return (
    <div role="search" className="flex h-9 shrink-0 items-center gap-1 border-b border-[var(--m-border-subtle)] px-2">
      <input
        ref={inputRef}
        dir="auto"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          bridge.find(tabId, e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            step(!e.shiftKey);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder={t("browser.findPlaceholder")}
        aria-label={t("browser.findPlaceholder")}
        className="h-7 min-w-0 flex-1 rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] px-2 text-[12px] text-[var(--m-text)] outline-none focus:border-[var(--m-accent)]/60"
      />
      <span aria-live="polite" className="shrink-0 px-1 text-[11px] tabular-nums text-[var(--m-text-faint)]">
        {count}
      </span>
      <button type="button" onClick={() => step(false)} disabled={total === 0} aria-label={t("browser.findPrevious")} title={t("browser.findPrevious")} className={iconButton}>
        <ChevronDownIcon className="h-3.5 w-3.5 rotate-180" />
      </button>
      <button type="button" onClick={() => step(true)} disabled={total === 0} aria-label={t("browser.findNext")} title={t("browser.findNext")} className={iconButton}>
        <ChevronDownIcon className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onClose} aria-label={t("browser.findClose")} title={t("browser.findClose")} className={iconButton}>
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
