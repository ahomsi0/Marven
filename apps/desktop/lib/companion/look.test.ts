import { describe, it, expect } from "vitest";
import { DEFAULT_LOOK, parseLook } from "./look";

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
