import { describe, it, expect } from "vitest";
import { fitMenu, MENU_MARGIN } from "./menuFit";

const W = 420;

describe("fitMenu", () => {
  it("opens at full width from the picker when there's room", () => {
    expect(fitMenu({ left: 100, right: 220 }, 1400, W)).toEqual({ width: W, shift: 0 });
  });

  it("shifts toward the start when the picker is near the far edge", () => {
    // Room to the right is 1000 - 8 - 800 = 192, so it moves 420 - 192 = 228 left.
    const { width, shift } = fitMenu({ left: 800, right: 900 }, 1000, W);
    expect(width).toBe(W);
    expect(shift).toBe(228);
    expect(800 - shift + width).toBeLessThanOrEqual(1000 - MENU_MARGIN);
  });

  it("narrows to the window and never shifts past the window's start edge", () => {
    const { width, shift } = fitMenu({ left: 200, right: 300 }, 300, W);
    expect(width).toBe(300 - MENU_MARGIN * 2);
    expect(200 - shift).toBeGreaterThanOrEqual(MENU_MARGIN);
  });

  it("mirrors the maths for right-to-left layouts", () => {
    // RTL opens from the picker's right edge toward the left; room is right - 8.
    const { width, shift } = fitMenu({ left: 60, right: 160 }, 1000, W, true);
    expect(width).toBe(W);
    expect(shift).toBe(W - (160 - MENU_MARGIN));
  });
});
