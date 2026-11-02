"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { hostOf, type Bookmark, type BrowserBridge } from "@/lib/inAppBrowser";

interface BookmarksMenuProps {
  bridge: BrowserBridge;
  onOpen: (url: string) => void;
  onChanged: () => void;
}

export function BookmarksMenu({ bridge, onOpen, onChanged }: BookmarksMenuProps) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Bookmark[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    void bridge.listBookmarks(query).then((list) => {
      if (live) setItems(list);
    });
    return () => {
      live = false;
    };
  }, [bridge, query, version]);

  return (
    <div className="absolute end-0 top-full z-30 mt-1 w-72 rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] p-1.5 shadow-lg">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("browser.searchBookmarks")}
        aria-label={t("browser.searchBookmarks")}
        className="mb-1 h-7 w-full rounded-md border border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-2 text-[12px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-accent)]/60"
      />
      {items.length === 0 ? (
        <p className="px-2 py-3 text-center text-[12px] text-[var(--m-text-faint)]">{t("browser.noBookmarks")}</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto">
          {items.map((b) => (
            <li key={b.id} className="group flex items-center rounded-md hover:bg-[var(--m-surface-2)]">
              <button type="button" onClick={() => onOpen(b.url)} className="flex min-w-0 flex-1 flex-col items-start px-2 py-1.5 text-start">
                <span className="w-full truncate text-[12px] text-[var(--m-text)]">{b.title || b.url}</span>
                <span dir="ltr" className="w-full truncate text-[11px] text-[var(--m-text-faint)]">{hostOf(b.url)}</span>
              </button>
              <button
                type="button"
                aria-label={t("browser.removeBookmark")}
                title={t("browser.removeBookmark")}
                onClick={() =>
                  void bridge.removeBookmark(b.id).then(() => {
                    setVersion((v) => v + 1);
                    onChanged();
                  })
                }
                className="me-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--m-text-faint)] opacity-0 hover:text-[var(--m-text)] focus-visible:opacity-100 group-hover:opacity-100"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
