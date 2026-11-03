"use client";

// Tracks open full-window overlays (Settings, Language, search palette…).
// The in-app browser is a native view drawn above the page, so it hides while
// any overlay is open — otherwise the overlay would sit underneath the website.

import { useEffect, useSyncExternalStore } from "react";

let count = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Register an overlay for as long as the calling component is mounted (and `active`). */
export function useOverlayGuard(active = true) {
  useEffect(() => {
    if (!active) return;
    count += 1;
    emit();
    return () => {
      count -= 1;
      emit();
    };
  }, [active]);
}

/** True while at least one overlay is open. */
export function useAnyOverlayOpen(): boolean {
  return useSyncExternalStore(subscribe, () => count > 0, () => false);
}
