import { describe, it, expect } from "vitest";
import { ANIMATIONS, artSize, composeArtFrame, composeFrame, pixelScale } from "./sprite";
import { DEFAULT_LOOK, hairStylesFor, type Look } from "./look";
import { ART_STYLES, ART_STYLE_IDS, type ArtData, type ArtStyle } from "./art";
import { FIXED, buildSlots, hexToRgba } from "./palette";
import { ONESHOTS, type AnimState } from "./behaviour";

const STATES = Object.keys(ANIMATIONS) as AnimState[];
const pixel = (px: Uint8ClampedArray, size: number, x: number, y: number) => {
  const i = (y * size + x) * 4;
  return [px[i], px[i + 1], px[i + 2], px[i + 3]];
};

describe("ANIMATIONS", () => {
  it("covers all thirteen states", () => {
    expect(STATES.sort()).toEqual(
      ["confused", "dangle", "happy", "idle", "listen", "look", "paint", "sit", "sleep", "stretch", "talk", "think", "walk"],
    );
  });
  it("matches every art style's frame counts and timing", () => {
    for (const id of ART_STYLE_IDS) {
      const art = ART_STYLES[id];
      expect(Object.keys(art.frames).sort(), id).toEqual([...STATES].sort());
      for (const s of STATES) {
        expect(art.frames[s].length, `${id} ${s}`).toBe(ANIMATIONS[s].frames);
        expect(art.timing[s], `${id} ${s}`).toEqual({ fps: ANIMATIONS[s].fps, loop: ANIMATIONS[s].loop });
      }
    }
  });
  it("has frames and a positive frame rate for every state", () => {
    for (const s of STATES) {
      expect(ANIMATIONS[s].frames, s).toBeGreaterThan(0);
      expect(ANIMATIONS[s].fps, s).toBeGreaterThan(0);
    }
  });
  it("loops exactly the states that are not one-shots, in every style", () => {
    for (const id of ART_STYLE_IDS) {
      for (const s of STATES) expect(ART_STYLES[id].timing[s].loop, `${id} ${s}`).toBe(!ONESHOTS.has(s));
    }
  });
});

describe("art data", () => {
  it("has square grids of the declared size and only known slot codes", () => {
    const known = new Set([".", "_", ...Object.keys(buildSlots({ skin: "#000000", hair: "#000000", eyes: "#000000", shirt: "#000000", pants: "#000000", shoes: "#000000" }))]);
    // Collect problems and assert once: an expect() per pixel (~280k of them)
    // is slow enough to time out on CI's Windows runners.
    const problems: string[] = [];
    for (const id of ART_STYLE_IDS) {
      const art = ART_STYLES[id];
      const grids: (readonly string[])[] = [art.beard, art.glasses];
      for (const h of Object.values(art.hair)) if (h) grids.push(h.front, ...(h.back ? [h.back] : []));
      for (const s of STATES) for (const f of art.frames[s]) grids.push(f.body, ...(f.front ? [f.front] : []), ...(f.effect ? [f.effect] : []));
      grids.forEach((g, gi) => {
        if (g.length !== art.size) problems.push(`${id} grid ${gi}: ${g.length} rows`);
        g.forEach((row, y) => {
          if (row.length !== art.size) problems.push(`${id} grid ${gi} row ${y}: ${row.length} columns`);
          for (const ch of row) if (!known.has(ch)) problems.push(`${id} grid ${gi} row ${y}: unknown slot '${ch}'`);
        });
      });
    }
    expect(problems).toEqual([]);
  });
});

describe("artSize / pixelScale", () => {
  it("knows each style's grid size", () => {
    expect(artSize("chibi")).toBe(32);
    expect(artSize("chibiLarge")).toBe(48);
    expect(artSize("detailed")).toBe(48);
  });
  it("scales 32-px art 2/3/4x and 48-px art 1/2/3x", () => {
    expect([2, 3, 4].map((s) => pixelScale(32, s))).toEqual([2, 3, 4]);
    expect([2, 3, 4].map((s) => pixelScale(48, s))).toEqual([1, 2, 3]);
    expect(pixelScale(48, 0)).toBe(1);
  });
});

describe("composeFrame", () => {
  it("composes every style, state and frame at the right length", () => {
    for (const artStyle of ART_STYLE_IDS) {
      const n = artSize(artStyle);
      for (const hairStyle of hairStylesFor(artStyle)) {
        const look: Look = { ...DEFAULT_LOOK, artStyle, hairStyle, glasses: true, beard: true };
        for (const s of STATES) {
          for (let i = 0; i < ANIMATIONS[s].frames; i++) {
            const px = composeFrame(look, s, i);
            expect(px).toBeInstanceOf(Uint8ClampedArray);
            expect(px.length).toBe(n * n * 4);
          }
        }
      }
    }
  });

  it("paints outline pixels in the outline colour and leaves the corner clear", () => {
    for (const artStyle of ART_STYLE_IDS) {
      const art = ART_STYLES[artStyle];
      const body = art.frames.idle[0].body;
      const y = body.findIndex((r) => r.includes("o"));
      const x = body[y].indexOf("o");
      const px = composeFrame({ ...DEFAULT_LOOK, artStyle, hairStyle: "bald" }, "idle", 0);
      expect(pixel(px, art.size, x, y), artStyle).toEqual(hexToRgba(FIXED.o));
      expect(pixel(px, art.size, 0, 0), artStyle).toEqual([0, 0, 0, 0]);
    }
  });

  it("tints the lens area only when glasses are on", () => {
    for (const artStyle of ART_STYLE_IDS) {
      const art = ART_STYLES[artStyle];
      const y = art.glasses.findIndex((r) => r.includes("g"));
      const x = art.glasses[y].indexOf("g");
      const look = { ...DEFAULT_LOOK, artStyle };
      const on = pixel(composeFrame({ ...look, glasses: true }, "idle", 0), art.size, x, y);
      const off = pixel(composeFrame({ ...look, glasses: false }, "idle", 0), art.size, x, y);
      expect(on, artStyle).not.toEqual(off);
    }
  });

  it("falls back to a hair style the art has", () => {
    const chibi = { ...DEFAULT_LOOK, artStyle: "chibi" as ArtStyle };
    expect(composeFrame({ ...chibi, hairStyle: "bun" }, "idle", 0)).toEqual(composeFrame({ ...chibi, hairStyle: "ponytail" }, "idle", 0));
    const large = { ...DEFAULT_LOOK, artStyle: "chibiLarge" as ArtStyle };
    expect(composeFrame({ ...large, hairStyle: "ponytail" }, "idle", 0)).toEqual(composeFrame({ ...large, hairStyle: "bun" }, "idle", 0));
    expect(composeFrame({ ...large, hairStyle: "bald" }, "idle", 0)).not.toEqual(composeFrame({ ...large, hairStyle: "short" }, "idle", 0));
  });

  it("wraps out-of-range frame indexes", () => {
    expect(composeFrame(DEFAULT_LOOK, "walk", 5)).toEqual(composeFrame(DEFAULT_LOOK, "walk", 1));
    expect(composeFrame(DEFAULT_LOOK, "walk", -1)).toEqual(composeFrame(DEFAULT_LOOK, "walk", 3));
  });

  // Hashes of every frame rendered by the artist's reference compositor
  // (scripts/mini-me-art/art/anim_render.mjs composeFrame) for the looks below.
  it("matches the artist's reference renderer pixel for pixel", () => {
    const base = { ...DEFAULT_LOOK, glasses: false, beard: false, glassesColor: "#2b2b33" };
    const plain = { ...base, hairStyle: "short" as const, skin: "#d39a6c", hair: "#3a2a26", eyes: "#5a3b26", shirt: "#3f7fd8", pants: "#34405e", shoes: "#e9e3d8" };
    const extras = { ...base, hairStyle: "curly" as const, glasses: true, beard: true, glassesColor: "#c79a3c", skin: "#80513a", hair: "#211c22", eyes: "#2e1f1a", shirt: "#c9413c", pants: "#2f3442", shoes: "#30303a" };
    const second = { ...base, glasses: true, skin: "#f4d0b5", hair: "#7b4a2c", eyes: "#3f7d55", shirt: "#4e9a5e", pants: "#4b5f86", shoes: "#7a4b33" };
    const expected: Record<ArtStyle, string> = { detailed: "c272d286", chibi: "f0547c66", chibiLarge: "af92eee3" };
    for (const artStyle of ART_STYLE_IDS) {
      const art = ART_STYLES[artStyle];
      const looks: Look[] = [plain, extras, ...Object.keys(art.hair).map((h) => ({ ...second, hairStyle: h as Look["hairStyle"] }))].map(
        (l) => ({ ...l, artStyle }),
      );
      let h = 2166136261;
      for (const look of looks) {
        for (const s of Object.keys(art.frames) as AnimState[]) {
          for (let i = 0; i < art.frames[s].length; i++) {
            for (const b of composeFrame(look, s, i)) {
              h ^= b;
              h = Math.imul(h, 16777619) >>> 0;
            }
          }
        }
      }
      expect(h.toString(16), artStyle).toBe(expected[artStyle]);
    }
  });
});

describe("composeArtFrame", () => {
  const tiny = (frame: Partial<ArtData["frames"]["idle"][number]>, extra: Partial<ArtData> = {}): ArtData => {
    const empty = ["...", "...", "..."];
    const frames = Object.fromEntries(STATES.map((s) => [s, [{ head: { dx: 0, dy: 0 }, body: empty, ...frame }]])) as unknown as ArtData["frames"];
    const timing = Object.fromEntries(STATES.map((s) => [s, { fps: 1, loop: true }])) as ArtData["timing"];
    return { name: "tiny", size: 3, layerOrder: [], timing, hair: { short: null }, beard: empty, glasses: empty, frames, ...extra };
  };
  const look = { ...DEFAULT_LOOK, hairStyle: "short" as const };

  it("erases lower layers with '_'", () => {
    const art = tiny({ body: ["ooo", "ooo", "ooo"], effect: ["...", "._.", "..."] });
    const px = composeArtFrame(art, look, "idle", 0);
    expect(pixel(px, 3, 1, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(px, 3, 0, 1)).toEqual(hexToRgba(FIXED.o));
  });

  it("alpha-blends semi-transparent slots over what is below", () => {
    const art = tiny({ body: ["ooo", "ooo", "ooo"], effect: ["g..", "...", "..."] });
    const [r, g, b, a] = composeArtFrame(art, look, "idle", 0).slice(0, 4);
    const [or, og, ob] = hexToRgba(FIXED.o);
    const [lr, lg, lb, la] = hexToRgba("#bfe0f240");
    const t = la / 255;
    expect([r, g, b, a]).toEqual([lr * t + or * (1 - t), lg * t + og * (1 - t), lb * t + ob * (1 - t), 255].map(Math.round));
  });

  it("draws head overlays at the frame's head offset and clips at the edges", () => {
    const art = tiny({ head: { dx: 1, dy: 1 }, body: ["...", "...", "..."] }, { glasses: ["G..", "...", "..G"] });
    const px = composeArtFrame(art, { ...look, glasses: true, glassesColor: "#123456" }, "idle", 0);
    expect(pixel(px, 3, 1, 1)).toEqual([0x12, 0x34, 0x56, 255]);
    expect(pixel(px, 3, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(Array.from(px).filter((v, i) => i % 4 === 3 && v > 0)).toHaveLength(1);
  });
});
