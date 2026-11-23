// electron/companionPlacement.js
//
// Pure geometry for the Mini Me companion window. No Electron imports, so it
// can be unit-tested. Rects and work areas are in screen points; a display is
// `{ id, workArea: { x, y, width, height } }`.

const SPRITE_SIZE = 32;      // sprite frame, in sprite pixels
const BUBBLE_SPACE = 184;    // room above the sprite for the speech bubble
const WINDOW_WIDTH = 360;
const DOCK_TOLERANCE = 24;   // how close to the strip a drop counts as "on the Dock"
const SCALES = [2, 3, 4];

function windowSize(scale) {
  const n = Number(scale);
  const s = SCALES.includes(n) ? n : 3;
  return { width: WINDOW_WIDTH, height: BUBBLE_SPACE + SPRITE_SIZE * s };
}

/** Where the window walks: its bottom edge on the work area's bottom edge (just above the Dock). */
function dockStrip(workArea, size) {
  const minX = workArea.x;
  return {
    minX,
    maxX: Math.max(minX, workArea.x + workArea.width - size.width),
    y: workArea.y + workArea.height - size.height,
  };
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The display the rect overlaps most, or the one whose centre is closest. */
function nearestDisplay(rect, displays) {
  let best = displays[0];
  let bestScore = -Infinity;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  for (const d of displays) {
    const wa = d.workArea;
    const overlap = overlapArea(rect, wa);
    const score = overlap > 0
      ? overlap
      : -Math.hypot(cx - (wa.x + wa.width / 2), cy - (wa.y + wa.height / 2));
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function clampToWorkArea(rect, wa) {
  return {
    x: Math.round(Math.max(wa.x, Math.min(rect.x, wa.x + wa.width - rect.width))),
    y: Math.round(Math.min(Math.max(rect.y, wa.y), wa.y + wa.height - rect.height)),
  };
}

function clampToDisplays(rect, displays) {
  const d = nearestDisplay(rect, displays);
  return { ...clampToWorkArea(rect, d.workArea), displayId: d.id };
}

function isInDockStrip(rect, workArea) {
  return Math.abs(rect.y - dockStrip(workArea, rect).y) <= DOCK_TOLERANCE;
}

function defaultPosition(primary, size) {
  const strip = dockStrip(primary.workArea, size);
  return { x: Math.max(strip.minX, strip.maxX - 40), y: strip.y, displayId: primary.id };
}

function restorePosition(saved, displays, primaryId, size) {
  const primary = displays.find((d) => d.id === primaryId) || displays[0];
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return defaultPosition(primary, size);
  const display = displays.find((d) => d.id === saved.displayId);
  if (!display) return defaultPosition(primary, size);
  return { ...clampToWorkArea({ x: saved.x, y: saved.y, ...size }, display.workArea), displayId: display.id };
}

function stepToward(current, target, maxStep) {
  maxStep = Math.max(1, maxStep);
  if (Math.abs(target - current) <= maxStep) return target;
  return current + Math.sign(target - current) * maxStep;
}

module.exports = {
  SPRITE_SIZE,
  BUBBLE_SPACE,
  WINDOW_WIDTH,
  windowSize,
  dockStrip,
  nearestDisplay,
  clampToDisplays,
  isInDockStrip,
  defaultPosition,
  restorePosition,
  stepToward,
};
