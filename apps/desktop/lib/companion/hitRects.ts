// The window-shape rects Mini Me's page reports on Linux (see electron/companion.js):
// the bounding boxes of its `[data-hit]` elements, in window CSS pixels. An
// element whose paint spills outside its box (a shadow) says how far with
// `data-hit-outset="top right bottom left"` (px), so the shape doesn't clip it.

import type { HitRect } from "./bridge";

export interface Outset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Anything with a DOMRect's geometry (DOMRect itself in the browser), plus an optional outset. */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
  outset?: Outset | null;
}

const MAX_OUTSET_PX = 64;

/**
 * The speech bubble's `data-hit-outset`: Tailwind's `shadow-lg`
 * (`0 10px 15px -3px`, `0 4px 6px -4px`) reaches 15 - 3 = 12px to the sides,
 * 12 - 10 = 2px above and 12 + 10 = 22px below.
 */
export const BUBBLE_HIT_OUTSET = "2 12 22 12";

/** Parse a CSS-style 1–4 value px list (top right bottom left); null if absent or invalid. */
export function parseOutset(value: string | null | undefined): Outset | null {
  if (!value || !value.trim()) return null;
  const parts = value.trim().split(/\s+/);
  if (parts.length > 4) return null;
  const n = parts.map(Number);
  if (!n.every((v) => Number.isFinite(v) && v >= 0 && v <= MAX_OUTSET_PX)) return null;
  const [top, right = top, bottom = top, left = right] = n;
  return { top, right, bottom, left };
}

/** Visible boxes only (an element that isn't laid out has a 0×0 box), grown by any outset, rounded outwards. */
export function toHitRects(boxes: Iterable<RectLike>): HitRect[] {
  const out: HitRect[] = [];
  for (const b of boxes) {
    if (![b.left, b.top, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0) continue;
    const o = b.outset ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const x = Math.floor(b.left - o.left);
    const y = Math.floor(b.top - o.top);
    out.push({ x, y, width: Math.ceil(b.left + b.width + o.right) - x, height: Math.ceil(b.top + b.height + o.bottom) - y });
  }
  return out;
}

export function sameHitRects(a: readonly HitRect[] | null, b: readonly HitRect[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.width === b[i].width && r.height === b[i].height);
}
