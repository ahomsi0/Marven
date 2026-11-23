import { describe, it, expect } from "vitest";
import { COLOR_PRESETS, DEFAULT_LOOK, HAIR_STYLES, parseLook, randomLook } from "./look";

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
    expect(HAIR_STYLES).toContain(DEFAULT_LOOK.hairStyle);
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
      expect(HAIR_STYLES).toContain(look.hairStyle);
    }
  });
  it("is deterministic for a given sequence and varies with it", () => {
    expect(randomLook(seq([0.2, 0.6]))).toEqual(randomLook(seq([0.2, 0.6])));
    expect(randomLook(() => 0)).not.toEqual(randomLook(() => 0.99));
  });
});
