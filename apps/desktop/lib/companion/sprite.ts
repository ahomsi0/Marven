// Mini Me's sprite compositor: stacks a frame's layered, palette-indexed grids
// (see lib/companion/art) into RGBA pixels. A faithful port of the artist's
// reference compositor, scripts/mini-me-art/art/anim_render.mjs composeFrame.
//
// Layer order: hair.back → body → beard → hair.front → glasses → front → effect.
// Hair, beard and glasses are drawn at the frame's head offset, the rest at 0,0.
// '.' leaves lower layers alone, '_' erases to transparent, and everything else
// paints its slot colour, alpha-blended (the lenses tint the eyes beneath).

import type { AnimState } from "./behaviour";
import { ART_STYLES, isArtStyle, type ArtData, type ArtStyle, type Grid } from "./art";
import { fitHairStyleTo, slotColours, DEFAULT_LOOK, type Look } from "./look";
import { buildSlots, hexToRgba, type Rgba } from "./palette";

export interface Animation {
  frames: number;
  fps: number;
  loop: boolean;
}

/** Frame count and timing per state. Every art style shares these (sprite.test.ts checks). */
export const ANIMATIONS = Object.fromEntries(
  (Object.keys(ART_STYLES[DEFAULT_LOOK.artStyle].frames) as AnimState[]).map((s) => {
    const art = ART_STYLES[DEFAULT_LOOK.artStyle];
    return [s, { frames: art.frames[s].length, fps: art.timing[s].fps, loop: art.timing[s].loop }];
  }),
) as Record<AnimState, Animation>;

const artFor = (artStyle: ArtStyle) => ART_STYLES[isArtStyle(artStyle) ? artStyle : DEFAULT_LOOK.artStyle];

/** Width and height of the style's frames, in sprite pixels. */
export const artSize = (artStyle: ArtStyle): number => artFor(artStyle).size;

/**
 * Screen pixels per sprite pixel for a size step (2, 3 or 4), so 32-px and
 * 48-px art come out about the same size. Mirrors electron/companionPlacement.js.
 */
export const pixelScale = (size: number, scale: number): number => Math.max(1, Math.round((32 * scale) / size));

// buildSlots is the costly part; a look's frames are composed in bursts.
let slotCache: { key: string; slots: Record<string, Rgba> } | null = null;
function slotsFor(look: Look): Record<string, Rgba> {
  const colours = slotColours(look);
  const key = JSON.stringify(colours);
  if (slotCache?.key !== key) {
    const slots = Object.fromEntries(Object.entries(buildSlots(colours)).map(([k, v]) => [k, hexToRgba(v)]));
    slotCache = { key, slots };
  }
  return slotCache.slots;
}

/** One frame of `art` for the look, as RGBA (size × size × 4). Out-of-range indexes wrap. */
export function composeArtFrame(art: ArtData, look: Look, state: AnimState, index: number): Uint8ClampedArray {
  const n = art.size;
  const list = art.frames[state];
  const fr = list[((index % list.length) + list.length) % list.length];
  const slots = slotsFor(look);
  const hair = art.hair[fitHairStyleTo(look.hairStyle, Object.keys(art.hair))] ?? null;
  const { dx, dy } = fr.head;
  const stack: [Grid | null | undefined, number, number][] = [
    [hair?.back, dx, dy],
    [fr.body, 0, 0],
    [look.beard ? art.beard : null, dx, dy],
    [hair?.front, dx, dy],
    [look.glasses ? art.glasses : null, dx, dy],
    [fr.front, 0, 0],
    [fr.effect, 0, 0],
  ];
  const px = new Float64Array(n * n * 4);
  for (const [grid, ox, oy] of stack) {
    if (!grid) continue;
    for (let gy = 0; gy < n; gy++) {
      const row = grid[gy];
      for (let gx = 0; gx < n; gx++) {
        const ch = row[gx];
        if (ch === ".") continue;
        const x = gx + ox;
        const y = gy + oy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const i = (y * n + x) * 4;
        if (ch === "_") {
          px.fill(0, i, i + 4);
          continue;
        }
        const slot = slots[ch];
        if (!slot) continue; // unknown code: the art tests keep these out
        const [r, g, b, a8] = slot;
        const a = a8 / 255;
        const da = px[i + 3] / 255;
        const oa = a + da * (1 - a);
        px[i] = (r * a + px[i] * da * (1 - a)) / oa;
        px[i + 1] = (g * a + px[i + 1] * da * (1 - a)) / oa;
        px[i + 2] = (b * a + px[i + 2] * da * (1 - a)) / oa;
        px[i + 3] = oa * 255;
      }
    }
  }
  return Uint8ClampedArray.from(px);
}

/** One frame of the look's art style, as RGBA (artSize × artSize × 4). */
export function composeFrame(look: Look, state: AnimState, index: number): Uint8ClampedArray {
  return composeArtFrame(artFor(look.artStyle), look, state, index);
}
