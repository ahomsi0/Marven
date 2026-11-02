"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GlobeIcon } from "../Icons";
import { useT } from "@/lib/i18n";
import { useAnyOverlayOpen } from "@/lib/overlays";
import { getBrowserBridge, type BrowserBounds } from "@/lib/inAppBrowser";
import { useBrowserSnapshot } from "./useBrowserSnapshot";
import { TabStrip } from "./TabStrip";
import { Toolbar } from "./Toolbar";
import { ErrorState } from "./ErrorState";

interface BrowserPanelProps {
  expanded: boolean;
  /** True while the panel's edge is being dragged. */
  resizing?: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
}

/**
 * In-app browser panel. Pages are native views (electron/browser/) that the
 * main process positions over `viewport`; this component draws the tabs and
 * toolbar from the main process's snapshot and keeps the view's bounds in sync.
 */
export function BrowserPanel({ expanded, resizing = false, onToggleExpand, onClose }: BrowserPanelProps) {
  const { t } = useT();
  const bridge = useMemo(getBrowserBridge, []);
  const snapshot = useBrowserSnapshot(bridge);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const overlayOpen = useAnyOverlayOpen();
  const [menuOpen, setMenuOpen] = useState(false);
  const [frozen, setFrozen] = useState<string | null>(null);
  const active = snapshot.tabs.find((tab) => tab.id === snapshot.activeId) ?? null;
  // A menu over the page, or a drag of the panel's edge (the native page
  // would swallow pointer moves that cross it), shows a screenshot instead.
  const covered = menuOpen || resizing;

  // Show the active page over the viewport and keep its bounds in sync; hide
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
    void bridge.show(rectOf());
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

  // Toolbar menus open over the page area; swap the page for a screenshot
  // while one is open so the menu isn't hidden under the native view. A
  // full-window overlay already hides the view, so it counts as no menu.
  // Declared after the bounds effect so `show()` is sent before `freeze()`.
  useEffect(() => {
    if (!bridge) return;
    if (!covered || overlayOpen) {
      setFrozen(null);
      bridge.unfreeze();
      return;
    }
    let live = true;
    void bridge.freeze().then((image) => {
      if (live) setFrozen(image);
    });
    return () => {
      live = false;
    };
  }, [bridge, covered, overlayOpen]);

  // Lets the main process handle browser shortcuts while focus is in the
  // toolbar (the page's own view handles them while the page has focus).
  useEffect(() => {
    const el = rootRef.current;
    if (!bridge || !el) return;
    const onIn = () => bridge.setFocused(true);
    const onOut = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) bridge.setFocused(false);
    };
    el.addEventListener("focusin", onIn);
    el.addEventListener("focusout", onOut);
    return () => {
      el.removeEventListener("focusin", onIn);
      el.removeEventListener("focusout", onOut);
      bridge.setFocused(false);
    };
  }, [bridge]);

  return (
    <div
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && expanded && !menuOpen && !e.defaultPrevented) onToggleExpand();
      }}
      className="flex h-full min-h-0 flex-col bg-[var(--m-bg)]"
    >
      {bridge && <TabStrip bridge={bridge} snapshot={snapshot} />}
      <Toolbar
        bridge={bridge}
        tab={active}
        downloads={snapshot.downloads}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        onClose={onClose}
        onMenuChange={setMenuOpen}
      />

      {/* The native page view is positioned over this element. */}
      <div ref={viewportRef} className="relative min-h-0 flex-1">
        {!bridge && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <GlobeIcon className="h-8 w-8 text-[var(--m-text-faint)]" />
            <p className="max-w-[280px] text-[13px] text-[var(--m-text-muted)]">{t("browser.desktopOnly")}</p>
          </div>
        )}
        {bridge && active?.error && <ErrorState error={active.error} onRetry={() => bridge.command(active.id, "retry")} />}
        {frozen && covered && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frozen} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover object-left-top" />
        )}
      </div>
    </div>
  );
}
