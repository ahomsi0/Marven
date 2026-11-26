// Where Mini Me's preview panel sits: docked beside his speech bubble (the
// "cloud"), bottom edges lined up, so the two read as one piece. On the side
// with room, and the same side as before while it still fits, so it doesn't
// flip as he walks. Pure, so it can be unit-tested.

const PREVIEW_SIZE = { width: 420, height: 300 };
/** Room above the sprite for the speech bubble (BUBBLE_SPACE in companionPlacement.js). */
const BUBBLE_SPACE = 184;
const GAP = 8;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @param {{ x: number, y: number, width: number, height: number }} companion  the companion window
 * @param {{ x: number, y: number, width: number, height: number }} workArea
 * @param {{ prefer?: 'left' | 'right', bubble?: { x: number, y: number, width: number, height: number } | null }} [opts]
 *   the side it's on now; the bubble's rect inside the companion window (null: dock to the sprite instead)
 * @returns {{ x: number, y: number, width: number, height: number, side: 'left' | 'right' }}
 */
function attachedBounds(companion, workArea, opts = {}, size = PREVIEW_SIZE) {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const cx = companion.x + companion.width / 2;
  let left;
  let right;
  let bottom;
  if (opts.bubble) {
    left = companion.x + opts.bubble.x;
    right = left + opts.bubble.width;
    bottom = companion.y + opts.bubble.y + opts.bubble.height;
  } else {
    const half = Math.max(0, companion.height - BUBBLE_SPACE) / 2;
    left = cx - half;
    right = cx + half;
    bottom = companion.y + companion.height;
  }
  const rightX = right + GAP;
  const leftX = left - GAP - width;
  const fitsRight = rightX + width <= workArea.x + workArea.width;
  const fitsLeft = leftX >= workArea.x;
  const roomier = workArea.x + workArea.width - cx >= cx - workArea.x ? 'right' : 'left';
  let side;
  if (opts.prefer === 'right' && fitsRight) side = 'right';
  else if (opts.prefer === 'left' && fitsLeft) side = 'left';
  else if (fitsRight && fitsLeft) side = roomier;
  else side = fitsRight ? 'right' : fitsLeft ? 'left' : roomier;
  return {
    x: Math.round(clamp(side === 'right' ? rightX : leftX, workArea.x, workArea.x + workArea.width - width)),
    y: Math.round(clamp(bottom - height, workArea.y, workArea.y + workArea.height - height)),
    width,
    height,
    side,
  };
}

/** A bubble rect from the companion page, or null when it isn't a sane one. */
function sanitizeBubbleRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const keys = ['x', 'y', 'width', 'height'];
  if (!keys.every((k) => typeof rect[k] === 'number' && Number.isFinite(rect[k]) && rect[k] >= -5000 && rect[k] <= 5000)) return null;
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

module.exports = { attachedBounds, sanitizeBubbleRect, PREVIEW_SIZE };
