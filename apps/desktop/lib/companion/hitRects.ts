// The window-shape rects Mini Me's page reports on Linux (see electron/companion.js):
// the bounding boxes of its `[data-hit]` elements, in window CSS pixels.

import type { HitRect } from "./bridge";

/** Anything with a DOMRect's geometry (DOMRect itself in the browser). */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Visible boxes only (an element that isn't laid out has a 0×0 box), rounded outwards to whole pixels. */
export function toHitRects(boxes: Iterable<RectLike>): HitRect[] {
  const out: HitRect[] = [];
  for (const b of boxes) {
    if (![b.left, b.top, b.width, b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0) continue;
    const x = Math.floor(b.left);
    const y = Math.floor(b.top);
    out.push({ x, y, width: Math.ceil(b.left + b.width) - x, height: Math.ceil(b.top + b.height) - y });
  }
  return out;
}

export function sameHitRects(a: readonly HitRect[] | null, b: readonly HitRect[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.width === b[i].width && r.height === b[i].height);
}
