"use client";

import { useEffect, useState } from "react";
import type { BrowserBridge, BrowserSnapshot } from "@/lib/inAppBrowser";

const EMPTY: BrowserSnapshot = { tabs: [], activeId: null, downloads: [], canReopenClosed: false };

/** The latest browser snapshot pushed by the main process. */
export function useBrowserSnapshot(bridge: BrowserBridge | null): BrowserSnapshot {
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>(EMPTY);

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    let pushed = false;
    const off = bridge.onSnapshot((next) => {
      pushed = true;
      if (live) setSnapshot(next);
    });
    // Pull once in case nothing changes for a while; a push always wins.
    void bridge.snapshot().then((next) => {
      if (live && next && !pushed) setSnapshot(next);
    });
    return () => {
      live = false;
      off();
    };
  }, [bridge]);

  return snapshot;
}
