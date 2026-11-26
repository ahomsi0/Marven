"use client";

// Linux only: keep the main process told where Mini Me's `[data-hit]` elements
// are, so it can shape the window to them (Linux has no forwarded mouse moves;
// see electron/companion.js). Anything that moves or resizes them (the bubble
// opening, closing or growing, the sprite's size or art style, the window
// resizing) is picked up by the observers below; updates are coalesced.

import { useEffect } from "react";
import type { RefObject } from "react";
import type { CompanionBridge, HitRect } from "@/lib/companion/bridge";
import { parseOutset, sameHitRects, toHitRects } from "@/lib/companion/hitRects";

const REPORT_DELAY_MS = 30;

export function useCompanionHitRects(bridge: CompanionBridge | null, enabled: boolean, rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !bridge || !root) return;
    let last: HitRect[] | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observed = new Set<Element>();

    const report = () => {
      timer = null;
      const rects = toHitRects(
        Array.from(root.querySelectorAll("[data-hit]"), (el) => {
          const box = el.getBoundingClientRect();
          // A shadow painted outside the box is declared with data-hit-outset (see lib/companion/hitRects.ts).
          return { left: box.left, top: box.top, width: box.width, height: box.height, outset: parseOutset(el.getAttribute("data-hit-outset")) };
        }),
      );
      if (sameHitRects(last, rects)) return;
      last = rects;
      bridge.setHitRects(rects);
    };
    const schedule = () => {
      if (!timer) timer = setTimeout(report, REPORT_DELAY_MS);
    };

    const resizes = new ResizeObserver(schedule);
    // Watch every [data-hit] element's size; the set changes as the bubble mounts and unmounts.
    const syncObserved = () => {
      const now = new Set(root.querySelectorAll("[data-hit]"));
      for (const el of observed) if (!now.has(el)) { resizes.unobserve(el); observed.delete(el); }
      for (const el of now) if (!observed.has(el)) { resizes.observe(el); observed.add(el); }
    };
    const mutations = new MutationObserver(() => {
      syncObserved();
      schedule();
    });
    mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-hit", "data-hit-outset", "class", "style"] });
    syncObserved();
    // The main process resets the shape when it resizes the window: always resend after a resize.
    const onResize = () => {
      last = null;
      schedule();
    };
    window.addEventListener("resize", onResize);
    schedule();

    return () => {
      if (timer) clearTimeout(timer);
      resizes.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [bridge, enabled, rootRef]);
}
