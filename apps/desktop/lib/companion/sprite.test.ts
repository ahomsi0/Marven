import { describe, it, expect } from "vitest";
import { ANIMATIONS, OUTLINE, SPRITE_SIZE, renderFrame } from "./sprite";
import { DEFAULT_LOOK } from "./look";
import { ONESHOTS, type AnimState } from "./behaviour";

const at = (px: (string | null)[], x: number, y: number) => px[y * SPRITE_SIZE + x];

describe("renderFrame", () => {
  it("draws a 32x32 frame with a transparent corner", () => {
    const px = renderFrame(DEFAULT_LOOK, {});
    expect(px).toHaveLength(SPRITE_SIZE * SPRITE_SIZE);
    expect(at(px, 0, 0)).toBeNull();
  });
  it("draws glasses only when the look has them", () => {
    const look = { ...DEFAULT_LOOK, glasses: true, glassesColor: "#123456" };
    expect(at(renderFrame(look, {}), 11, 8)).toBe("#123456");
    expect(at(renderFrame({ ...look, glasses: false }, {}), 11, 8)).toBe(DEFAULT_LOOK.skin);
  });
  it("draws hair unless bald, with an outline above it", () => {
    expect(at(renderFrame({ ...DEFAULT_LOOK, hairStyle: "short" }, {}), 15, 4)).toBe(DEFAULT_LOOK.hair);
    expect(at(renderFrame({ ...DEFAULT_LOOK, hairStyle: "short" }, {}), 15, 3)).toBe(OUTLINE);
    expect(at(renderFrame({ ...DEFAULT_LOOK, hairStyle: "bald" }, {}), 15, 4)).toBe(OUTLINE);
  });
  it("lowers the body when sitting", () => {
    expect(at(renderFrame(DEFAULT_LOOK, {}), 15, 7)).toBe(DEFAULT_LOOK.skin);
    expect(at(renderFrame(DEFAULT_LOOK, { legs: "sit" }), 15, 7)).toBeNull();
  });
});

describe("ANIMATIONS", () => {
  it("has frames and a positive frame rate for every state", () => {
    for (const [state, anim] of Object.entries(ANIMATIONS)) {
      expect(anim.frames.length, state).toBeGreaterThan(0);
      expect(anim.fps, state).toBeGreaterThan(0);
    }
  });
  it("plays the one-shot states once", () => {
    expect(ANIMATIONS.stretch.loop).toBe(false);
    expect(ANIMATIONS.happy.loop).toBe(false);
    expect(ANIMATIONS.confused.loop).toBe(false);
  });
  it("loops exactly the states that are not one-shots", () => {
    for (const s of Object.keys(ANIMATIONS) as AnimState[]) {
      expect(ANIMATIONS[s].loop, s).toBe(!ONESHOTS.has(s));
    }
  });
});

describe("renderFrame art", () => {
  it("leaves a gap between arms and torso, filled by the outline", () => {
    const px = renderFrame(DEFAULT_LOOK, {});
    expect(at(px, 8, 18)).toBe(DEFAULT_LOOK.shirt);
    expect(at(px, 10, 18)).toBe(OUTLINE);
    expect(at(px, 11, 18)).toBe(DEFAULT_LOOK.shirt);
  });
  it("draws eyes over glasses lenses and a visible mouth on a beard", () => {
    const look = { ...DEFAULT_LOOK, glasses: true, beard: true };
    const px = renderFrame(look, { mouth: "open" });
    expect(at(px, 13, 9)).toBe(look.eyes);
    expect(at(px, 12, 9)).toBe("#cfe3f1");
    expect(at(px, 15, 13)).toBe("#f2e6da");
    expect(at(px, 15, 12)).toBe(OUTLINE);
    expect(at(renderFrame(DEFAULT_LOOK, {}), 15, 12)).toBe(OUTLINE);
  });
});
