"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  SEARCH_URL, hostOf, isWebUrl, normalizeBrowserInput, type BrowserBridge, type BrowserTab, type Suggestion,
} from "@/lib/inAppBrowser";

interface Row {
  kind: Suggestion["kind"] | "search";
  url: string;
  title: string;
}

interface AddressBarProps {
  bridge: BrowserBridge | null;
  tab: BrowserTab | null;
  bookmarkVersion: number;
  onSuggestingChange: (open: boolean) => void;
}

export function AddressBar({ bridge, tab, bookmarkVersion, onSuggestingChange }: AddressBarProps) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [bookmarked, setBookmarked] = useState(false);
  const url = tab?.url ?? "";
  const web = isWebUrl(url);

  useEffect(() => {
    if (!editing) setText(web ? url : "");
  }, [url, web, editing]);

  useEffect(() => {
    if (!bridge || !web) {
      setBookmarked(false);
      return;
    }
    let live = true;
    void bridge.isBookmarked(url).then((value) => {
      if (live) setBookmarked(value);
    });
    return () => {
      live = false;
    };
  }, [bridge, url, web, bookmarkVersion]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onFocusAddress(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [bridge]);

  const query = editing ? text.trim() : "";
  useEffect(() => {
    if (!bridge || !query) {
      setSuggestions([]);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      void bridge.suggest(query).then((list) => {
        if (!live) return;
        setSuggestions(list);
        setHighlight(-1);
      });
    }, 80);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [bridge, query]);

  const rows: Row[] = query
    ? [...suggestions, { kind: "search", url: SEARCH_URL + encodeURIComponent(query), title: t("browser.searchFor", { query }) }]
    : [];
  const open = rows.length > 0;

  useEffect(() => {
    onSuggestingChange(open);
  }, [open, onSuggestingChange]);

  function go(target: string | null) {
    const next = target ?? normalizeBrowserInput(text);
    if (!next || !bridge) return;
    setEditing(false);
    inputRef.current?.blur();
    if (tab) void bridge.navigate(tab.id, next);
    else void bridge.newTab(next);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setHighlight((h) => (h + 1) % rows.length);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? rows.length - 1 : h - 1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
      e.currentTarget.blur();
    }
  }

  const blockedLabel = tab?.blockingEnabled ? t("browser.blocked", { count: tab.blocked }) : t("browser.blockingOff");

  return (
    <form
      className="relative min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        go(highlight >= 0 ? rows[highlight]?.url ?? null : null);
      }}
    >
      <div className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] ps-2.5 pe-1 focus-within:border-[var(--m-accent)]/60">
        {url.startsWith("https://") && !editing && (
          <svg className="h-3 w-3 shrink-0 text-[var(--m-text-faint)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-label={t("browser.secure")}>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        )}
        <input
          ref={inputRef}
          dir="ltr"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setEditing(true);
          }}
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={onKeyDown}
          placeholder={t("browser.address")}
          aria-label={t("browser.address")}
          aria-expanded={open}
          aria-autocomplete="list"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)]"
        />
        {tab && web && !editing && (
          <>
            <button
              type="button"
              onClick={() => bridge?.setBlocking(hostOf(url), !tab.blockingEnabled)}
              title={tab.blockingEnabled ? `${blockedLabel}. ${t("browser.blockedHint")}` : blockedLabel}
              aria-label={blockedLabel}
              aria-pressed={tab.blockingEnabled}
              className={`flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] tabular-nums transition-colors ${
                tab.blockingEnabled
                  ? "text-[var(--m-local)] hover:bg-[var(--m-surface-2)]"
                  : "text-[var(--m-text-faint)] hover:bg-[var(--m-surface-2)]"
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
                <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
                {!tab.blockingEnabled && <path d="M4 4l16 16" strokeLinecap="round" />}
              </svg>
              {tab.blockingEnabled && tab.blocked > 0 && <span>{tab.blocked}</span>}
            </button>
            <button
              type="button"
              onClick={() => bridge && void bridge.toggleBookmark(url, tab.title).then(setBookmarked)}
              title={bookmarked ? t("browser.removeBookmark") : t("browser.bookmarkPage")}
              aria-label={bookmarked ? t("browser.removeBookmark") : t("browser.bookmarkPage")}
              aria-pressed={bookmarked}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
            >
              <svg className="h-3.5 w-3.5" fill={bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
                <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" />
              </svg>
            </button>
          </>
        )}
      </div>

      {open && (
        <ul
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] py-1 shadow-lg"
        >
          {rows.map((row, i) => (
            <li
              key={`${row.kind}:${row.url}`}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                go(row.url);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex cursor-default items-center gap-2 px-2.5 py-1.5 text-[12px] ${
                i === highlight ? "bg-[var(--m-surface-2)]" : ""
              }`}
            >
              <span className="w-3.5 shrink-0 text-center text-[var(--m-text-faint)]" aria-hidden>
                {row.kind === "bookmark" ? "★" : row.kind === "history" ? "↺" : "⌕"}
              </span>
              <span className="min-w-0 truncate text-[var(--m-text)]">{row.title || row.url}</span>
              {row.kind !== "search" && (
                <span dir="ltr" className="min-w-0 shrink truncate text-[var(--m-text-faint)]">
                  {hostOf(row.url)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
