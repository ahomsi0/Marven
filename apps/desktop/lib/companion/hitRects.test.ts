import { describe, expect, it } from "vitest";
import { sameHitRects, toHitRects } from "./hitRects";

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
