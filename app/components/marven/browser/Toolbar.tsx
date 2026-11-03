"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { isWebUrl, type BrowserBridge, type BrowserDownload, type BrowserSnapshot, type BrowserTab } from "@/lib/inAppBrowser";
import { ATTACH_PAGE_EVENT, type PageAttachDetail } from "@/lib/pageAttachment";
import { SparkleIcon } from "../Icons";
import { AddressBar } from "./AddressBar";
import { AskMenu, type AskKind } from "./AskMenu";
import { BookmarksMenu } from "./BookmarksMenu";
import { DownloadsMenu } from "./DownloadsMenu";
import { useDismiss, type DismissReason } from "./useDismiss";

type Menu = "ask" | "bookmarks" | "downloads" | null;

interface ToolbarProps {
  bridge: BrowserBridge | null;
  tab: BrowserTab | null;
  downloads: BrowserDownload[];
  searchEngine: BrowserSnapshot["searchEngine"];
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  onMenuChange: (open: boolean) => void;
}

const tool =
  "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:opacity-30 disabled:hover:bg-transparent";

export function Toolbar({ bridge, tab, downloads, searchEngine, expanded, onToggleExpand, onClose, onMenuChange }: ToolbarProps) {
  const { t } = useT();
  const [menu, setMenu] = useState<Menu>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [bookmarkVersion, setBookmarkVersion] = useState(0);
  const menusRef = useRef<HTMLDivElement>(null);
  const downloadsButtonRef = useRef<HTMLButtonElement>(null);
  const bookmarksButtonRef = useRef<HTMLButtonElement>(null);
  const askButtonRef = useRef<HTMLButtonElement>(null);
  const [askBusy, setAskBusy] = useState(false);
  const [askFailed, setAskFailed] = useState(false);
  // Escape returns focus to the button that opened the menu; a click
  // elsewhere leaves focus wherever the user clicked.
  const closeMenu = useCallback(
    (reason: DismissReason) => {
      if (reason === "escape") {
        const button =
          menu === "downloads" ? downloadsButtonRef.current : menu === "ask" ? askButtonRef.current : bookmarksButtonRef.current;
        button?.focus();
      }
      setMenu(null);
    },
    [menu],
  );
  useDismiss(menusRef, menu !== null, closeMenu);

  useEffect(() => {
    onMenuChange(menu !== null || suggesting);
  }, [menu, suggesting, onMenuChange]);

  // "Ask Marven": read the page and hand it to the chat input (InputBar
  // listens for ATTACH_PAGE_EVENT). The chat is hidden while the browser is
  // expanded, so go back to the side panel first.
  const canAsk = !!bridge && !!tab && isWebUrl(tab.url) && !tab.error;

  useEffect(() => {
    setAskFailed(false);
  }, [menu, tab?.id, tab?.url]);

  // The page went away (error, blank tab) while the menu was open.
  useEffect(() => {
    if (!canAsk) setMenu((m) => (m === "ask" ? null : m));
  }, [canAsk]);

  const toggle = (next: Exclude<Menu, null>) => setMenu((m) => (m === next ? null : next));
  const askMarven = async (kind: AskKind) => {
    if (!bridge || !tab || askBusy) return;
    setAskBusy(true);
    setAskFailed(false);
    const page = await bridge.extractPage(tab.id).catch(() => null);
    setAskBusy(false);
    if (!page) {
      setAskFailed(true);
      return;
    }
    const detail: PageAttachDetail = kind === "summarise" ? { ...page, prompt: t("browser.summarisePrompt") } : page;
    setMenu(null);
    if (expanded) onToggleExpand();
    window.dispatchEvent(new CustomEvent<PageAttachDetail>(ATTACH_PAGE_EVENT, { detail }));
  };
  const active = downloads.filter((d) => d.state === "progressing");
  const totals = active.reduce((acc, d) => ({ got: acc.got + d.receivedBytes, all: acc.all + d.totalBytes }), { got: 0, all: 0 });
  const progress = totals.all > 0 ? totals.got / totals.all : 0;

  return (
    <div className="relative flex h-11 shrink-0 items-center gap-1 border-b border-[var(--m-border-subtle)] px-2">
      <button type="button" className={tool} disabled={!tab?.canGoBack} onClick={() => tab && bridge?.command(tab.id, "back")} aria-label={t("browser.back")} title={t("browser.back")}>
        <svg className="h-4 w-4 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <button type="button" className={tool} disabled={!tab?.canGoForward} onClick={() => tab && bridge?.command(tab.id, "forward")} aria-label={t("browser.forward")} title={t("browser.forward")}>
        <svg className="h-4 w-4 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
      </button>
      <button
        type="button"
        className={tool}
        disabled={!tab}
        onClick={() => tab && bridge?.command(tab.id, tab.loading ? "stop" : "reload")}
        aria-label={tab?.loading ? t("browser.stop") : t("browser.reload")}
        title={tab?.loading ? t("browser.stop") : t("browser.reload")}
      >
        {tab?.loading ? (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
        )}
      </button>

      <AddressBar key={tab?.id ?? "none"} bridge={bridge} tab={tab} searchEngine={searchEngine} bookmarkVersion={bookmarkVersion} onSuggestingChange={setSuggesting} />

      <div ref={menusRef} className="flex items-center gap-1">
        <div className="relative">
          <button
            ref={askButtonRef}
            type="button"
            className={tool}
            disabled={!canAsk}
            onClick={() => toggle("ask")}
            aria-haspopup="menu"
            aria-expanded={menu === "ask"}
            aria-label={t("browser.askMarven")}
            title={t("browser.askMarven")}
          >
            <SparkleIcon className="h-4 w-4" />
          </button>
          {menu === "ask" && canAsk && <AskMenu busy={askBusy} failed={askFailed} onPick={(kind) => void askMarven(kind)} />}
        </div>
        <div className="relative">
          <button ref={downloadsButtonRef} type="button" className={tool} disabled={!bridge} onClick={() => toggle("downloads")} aria-expanded={menu === "downloads"} aria-label={t("browser.downloads")} title={t("browser.downloads")}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" /></svg>
            {active.length > 0 && (
              <svg className="pointer-events-none absolute inset-0.5" viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--m-accent)" strokeWidth="1.5" strokeDasharray={`${progress * 66} 66`} transform="rotate(-90 12 12)" />
              </svg>
            )}
          </button>
          {menu === "downloads" && bridge && <DownloadsMenu bridge={bridge} downloads={downloads} />}
        </div>
        <div className="relative">
          <button ref={bookmarksButtonRef} type="button" className={tool} disabled={!bridge} onClick={() => toggle("bookmarks")} aria-expanded={menu === "bookmarks"} aria-label={t("browser.bookmarks")} title={t("browser.bookmarks")}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M7 4h10v16l-5-3.5L7 20V4z" /></svg>
          </button>
          {menu === "bookmarks" && bridge && (
            <BookmarksMenu
              bridge={bridge}
              onOpen={(url) => {
                if (tab) void bridge.navigate(tab.id, url);
                else void bridge.newTab(url);
                setMenu(null);
              }}
              onChanged={() => setBookmarkVersion((v) => v + 1)}
            />
          )}
        </div>
      </div>

      <button type="button" className={tool} onClick={onToggleExpand} aria-pressed={expanded} aria-label={expanded ? t("browser.collapse") : t("browser.expand")} title={expanded ? t("browser.collapse") : t("browser.expand")}>
        {expanded ? (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></svg>
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
        )}
      </button>
      <button type="button" className={tool} onClick={onClose} aria-label={t("browser.close")} title={t("browser.close")}>
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
  );
}
