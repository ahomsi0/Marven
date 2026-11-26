import { describe, it, expect } from "vitest";
import { createRequire } from "module";

// companionShape.js is CommonJS (Electron main process).
const require = createRequire(import.meta.url);
type Rect = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };
const S = require("./companionShape") as {
  MAX_HIT_RECTS: number;
  HIT_PADDING: number;
  sanitizeHitRects: (rects: unknown, size: Size) => Rect[];
  padRects: (rects: Rect[], size: Size, padding?: number) => Rect[];
  defaultHitRects: (size: Size) => Rect[];
  shapeFor: (rects: unknown, size: Size, padding?: number) => Rect[];
  sameRects: (a: unknown, b: unknown) => boolean;
};
const P = require("./companionPlacement") as { windowSize: (scale: unknown, artStyle?: unknown) => Size; BUBBLE_SPACE: number };

const size: Size = { width: 360, height: 280 };

describe("sanitizeHitRects", () => {
  it("keeps good rects, rounded outwards to whole pixels", () => {
    expect(S.sanitizeHitRects([{ x: 132.4, y: 184.6, width: 95.2, height: 95.4 }], size)).toEqual([
      { x: 132, y: 184, width: 96, height: 96 },
    ]);
  });
  it("clamps rects to the window", () => {
    expect(S.sanitizeHitRects([{ x: -10, y: -20, width: 400, height: 400 }], size)).toEqual([{ x: 0, y: 0, width: 360, height: 280 }]);
  });
  it("drops non-finite, non-numeric, empty and off-window rects", () => {
    expect(
      S.sanitizeHitRects(
        [
          null,
          "rect",
          { x: NaN, y: 0, width: 10, height: 10 },
          { x: 0, y: 0, width: Infinity, height: 10 },
          { x: "1", y: 0, width: 10, height: 10 },
          { x: 0, y: 0, width: 0, height: 10 },
          { x: 0, y: 0, width: 10, height: -5 },
          { x: 500, y: 0, width: 10, height: 10 },
          { x: 0, y: 300, width: 10, height: 10 },
          { x: 1, y: 2, width: 3, height: 4 },
        ],
        size,
      ),
    ).toEqual([{ x: 1, y: 2, width: 3, height: 4 }]);
  });
  it("returns [] for anything that isn't an array", () => {
    expect(S.sanitizeHitRects(undefined, size)).toEqual([]);
    expect(S.sanitizeHitRects({ x: 0, y: 0, width: 1, height: 1 }, size)).toEqual([]);
    expect(S.sanitizeHitRects("[]", size)).toEqual([]);
  });
  it("keeps at most MAX_HIT_RECTS", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ x: i, y: i, width: 5, height: 5 }));
    expect(S.sanitizeHitRects(many, size)).toHaveLength(S.MAX_HIT_RECTS);
    expect(S.MAX_HIT_RECTS).toBe(8);
  });
  it("only keeps the four geometry fields", () => {
    expect(S.sanitizeHitRects([{ x: 1, y: 1, width: 2, height: 2, evil: true }], size)[0]).toEqual({ x: 1, y: 1, width: 2, height: 2 });
  });
});

describe("defaultHitRects", () => {
  it("is the sprite square at the bottom centre of the window", () => {
    for (const [scale, style] of [[2, "chibi"], [3, "chibiLarge"], [4, "chibiLarge"], [3, "detailed"]] as const) {
      const s = P.windowSize(scale, style);
      const sprite = s.height - P.BUBBLE_SPACE;
      expect(S.defaultHitRects(s), `${scale} ${style}`).toEqual([
        { x: (360 - sprite) / 2, y: P.BUBBLE_SPACE, width: sprite, height: sprite },
      ]);
    }
  });
});

describe("shapeFor", () => {
  it("pads each rect, staying inside the window", () => {
    const sprite = { x: 132, y: 184, width: 96, height: 96 };
    const bubble = { x: 20, y: 40, width: 320, height: 120 };
    expect(S.shapeFor([bubble, sprite], size)).toEqual([
      { x: 12, y: 32, width: 336, height: 136 },
      // The bottom edge is the window's: no padding below it.
      { x: 124, y: 176, width: 112, height: 104 },
    ]);
  });
  it("falls back to the default sprite box when nothing usable was sent", () => {
    const fallback = S.padRects(S.defaultHitRects(size), size);
    expect(S.shapeFor([], size)).toEqual(fallback);
    expect(S.shapeFor(null, size)).toEqual(fallback);
    expect(S.shapeFor([{ x: NaN, y: 0, width: 1, height: 1 }], size)).toEqual(fallback);
    expect(fallback.length).toBe(1);
  });
  it("never returns an empty shape", () => {
    expect(S.shapeFor([{ x: 9999, y: 9999, width: 1, height: 1 }], size).length).toBeGreaterThan(0);
  });
});

describe("sameRects", () => {
  it("compares geometry in order", () => {
    const a = [{ x: 1, y: 2, width: 3, height: 4 }];
    expect(S.sameRects(a, [{ x: 1, y: 2, width: 3, height: 4 }])).toBe(true);
    expect(S.sameRects(a, [{ x: 1, y: 2, width: 3, height: 5 }])).toBe(false);
    expect(S.sameRects(a, [])).toBe(false);
    expect(S.sameRects(null, a)).toBe(false);
  });
});
