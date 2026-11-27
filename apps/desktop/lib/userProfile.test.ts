import { describe, it, expect } from "vitest";
import { AVATAR_COLORS, parseProfile } from "./userProfile";

describe("parseProfile", () => {
  it("keeps a name and a valid picture", () => {
    expect(parseProfile({ name: "Ahmad" })).toEqual({ name: "Ahmad" });
    expect(parseProfile({ name: "Ahmad", avatar: { kind: "initial", color: AVATAR_COLORS[2] } })).toEqual({
      name: "Ahmad",
      avatar: { kind: "initial", color: AVATAR_COLORS[2] },
    });
    expect(parseProfile({ name: "A", avatar: { kind: "minime" } })).toEqual({ name: "A", avatar: { kind: "minime" } });
    const photo = "data:image/jpeg;base64,/9j/AAAA";
    expect(parseProfile({ name: "A", avatar: { kind: "photo", dataUrl: photo } })).toEqual({ name: "A", avatar: { kind: "photo", dataUrl: photo } });
  });
  it("drops a picture it can't trust", () => {
    expect(parseProfile({ name: "A", avatar: { kind: "initial", color: "red; background:url(x)" } })).toEqual({ name: "A" });
    expect(parseProfile({ name: "A", avatar: { kind: "photo", dataUrl: "https://evil.example/x.png" } })).toEqual({ name: "A" });
    expect(parseProfile({ name: "A", avatar: { kind: "photo", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" } })).toEqual({ name: "A" });
    expect(parseProfile({ name: "A", avatar: { kind: "photo", dataUrl: `data:image/png;base64,${"A".repeat(400_000)}` } })).toEqual({ name: "A" });
    expect(parseProfile({ name: "A", avatar: { kind: "nope" } })).toEqual({ name: "A" });
  });
  it("is null without a usable name", () => {
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile({})).toBeNull();
    expect(parseProfile({ name: 5 })).toBeNull();
    expect(parseProfile("Ahmad")).toBeNull();
  });
  it("trims and caps the name", () => {
    expect(parseProfile({ name: "  Ahmad  " })).toEqual({ name: "Ahmad" });
    expect(parseProfile({ name: "x".repeat(200) })?.name).toHaveLength(60);
  });
});
