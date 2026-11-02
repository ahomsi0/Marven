"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GlobeIcon } from "./Icons";
import { useT } from "@/lib/i18n";
import { useAnyOverlayOpen } from "@/lib/overlays";
import { getBrowserBridge, normalizeBrowserInput, type BrowserBounds, type BrowserState } from "@/lib/inAppBrowser";

const LAST_URL_KEY = "marven-browser-last-url";
const HOME_URL = "https://duckduckgo.com/";

interface BrowserPanelProps {
  onClose: () => void;
}

/**
 * In-app browser panel. The page itself is a native view (electron/browserView.js)
 * that the main process positions over `viewport`; this component owns the
 * toolbar and keeps the native view's bounds in sync with the viewport.
 */
export function BrowserPanel({ onClose }: BrowserPanelProps) {
  const { t } = useT();
  const bridge = useMemo(getBrowserBridge, []);
  const viewportRef = useRef<HTMLDivElement>(null);
  const overlayOpen = useAnyOverlayOpen();
  const [state, setState] = useState<BrowserState>({ url: "", title: "", canGoBack: false, canGoForward: false, loading: false });
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);

  // Page state from the main process.
  useEffect(() => {
    if (!bridge) return;
    return bridge.onState((next) => {
      setState(next);
      if (next.url && next.url !== "about:blank") {
        try { localStorage.setItem(LAST_URL_KEY, next.url); } catch { /* best effort */ }
      }
    });
  }, [bridge]);

  useEffect(() => {
    if (!editing) setAddress(state.url === "about:blank" ? "" : state.url);
  }, [state.url, editing]);

  // Show the native view over the viewport and keep its bounds in sync; hide
  // it while a full-window overlay (Settings, Language…) is open — a native
  // view always draws above the page and would cover the overlay.
  useEffect(() => {
    const el = viewportRef.current;
    if (!bridge || !el) return;
    if (overlayOpen) {
      bridge.hide();
      return;
    }
    const rectOf = (): BrowserBounds => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    let last = "";
    const sync = () => {
      const b = rectOf();
      const key = `${b.x},${b.y},${b.width},${b.height}`;
      if (key === last) return;
      last = key;
      bridge.setBounds(b);
    };
    let start = HOME_URL;
    try { start = localStorage.getItem(LAST_URL_KEY) || HOME_URL; } catch { /* best effort */ }
    void bridge.show(rectOf(), start);
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener("resize", sync);
    // The viewport can move without resizing (e.g. the sidebar sliding).
    const poll = window.setInterval(sync, 250);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.clearInterval(poll);
      bridge.hide();
    };
  }, [bridge, overlayOpen]);

  function go(input: string) {
    const url = normalizeBrowserInput(input);
    if (!url || !bridge) return;
    setEditing(false);
    void bridge.navigate(url);
  }

  function openExternally() {
    const url = state.url && state.url !== "about:blank" ? state.url : normalizeBrowserInput(address);
    if (!url) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = (window as any).marvenElectron;
    if (el?.openExternal) void el.openExternal(url, "default").catch(() => {});
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  const tool =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--m-bg)]">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-[var(--m-border-subtle)] px-2">
        <button type="button" className={tool} disabled={!state.canGoBack} onClick={() => bridge?.command("back")} aria-label={t("browser.back")} title={t("browser.back")}>
          <svg className="h-4 w-4 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <button type="button" className={tool} disabled={!state.canGoForward} onClick={() => bridge?.command("forward")} aria-label={t("browser.forward")} title={t("browser.forward")}>
          <svg className="h-4 w-4 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
        </button>
        <button
          type="button"
          className={tool}
          disabled={!bridge}
          onClick={() => bridge?.command(state.loading ? "stop" : "reload")}
          aria-label={state.loading ? t("browser.stop") : t("browser.reload")}
          title={state.loading ? t("browser.stop") : t("browser.reload")}
        >
          {state.loading ? (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
          ) : (
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
          )}
        </button>

        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => { e.preventDefault(); go(address); }}
        >
          <input
            dir="ltr"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => { setEditing(true); e.currentTarget.select(); }}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === "Escape") { setEditing(false); e.currentTarget.blur(); } }}
            placeholder={t("browser.address")}
            aria-label={t("browser.address")}
            spellCheck={false}
            className="h-8 w-full rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] px-3 text-[12px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-accent)]/60"
          />
        </form>

        <button type="button" className={tool} onClick={openExternally} aria-label={t("browser.openExternal")} title={t("browser.openExternal")}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>
        </button>
        <button type="button" className={tool} onClick={onClose} aria-label={t("browser.close")} title={t("browser.close")}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>

      {/* The native page view is positioned over this element. */}
      <div ref={viewportRef} className="relative min-h-0 flex-1">
        {!bridge && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <GlobeIcon className="h-8 w-8 text-[var(--m-text-faint)]" />
            <p className="max-w-[280px] text-[13px] text-[var(--m-text-muted)]">{t("browser.desktopOnly")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
