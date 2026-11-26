import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { attachedBounds, sanitizeBubbleRect, PREVIEW_SIZE } = require("./previewPlacement");

const wa = { x: 0, y: 25, width: 1440, height: 875 };
// The companion window (360 × 280); his bubble is 320 wide, centred, above the sprite.
const at = (x: number) => ({ x, y: 600, width: 360, height: 280 });
const bubble = { x: 20, y: 40, width: 320, height: 130 };

describe("attachedBounds", () => {
  it("docks beside his bubble, bottom edges lined up", () => {
    const b = attachedBounds(at(100), wa, { bubble });
    expect(b.side).toBe("right");
    expect(b.x).toBe(100 + 20 + 320 + 8);
    expect(b.y + b.height).toBe(600 + 40 + 130);
    expect(b.width).toBe(PREVIEW_SIZE.width);
  });
  it("goes to the bubble's left when the right has no room", () => {
    const b = attachedBounds(at(1000), wa, { bubble });
    expect(b.side).toBe("left");
    expect(b.x + b.width).toBe(1000 + 20 - 8);
  });
  it("keeps its side while it still fits (no flipping as he walks)", () => {
    expect(attachedBounds(at(500), wa, { bubble, prefer: "left" }).side).toBe("left");
    expect(attachedBounds(at(500), wa, { bubble, prefer: "right" }).side).toBe("right");
  });
  it("without a bubble, docks to the sprite", () => {
    expect(attachedBounds(at(100), wa).x).toBe(100 + 180 + 48 + 8);
  });
  it("stays on screen when neither side fits", () => {
    const b = attachedBounds({ x: 0, y: 0, width: 360, height: 280 }, { x: 0, y: 0, width: 500, height: 400 }, { bubble });
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(500);
    expect(b.y).toBeGreaterThanOrEqual(0);
  });
});

describe("sanitizeBubbleRect", () => {
  it("keeps a sane rect and drops anything else", () => {
    expect(sanitizeBubbleRect({ ...bubble, extra: 1 })).toEqual(bubble);
    expect(sanitizeBubbleRect(null)).toBeNull();
    expect(sanitizeBubbleRect({ ...bubble, width: 0 })).toBeNull();
    expect(sanitizeBubbleRect({ ...bubble, x: Number.NaN })).toBeNull();
    expect(sanitizeBubbleRect({ ...bubble, y: "1" })).toBeNull();
  });
});
