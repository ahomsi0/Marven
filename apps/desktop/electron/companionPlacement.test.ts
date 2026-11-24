import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import { ART_STYLES, ART_STYLE_IDS } from "@/lib/companion/art";
import { pixelScale } from "@/lib/companion/sprite";
import { DEFAULT_LOOK } from "@/lib/companion/look";

// companionPlacement.js is CommonJS (Electron main process).
const require = createRequire(import.meta.url);
type Rect = { x: number; y: number; width: number; height: number };
type Display = { id: number; workArea: Rect };
const P = require("./companionPlacement") as {
  windowSize: (scale: unknown, artStyle?: unknown) => { width: number; height: number };
  ART_SIZES: Record<string, number>;
  DEFAULT_ART_STYLE: string;
  pixelScale: (size: number, scale: number) => number;
  dockStrip: (wa: Rect, size: { width: number; height: number }) => { minX: number; maxX: number; y: number };
  clampToDisplays: (rect: Rect, displays: Display[]) => { x: number; y: number; displayId: number };
  isInDockStrip: (rect: Rect, wa: Rect) => boolean;
  dropMode: (v: unknown) => "stay" | "dock";
  fallSpeed: (tick: number, o?: { start?: number; accel?: number; max?: number }) => number;
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
    expect(P.windowSize(3, "chibi")).toEqual({ width: 360, height: 184 + 96 });
    expect(P.windowSize(2, "chibi")).toEqual({ width: 360, height: 184 + 64 });
    expect(P.windowSize(4, "chibi")).toEqual({ width: 360, height: 184 + 128 });
  });
  it("sizes 48-px art at whole-pixel steps of 1, 2 and 3", () => {
    expect(P.windowSize(2, "chibiLarge")).toEqual({ width: 360, height: 184 + 48 });
    expect(P.windowSize(3, "detailed")).toEqual({ width: 360, height: 184 + 96 });
    expect(P.windowSize(4, "chibiLarge")).toEqual({ width: 360, height: 184 + 144 });
  });
  it("falls back to 3x and the default art style for unknown values", () => {
    expect(P.windowSize(7, "chibi")).toEqual(P.windowSize(3, "chibi"));
    expect(P.windowSize(undefined, "chibi")).toEqual(P.windowSize(3, "chibi"));
    expect(P.windowSize(4, "anime")).toEqual(P.windowSize(4, DEFAULT_LOOK.artStyle));
    expect(P.windowSize(4, "constructor")).toEqual(P.windowSize(4, DEFAULT_LOOK.artStyle));
    expect(P.windowSize(4)).toEqual(P.windowSize(4, DEFAULT_LOOK.artStyle));
  });
  it("agrees with the renderer's art sizes, default style and pixel scale", () => {
    expect(P.DEFAULT_ART_STYLE).toBe(DEFAULT_LOOK.artStyle);
    expect(Object.keys(P.ART_SIZES).sort()).toEqual([...ART_STYLE_IDS].sort());
    for (const id of ART_STYLE_IDS) expect(P.ART_SIZES[id], id).toBe(ART_STYLES[id].size);
    for (const size of [32, 48, 64]) {
      for (const scale of [1, 2, 3, 4, 5]) expect(P.pixelScale(size, scale), `${size} ${scale}`).toBe(pixelScale(size, scale));
    }
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

describe("edge cases", () => {
  const narrow = { x: 10, y: 20, width: 300, height: 200 };
  const size = P.windowSize(3);
  it("keeps maxX >= minX on a narrow work area", () => {
    const s = P.dockStrip(narrow, size);
    expect(s.maxX).toBe(s.minX);
  });
  it("clamps x to the work area's left edge when the window is wider", () => {
    const r = P.clampToDisplays({ x: 500, y: 0, ...size }, [{ id: 1, workArea: narrow }]);
    expect(r.x).toBe(narrow.x);
  });
  it("falls back to default for NaN saved positions", () => {
    const d = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };
    expect(P.restorePosition({ x: NaN, y: 5, displayId: 1 }, [d], 1, size)).toEqual(P.restorePosition(null, [d], 1, size));
    expect(P.restorePosition({ x: 5, y: Infinity, displayId: 1 }, [d], 1, size)).toEqual(P.restorePosition(null, [d], 1, size));
  });
  it("always steps at least 1", () => {
    expect(P.stepToward(0, 10, 0)).toBe(1);
    expect(P.stepToward(0, 10, -3)).toBe(1);
  });
  it("coerces numeric-string scales", () => {
    expect(P.windowSize("4", "chibi")).toEqual(P.windowSize(4, "chibi"));
  });
});

describe("drop mode and falling", () => {
  it("only accepts dock; everything else stays", () => {
    expect(P.dropMode("dock")).toBe("dock");
    for (const v of ["stay", "", "DOCK", null, undefined, 1, {}]) expect(P.dropMode(v)).toBe("stay");
  });
  it("accelerates and caps", () => {
    expect(P.fallSpeed(0)).toBe(6);
    expect(P.fallSpeed(1)).toBeGreaterThan(P.fallSpeed(0));
    expect(P.fallSpeed(1000)).toBe(40);
    expect(P.fallSpeed(-5)).toBe(6);
  });
  it("lands on the dock strip y, same x, on the nearest display", () => {
    const d = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };
    const c = P.clampToDisplays({ x: 2000, y: 100, ...size }, [d]);
    expect(c.x).toBe(1440 - size.width);
    expect(P.dockStrip(d.workArea, size).y).toBe(900 - size.height);
  });
});

