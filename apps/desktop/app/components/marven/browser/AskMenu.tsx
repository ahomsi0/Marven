"use client";

import { useT } from "@/lib/i18n";

export type AskKind = "ask" | "summarise";

interface AskMenuProps {
  busy: boolean;
  failed: boolean;
  onPick: (kind: AskKind) => void;
}

const item =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[12px] text-[var(--m-text)] transition-colors hover:bg-[var(--m-surface-2)] disabled:opacity-50 disabled:hover:bg-transparent";

/** "Ask Marven" menu: send the current page to the chat input. */
export function AskMenu({ busy, failed, onPick }: AskMenuProps) {
  const { t } = useT();

  return (
    <div role="menu" className="absolute end-0 top-full z-30 mt-1 w-60 rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] p-1.5 shadow-lg">
      <button type="button" role="menuitem" autoFocus disabled={busy} className={item} onClick={() => onPick("ask")}>
        <svg className="h-3.5 w-3.5 shrink-0 text-[var(--m-text-muted)]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        {t("browser.askAboutPage")}
      </button>
      <button type="button" role="menuitem" disabled={busy} className={item} onClick={() => onPick("summarise")}>
        <svg className="h-3.5 w-3.5 shrink-0 text-[var(--m-text-muted)]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden>
          <path d="M5 6h14M5 10h14M5 14h9M5 18h6" />
        </svg>
        {t("browser.summarisePage")}
      </button>
      {(busy || failed) && (
        <p role="status" className={`px-2 pb-0.5 pt-1.5 text-[11px] ${failed ? "text-red-400/90" : "text-[var(--m-text-faint)]"}`}>
          {failed ? t("browser.askFailed") : t("browser.readingPage")}
        </p>
      )}
    </div>
  );
}
