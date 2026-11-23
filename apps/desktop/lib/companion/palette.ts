// Mini Me palette: turns a handful of base colours into the full slot table
// the sprite grids are painted with. A faithful port of the artist's
// scripts/mini-me-art/art/palette.mjs; keep the two in step.
//
// Every pixel in a grid is a one-character slot code:
//   .  transparent            _  erase (punch a hole in layers below)
//   o  outline
//   S s t u   skin   light / base / shadow / dark
//   M  mouth          K  blush
//   H h j k   hair   light / base / shadow / dark
//   W  eye white   E  iris   e  pupil   I  iris light   L  eye highlight
//   B b n N   shirt  light / base / shadow / dark
//   P p q     pants  light / base / shadow
//   F f v     shoes  light / base / shadow
//   Y y       sole   light / shadow
//   G  glasses frame   g  lens (semi-transparent)   l  lens glare
//   Z  effect white    Q  effect gold

export type Rgba = [number, number, number, number];

export interface Ramp {
  light: string;
  base: string;
  shadow: string;
  dark: string;
}

export interface SlotColours {
  skin: string;
  hair: string;
  eyes: string;
  shirt: string;
  pants: string;
  shoes: string;
  /** Glasses frame. */
  glasses?: string;
  lens?: string;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function hexToRgba(hex: string): Rgba {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

export function rgbaToHex([r, g, b, a = 255]: number[]): string {
  const x = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  return "#" + x(r) + x(g) + x(b) + (a === 255 ? "" : x(a));
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Rotate hue `h` toward `target` by at most `amount` degrees (shortest way). */
function hueToward(h: number, target: number, amount: number) {
  const d = ((target - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), amount);
}

interface Shift {
  dl?: number;
  ds?: number;
  toward?: number | null;
  by?: number;
}

/** Shift a colour: dl = lightness delta, ds = saturation delta, hue drift toward `toward`. */
export function shift(hex: string, { dl = 0, ds = 0, toward = null, by = 0 }: Shift = {}): string {
  const [r, g, b, a] = hexToRgba(hex);
  let [h, s, l] = rgbToHsl(r, g, b);
  if (toward !== null && s > 0.04) h = hueToward(h, toward, by);
  s = clamp(s + ds);
  l = clamp(l + dl);
  return rgbaToHex([...hslToRgb(h, s, l), a]);
}

export function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgba(hexA);
  const b = hexToRgba(hexB);
  return rgbaToHex(a.map((v, i) => v + (b[i] - v) * t));
}

/**
 * A 4-step ramp from one base colour. Light tones drift warm, shadows cool.
 * Near-black bases are lifted first so black hair still shows a sheen.
 */
export function ramp(hex: string, kind: "cloth" | "skin" = "cloth"): Ramp {
  const [r, g, b] = hexToRgba(hex);
  let [, , l] = rgbToHsl(r, g, b);
  if (l < 0.17) {
    hex = shift(hex, { dl: 0.17 - l });
    l = 0.17;
  }
  const lightUp = l < 0.25 ? 0.16 : l > 0.8 ? 0.07 : 0.11;
  const shadowDown = l > 0.75 ? 0.16 : l < 0.25 ? 0.07 : 0.12;
  if (kind === "skin") {
    return {
      light: shift(hex, { dl: 0.07, ds: -0.04, toward: 45, by: 4 }),
      base: hex,
      shadow: shift(hex, { dl: -0.09, ds: -0.06, toward: 350, by: 10 }),
      dark: shift(hex, { dl: -Math.max(0.12, l * 0.6), ds: -0.05, toward: 340, by: 18 }),
    };
  }
  return {
    light: shift(hex, { dl: lightUp, ds: -0.02, toward: 55, by: 8 }),
    base: hex,
    shadow: shift(hex, { dl: -shadowDown, ds: l > 0.6 ? -0.1 : 0.03, toward: 255, by: l > 0.6 ? 6 : 12 }),
    dark: shift(hex, { dl: -Math.max(0.1, l * 0.6), ds: l > 0.6 ? -0.15 : 0.02, toward: 265, by: 18 }),
  };
}

/** Slots that never change with the look. */
export const FIXED: Readonly<Record<string, string>> = {
  o: "#2a1f2d", // outline
  W: "#f6f3ef", // eye white
  L: "#ffffff", // eye highlight
  Y: "#f1ece4", // sole
  y: "#bdb4ab", // sole shadow
  l: "#ffffffd0", // lens glare
  Z: "#f6f7fc", // effect white (zzz, thought dots, sparkle core)
  Q: "#ffc93c", // effect gold (?, sparkles)
};

/** Expand base colours to the full slot → hex table. */
export function buildSlots(c: SlotColours): Record<string, string> {
  const skin = ramp(c.skin, "skin");
  const hair = ramp(c.hair);
  const eyes = ramp(c.eyes);
  const shirt = ramp(c.shirt);
  const pants = ramp(c.pants);
  const shoes = ramp(c.shoes);
  const frame = c.glasses ?? "#2b2b33";
  return {
    ...FIXED,
    S: skin.light, s: skin.base, t: skin.shadow,
    u: shift(skin.dark, { dl: -0.06 }),
    M: mix(shift(skin.shadow, { dl: -0.12, ds: 0.1 }), "#9c3b45", 0.45),
    K: mix(skin.base, "#ff7a8a", 0.38),
    H: hair.light, h: hair.base, j: hair.shadow, k: hair.dark,
    E: eyes.base, e: eyes.dark, I: eyes.light,
    B: shirt.light, b: shirt.base, n: shirt.shadow, N: shirt.dark,
    P: pants.light, p: pants.base, q: pants.shadow,
    F: shoes.light, f: shoes.base, v: shoes.shadow,
    G: frame, g: (c.lens ?? "#bfe0f2") + "40",
  };
}
