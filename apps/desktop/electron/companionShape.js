// electron/companionShape.js
//
// Pure helpers for Mini Me's click-through on Linux. No Electron imports, so
// they can be unit-tested.
//
// macOS and Windows make the companion window ignore the mouse and *forward*
// mouse moves to the page, which turns the window interactive while the
// pointer is over Mini Me. Electron's `forward` option is macOS/Windows only,
// so on Linux the window is given a shape instead (`BrowserWindow.setShape`):
// the union of the page's `[data-hit]` rects (sprite, open bubble), padded a
// little. Outside the shape nothing is drawn and clicks fall through.
//
// All rects are `{ x, y, width, height }` in window DIPs (CSS pixels).

const { BUBBLE_SPACE } = require('./companionPlacement');

/** At most this many rects from the page (sprite + bubble today; room to spare). */
const MAX_HIT_RECTS = 8;
/** Extra room around each hit rect: the bubble's tail and shadow, anti-aliased edges. */
const HIT_PADDING = 8;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The rects a page sent, made safe: finite numbers only, clamped to the window,
 * rounded outwards to whole pixels, empty ones dropped, at most MAX_HIT_RECTS.
 * Anything that isn't an array gives [].
 */
function sanitizeHitRects(rects, size) {
  if (!Array.isArray(rects) || !size || !isNum(size.width) || !isNum(size.height)) return [];
  const out = [];
  // Look at a bounded number of entries; keep the first MAX_HIT_RECTS good ones.
  for (const r of rects.slice(0, MAX_HIT_RECTS * 4)) {
    if (out.length >= MAX_HIT_RECTS) break;
    if (!r || typeof r !== 'object') continue;
    const { x, y, width, height } = r;
    if (![x, y, width, height].every(isNum) || width <= 0 || height <= 0) continue;
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(size.width, Math.ceil(x + width));
    const bottom = Math.min(size.height, Math.ceil(y + height));
    if (right <= left || bottom <= top) continue;
    out.push({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return out;
}

/** Grow each rect by `padding` on every side, staying inside the window. */
function padRects(rects, size, padding = HIT_PADDING) {
  return sanitizeHitRects(
    rects.map((r) => ({ x: r.x - padding, y: r.y - padding, width: r.width + 2 * padding, height: r.height + 2 * padding })),
    size,
  );
}

/**
 * Where the sprite sits before the page has reported anything: a square at the
 * bottom centre, as tall as the window minus the bubble space.
 */
function defaultHitRects(size) {
  const sprite = Math.max(1, Math.min(size.width, size.height - BUBBLE_SPACE));
  return [{ x: Math.round((size.width - sprite) / 2), y: size.height - sprite, width: sprite, height: sprite }];
}

/**
 * The window shape for the rects a page sent: sanitized and padded. Never
 * empty: an empty shape would hide Mini Me entirely, so it falls back to the
 * default sprite box.
 */
function shapeFor(rects, size, padding = HIT_PADDING) {
  const clean = sanitizeHitRects(rects, size);
  return padRects(clean.length ? clean : defaultHitRects(size), size, padding);
}

function sameRects(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.width === b[i].width && r.height === b[i].height);
}

module.exports = {
  MAX_HIT_RECTS,
  HIT_PADDING,
  sanitizeHitRects,
  padRects,
  defaultHitRects,
  shapeFor,
  sameRects,
};
