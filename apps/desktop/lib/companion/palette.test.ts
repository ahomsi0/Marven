import { describe, it, expect } from "vitest";
import { FIXED, buildSlots, hexToRgba, mix, ramp, rgbaToHex, shift } from "./palette";

// Expected values were produced by running the artist's original palette.mjs
// (scripts/mini-me-art/art/palette.mjs) on the same inputs.

describe("hex helpers", () => {
  it("parses 3-, 6- and 8-digit hex", () => {
    expect(hexToRgba("#abc")).toEqual([170, 187, 204, 255]);
    expect(hexToRgba("#3d6fb6")).toEqual([61, 111, 182, 255]);
    expect(hexToRgba("#ffffffd0")).toEqual([255, 255, 255, 208]);
  });
  it("formats with alpha only when not opaque", () => {
    expect(rgbaToHex([61, 111, 182, 255])).toBe("#3d6fb6");
    expect(rgbaToHex([255, 255, 255, 208])).toBe("#ffffffd0");
    expect(rgbaToHex([1.4, 1.6, 0])).toBe("#010200");
  });
  it("mixes and shifts like the original", () => {
    expect(mix("#ff0000", "#0000ff", 0.5)).toBe("#800080");
    expect(shift("#3d6fb6", { dl: 0.1 })).toBe("#5d8ac9");
  });
});

describe("ramp", () => {
  it("derives a cloth ramp with warm light and cool shadows", () => {
    expect(ramp("#3d6fb6")).toEqual({ light: "#639ac8", base: "#3d6fb6", shadow: "#2b3f8b", dark: "#171d4a" });
    expect(ramp("#9a9a9f")).toEqual({ light: "#b8b8b9", base: "#9a9a9f", shadow: "#7e7e7e", dark: "#3f3f3f" });
    expect(ramp("#e2bd5e")).toEqual({ light: "#e9dc8f", base: "#e2bd5e", shadow: "#cc9337", dark: "#633a1d" });
  });
  it("drops very light bases further for their shadows", () => {
    expect(ramp("#f4f1ea")).toEqual({ light: "#ffffff", base: "#f4f1ea", shadow: "#d2c9ba", dark: "#6f5c50" });
  });
  it("lifts near-black bases so black hair still has a sheen", () => {
    expect(ramp("#14110f")).toEqual({ light: "#5f5549", base: "#322a25", shadow: "#1e1715", dark: "#140f0f" });
    expect(ramp("#000000")).toEqual({ light: "#545454", base: "#2b2b2b", shadow: "#1a1818", dark: "#111111" });
    expect(ramp("#2b1d14")).toEqual({ light: "#715538", base: "#3b281c", shadow: "#241310", dark: "#180c0b" });
  });
  it("uses the skin ramp for skin", () => {
    expect(ramp("#e0ac7e", "skin")).toEqual({ light: "#e4c39d", base: "#e0ac7e", shadow: "#d1825f", dark: "#6d2c1f" });
    expect(ramp("#80513a", "skin")).toEqual({ light: "#94674a", base: "#80513a", shadow: "#5c3730", dark: "#311a19" });
  });
});

describe("buildSlots", () => {
  const colours = { skin: "#e0ac7e", hair: "#2b1d14", eyes: "#1b1b1f", shirt: "#3d6fb6", pants: "#2f3a56", shoes: "#1f1f24" };
  it("expands base colours into the full slot table", () => {
    expect(buildSlots({ ...colours, glasses: "#c0392b" })).toEqual({
      o: "#2a1f2d", W: "#f6f3ef", L: "#ffffff", Y: "#f1ece4", y: "#bdb4ab", l: "#ffffffd0", Z: "#f6f7fc", Q: "#ffc93c",
      S: "#e4c39d", s: "#e0ac7e", t: "#d1825f", u: "#552218", M: "#b54d36", K: "#ec9983",
      H: "#715538", h: "#3b281c", j: "#241310", k: "#180c0b",
      E: "#28282e", e: "#100f13", I: "#515058",
      B: "#639ac8", b: "#3d6fb6", n: "#2b3f8b", N: "#171d4a",
      P: "#455a78", p: "#2f3a56", q: "#181a30",
      F: "#514f59", f: "#28282f", v: "#18171c",
      G: "#c0392b", g: "#bfe0f240",
    });
  });
  it("falls back to a dark frame and keeps the fixed slots", () => {
    const slots = buildSlots(colours);
    expect(slots.G).toBe("#2b2b33");
    for (const [k, v] of Object.entries(FIXED)) expect(slots[k], k).toBe(v);
  });
});
