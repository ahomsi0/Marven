// Mini Me — palette + shade derivation.
//
// Every pixel in a sprite grid is a single-character *slot code*. A "look"
// (colourway) gives a handful of base colours; `buildSlots(look)` expands them
// into the full slot table using `ramp()`, which derives hue-shifted
// light / shadow / dark tones (light drifts toward warm yellow, shadows drift
// toward cool blue-violet — the classic pixel-art ramp, light from top-left).
//
// SLOT CODES (shared by all three directions)
//   .  transparent            _  erase (punch a hole in layers below)
//   o  outline (generic warm near-black)
//   S s t u   skin   light / base / shadow / dark (skin-tinted selective outline)
//   M  mouth (derived from skin)       K  blush (skin mixed with pink)
//   H h j k   hair   light / base / shadow / dark (hair outline, brows)
//   W  eye white   E  iris   e  iris dark / pupil   I  iris light   L  eye highlight
//   B b n N   shirt  light / base / shadow / dark (folds, seams)
//   P p q     pants  light / base / shadow
//   F f v     shoes  light (highlight) / base / shadow
//   Y y       sole   light / shadow
//   G  glasses frame   g  lens (semi-transparent)   l  lens glare
//   Z  effect white    Q  effect gold   (fixed; used by animation effect layers)

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function hexToRgba(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

export function rgbaToHex([r, g, b, a = 255]) {
  const x = (v) => Math.round(v).toString(16).padStart(2, '0');
  return '#' + x(r) + x(g) + x(b) + (a === 255 ? '' : x(a));
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
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

function hslToRgb(h, s, l) {
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

// Rotate hue `h` toward `target` by at most `amount` degrees (shortest way).
function hueToward(h, target, amount) {
  let d = ((target - h + 540) % 360) - 180;
  return h + Math.sign(d) * Math.min(Math.abs(d), amount);
}

/** Shift a colour: dl = lightness delta, ds = saturation delta, hue drift toward `toward`. */
export function shift(hex, { dl = 0, ds = 0, toward = null, by = 0 } = {}) {
  const [r, g, b, a] = hexToRgba(hex);
  let [h, s, l] = rgbToHsl(r, g, b);
  if (toward !== null && s > 0.04) h = hueToward(h, toward, by);
  s = clamp(s + ds);
  l = clamp(l + dl);
  return rgbaToHex([...hslToRgb(h, s, l), a]);
}

export function mix(hexA, hexB, t) {
  const a = hexToRgba(hexA), b = hexToRgba(hexB);
  return rgbaToHex(a.map((v, i) => v + (b[i] - v) * t));
}

/**
 * Derive a 4-step ramp from one base colour.
 * Very dark bases get a bigger lift for the highlight so black hair still
 * shows a readable sheen; very light bases get a bigger drop for shadows.
 */
export function ramp(hex, kind = 'cloth') {
  const [r, g, b] = hexToRgba(hex);
  let [, , l] = rgbToHsl(r, g, b);
  // Near-black bases: lift the working base a little so highlights and
  // shadows have room (black hair reads as deep charcoal, not a void).
  if (l < 0.17) { hex = shift(hex, { dl: 0.17 - l }); l = 0.17; }
  const lightUp = l < 0.25 ? 0.16 : l > 0.8 ? 0.07 : 0.11;
  const shadowDown = l > 0.75 ? 0.16 : l < 0.25 ? 0.07 : 0.12;
  if (kind === 'skin') {
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

export const FIXED = {
  o: '#2a1f2d', // outline
  W: '#f6f3ef', // eye white
  L: '#ffffff', // eye highlight
  Y: '#f1ece4', // sole
  y: '#bdb4ab', // sole shadow
  l: '#ffffffd0', // lens glare
  Z: '#f6f7fc', // effect white (zzz, thought dots, sparkle core)
  Q: '#ffc93c', // effect gold (?, sparkles)
};

/** Expand a look (base colours) to a full slot -> hex table. */
export function buildSlots(c) {
  const skin = ramp(c.skin, 'skin');
  const hair = ramp(c.hair);
  const eyes = ramp(c.eyes);
  const shirt = ramp(c.shirt);
  const pants = ramp(c.pants);
  const shoes = ramp(c.shoes);
  const frame = c.glasses ?? '#2b2b33';
  return {
    ...FIXED,
    S: skin.light, s: skin.base, t: skin.shadow,
    u: shift(skin.dark, { dl: -0.06 }),
    M: mix(shift(skin.shadow, { dl: -0.12, ds: 0.1 }), '#9c3b45', 0.45),
    K: mix(skin.base, '#ff7a8a', 0.38),
    H: hair.light, h: hair.base, j: hair.shadow, k: hair.dark,
    E: eyes.base, e: eyes.dark, I: eyes.light,
    B: shirt.light, b: shirt.base, n: shirt.shadow, N: shirt.dark,
    P: pants.light, p: pants.base, q: pants.shadow,
    F: shoes.light, f: shoes.base, v: shoes.shadow,
    G: frame, g: (c.lens ?? '#bfe0f2') + '40',
  };
}

// The four colourways used in compare.png.
export const COLOURWAYS = [
  {
    name: 'Dark short / medium skin / blue tee',
    hair: 'short', glasses: false, beard: false,
    colours: { skin: '#d39a6c', hair: '#3a2a26', eyes: '#5a3b26', shirt: '#3f7fd8', pants: '#34405e', shoes: '#e9e3d8' },
  },
  {
    name: 'Long brown / light skin / green hoodie',
    hair: 'long', glasses: false, beard: false,
    colours: { skin: '#f4d0b5', hair: '#7b4a2c', eyes: '#3f7d55', shirt: '#4e9a5e', pants: '#4b5f86', shoes: '#7a4b33' },
  },
  {
    name: 'Curly black / deep skin / glasses + beard / red shirt',
    hair: 'curly', glasses: true, beard: true,
    colours: { skin: '#80513a', hair: '#211c22', eyes: '#2e1f1a', shirt: '#c9413c', pants: '#2f3442', shoes: '#30303a', glasses: '#c79a3c' },
  },
  {
    name: 'Blonde buzz / glasses / grey shirt',
    hair: 'buzz', glasses: true, beard: false,
    colours: { skin: '#e8b994', hair: '#e2bd5e', eyes: '#4a7fc0', shirt: '#8b909b', pants: '#2c3756', shoes: '#c94b3c', glasses: '#2b2b33' },
  },
];
