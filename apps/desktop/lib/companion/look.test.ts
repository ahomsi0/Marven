import { describe, it, expect } from "vitest";
import {
  ALL_HAIR_STYLES,
  COLOR_PRESETS,
  DEFAULT_LOOK,
  fitHairStyle,
  hairStylesFor,
  parseLook,
  randomLook,
  slotColours,
} from "./look";
import { ART_STYLES, ART_STYLE_IDS } from "./art";

describe("parseLook", () => {
  it("returns the defaults for junk", () => {
    expect(parseLook(null)).toEqual(DEFAULT_LOOK);
    expect(parseLook("x")).toEqual(DEFAULT_LOOK);
  });
  it("keeps valid fields and replaces invalid ones", () => {
    const look = parseLook({ hair: "#ff0000", skin: "red", hairStyle: "curly", glasses: true, beard: "yes" });
    expect(look.hair).toBe("#ff0000");
    expect(look.skin).toBe(DEFAULT_LOOK.skin);
    expect(look.hairStyle).toBe("curly");
    expect(look.glasses).toBe(true);
    expect(look.beard).toBe(DEFAULT_LOOK.beard);
  });
  it("rejects unknown hair styles", () => {
    expect(parseLook({ hairStyle: "mohawk" }).hairStyle).toBe(DEFAULT_LOOK.hairStyle);
  });
  it("defaults to the large chibi art style and rejects unknown ones", () => {
    expect(DEFAULT_LOOK.artStyle).toBe("chibiLarge");
    expect(parseLook({}).artStyle).toBe("chibiLarge");
    expect(parseLook({ artStyle: "anime" }).artStyle).toBe("chibiLarge");
    expect(parseLook({ artStyle: "constructor" }).artStyle).toBe("chibiLarge");
    expect(parseLook({ artStyle: "detailed" }).artStyle).toBe("detailed");
    expect(parseLook({ artStyle: "chibi" }).artStyle).toBe("chibi");
  });
  it("swaps bun and ponytail for the art style that has the other", () => {
    expect(parseLook({ artStyle: "chibi", hairStyle: "bun" }).hairStyle).toBe("ponytail");
    expect(parseLook({ artStyle: "detailed", hairStyle: "ponytail" }).hairStyle).toBe("bun");
    expect(parseLook({ artStyle: "chibiLarge", hairStyle: "ponytail" }).hairStyle).toBe("bun");
    expect(parseLook({ artStyle: "chibi", hairStyle: "ponytail" }).hairStyle).toBe("ponytail");
  });
  it("keeps looks saved before art styles existed", () => {
    const old = { skin: "#c68642", hair: "#d8b25a", hairStyle: "long", eyes: "#3f8f5a", glasses: true, beard: false };
    const look = parseLook(old);
    expect(look).toMatchObject({ ...old, artStyle: "chibiLarge" });
  });
});

describe("hair styles", () => {
  it("lists each art style's hair in editor order", () => {
    expect(hairStylesFor("chibiLarge")).toEqual(["short", "long", "curly", "buzz", "bun", "bald"]);
    expect(hairStylesFor("detailed")).toEqual(["short", "long", "curly", "buzz", "bun", "bald"]);
    expect(hairStylesFor("chibi")).toEqual(["short", "long", "curly", "buzz", "ponytail", "bald"]);
  });
  it("covers exactly the art's hair keys", () => {
    for (const id of ART_STYLE_IDS) {
      expect([...hairStylesFor(id)].sort(), id).toEqual(Object.keys(ART_STYLES[id].hair).sort());
      for (const s of hairStylesFor(id)) expect(ALL_HAIR_STYLES).toContain(s);
    }
  });
  it("fits a style to an art style: bun <-> ponytail, otherwise short", () => {
    expect(fitHairStyle("bun", "chibi")).toBe("ponytail");
    expect(fitHairStyle("ponytail", "detailed")).toBe("bun");
    expect(fitHairStyle("curly", "chibi")).toBe("curly");
    expect(fitHairStyle("bald", "detailed")).toBe("bald");
    expect(fitHairStyle("mohawk", "chibi")).toBe("short");
    expect(fitHairStyle(undefined, "chibi")).toBe("short");
  });
});

describe("slotColours", () => {
  it("maps the look's colours to the palette input", () => {
    const look = { ...DEFAULT_LOOK, glassesColor: "#123456" };
    expect(slotColours(look)).toEqual({
      skin: look.skin,
      hair: look.hair,
      eyes: look.eyes,
      shirt: look.shirt,
      pants: look.pants,
      shoes: look.shoes,
      glasses: "#123456",
    });
  });
});

describe("presets", () => {
  it("are valid 6-digit hex colours without duplicates", () => {
    for (const [key, list] of Object.entries(COLOR_PRESETS)) {
      expect(new Set(list).size, key).toBe(list.length);
      for (const c of list) expect(c, key).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it("offer the documented counts and include the default look", () => {
    expect(COLOR_PRESETS.skin).toHaveLength(6);
    expect(COLOR_PRESETS.hair.length).toBeGreaterThanOrEqual(8);
    expect(COLOR_PRESETS.skin).toContain(DEFAULT_LOOK.skin);
    expect(COLOR_PRESETS.shirt).toContain(DEFAULT_LOOK.shirt);
    expect(hairStylesFor(DEFAULT_LOOK.artStyle)).toContain(DEFAULT_LOOK.hairStyle);
  });
});

describe("randomLook", () => {
  const seq = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };
  it("always returns a look that parseLook leaves unchanged", () => {
    for (const rand of [() => 0, () => 0.999999, () => 1, seq([0.1, 0.5, 0.9]), seq([0.33, 0.77]), Math.random]) {
      const look = randomLook(rand);
      expect(parseLook(look)).toEqual(look);
      expect(hairStylesFor(look.artStyle)).toContain(look.hairStyle);
    }
  });
  it("picks every art style for some input", () => {
    const seen = new Set([0, 0.4, 0.99].map((v) => randomLook(() => v).artStyle));
    expect([...seen].sort()).toEqual([...ART_STYLE_IDS].sort());
  });
  it("is deterministic for a given sequence and varies with it", () => {
    expect(randomLook(seq([0.2, 0.6]))).toEqual(randomLook(seq([0.2, 0.6])));
    expect(randomLook(() => 0)).not.toEqual(randomLook(() => 0.99));
  });
});
