import { describe, it, expect } from "vitest";
import { createRequire } from "module";

// companionPlacement.js is CommonJS (Electron main process).
const require = createRequire(import.meta.url);
type Rect = { x: number; y: number; width: number; height: number };
type Display = { id: number; workArea: Rect };
const P = require("./companionPlacement") as {
  windowSize: (scale: unknown) => { width: number; height: number };
  dockStrip: (wa: Rect, size: { width: number; height: number }) => { minX: number; maxX: number; y: number };
  clampToDisplays: (rect: Rect, displays: Display[]) => { x: number; y: number; displayId: number };
  isInDockStrip: (rect: Rect, wa: Rect) => boolean;
  restorePosition: (
    saved: unknown,
    displays: Display[],
    primaryId: number,
    size: { width: number; height: number },
  ) => { x: number; y: number; displayId: number };
  stepToward: (current: number, target: number, maxStep: number) => number;
};

const laptop: Display = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 800 } };
const external: Display = { id: 2, workArea: { x: 1440, y: 0, width: 1920, height: 1050 } };
const size = P.windowSize(3);

describe("windowSize", () => {
  it("is 360 wide with room for the bubble above the sprite", () => {
    expect(P.windowSize(3)).toEqual({ width: 360, height: 184 + 96 });
    expect(P.windowSize(2)).toEqual({ width: 360, height: 184 + 64 });
  });
  it("falls back to 3x for unknown scales", () => {
    expect(P.windowSize(7)).toEqual(P.windowSize(3));
    expect(P.windowSize(undefined)).toEqual(P.windowSize(3));
  });
});

describe("dockStrip", () => {
  it("puts the window's bottom edge on the work area's bottom edge", () => {
    expect(P.dockStrip(laptop.workArea, size)).toEqual({ minX: 0, maxX: 1080, y: 545 });
  });
});

describe("clampToDisplays", () => {
  it("pulls a window back onto a single display", () => {
    expect(P.clampToDisplays({ x: 2000, y: -50, ...size }, [laptop])).toEqual({ x: 1080, y: 25, displayId: 1 });
  });
  it("keeps a window that is on the second display", () => {
    expect(P.clampToDisplays({ x: 2000, y: 100, ...size }, [laptop, external])).toEqual({ x: 2000, y: 100, displayId: 2 });
  });
  it("moves a window from a removed display to the nearest remaining one", () => {
    expect(P.clampToDisplays({ x: 3000, y: 500, ...size }, [laptop])).toEqual({ x: 1080, y: 500, displayId: 1 });
  });
});

describe("isInDockStrip", () => {
  it("counts drops within 24pt of the strip", () => {
    expect(P.isInDockStrip({ x: 100, y: 545, ...size }, laptop.workArea)).toBe(true);
    expect(P.isInDockStrip({ x: 100, y: 525, ...size }, laptop.workArea)).toBe(true);
    expect(P.isInDockStrip({ x: 100, y: 400, ...size }, laptop.workArea)).toBe(false);
  });
});

describe("restorePosition", () => {
  it("defaults to the bottom right of the primary display", () => {
    expect(P.restorePosition(null, [laptop, external], 1, size)).toEqual({ x: 1040, y: 545, displayId: 1 });
  });
  it("uses the default when the saved display is gone", () => {
    expect(P.restorePosition({ x: 2000, y: 100, displayId: 2 }, [laptop], 1, size)).toEqual({ x: 1040, y: 545, displayId: 1 });
  });
  it("restores and clamps a saved position", () => {
    expect(P.restorePosition({ x: 5000, y: 100, displayId: 2 }, [laptop, external], 1, size)).toEqual({ x: 3000, y: 100, displayId: 2 });
  });
});

describe("stepToward", () => {
  it("moves at most maxStep and lands exactly on the target", () => {
    expect(P.stepToward(0, 10, 3)).toBe(3);
    expect(P.stepToward(9, 10, 3)).toBe(10);
    expect(P.stepToward(10, 0, 4)).toBe(6);
  });
});
