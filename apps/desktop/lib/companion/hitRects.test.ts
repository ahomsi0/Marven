import { describe, expect, it } from "vitest";
import { BUBBLE_HIT_OUTSET, parseOutset, sameHitRects, toHitRects } from "./hitRects";

describe("toHitRects", () => {
  it("rounds boxes outwards to whole pixels", () => {
    expect(toHitRects([{ left: 132.5, top: 184.25, width: 95.5, height: 95.5 }])).toEqual([
      { x: 132, y: 184, width: 96, height: 96 },
    ]);
  });
  it("skips boxes that aren't laid out or aren't finite", () => {
    expect(
      toHitRects([
        { left: 0, top: 0, width: 0, height: 0 },
        { left: NaN, top: 0, width: 10, height: 10 },
        { left: 20, top: 40, width: 320, height: 120 },
      ]),
    ).toEqual([{ x: 20, y: 40, width: 320, height: 120 }]);
  });
});

describe("sameHitRects", () => {
  const a = [{ x: 1, y: 2, width: 3, height: 4 }];
  it("compares geometry in order", () => {
    expect(sameHitRects(a, [{ x: 1, y: 2, width: 3, height: 4 }])).toBe(true);
    expect(sameHitRects(a, [{ x: 1, y: 3, width: 3, height: 4 }])).toBe(false);
    expect(sameHitRects(a, [])).toBe(false);
  });
  it("is false before anything was sent", () => {
    expect(sameHitRects(null, [])).toBe(false);
  });
});

describe("parseOutset", () => {
  it("reads CSS-style top/right/bottom/left px lists", () => {
    expect(parseOutset("2 12 22 12")).toEqual({ top: 2, right: 12, bottom: 22, left: 12 });
    expect(parseOutset("4")).toEqual({ top: 4, right: 4, bottom: 4, left: 4 });
    expect(parseOutset("4 8")).toEqual({ top: 4, right: 8, bottom: 4, left: 8 });
    expect(parseOutset("1 2 3")).toEqual({ top: 1, right: 2, bottom: 3, left: 2 });
  });
  it("is null for nothing, junk, negatives or silly sizes", () => {
    expect(parseOutset(null)).toBeNull();
    expect(parseOutset("")).toBeNull();
    expect(parseOutset("a b")).toBeNull();
    expect(parseOutset("-4")).toBeNull();
    expect(parseOutset("1 2 3 4 5")).toBeNull();
    expect(parseOutset("500")).toBeNull();
  });
});

describe("toHitRects with an outset", () => {
  it("grows the box by the outset (e.g. a shadow) before rounding", () => {
    expect(toHitRects([{ left: 20, top: 40, width: 320, height: 120, outset: { top: 2, right: 12, bottom: 22, left: 12 } }])).toEqual([
      { x: 8, y: 38, width: 344, height: 144 },
    ]);
  });
});

describe("BUBBLE_HIT_OUTSET", () => {
  it("covers Tailwind's shadow-lg (0 10px 15px -3px): 2 above, 12 at the sides, 22 below", () => {
    expect(parseOutset(BUBBLE_HIT_OUTSET)).toEqual({ top: 2, right: 12, bottom: 22, left: 12 });
  });
});
