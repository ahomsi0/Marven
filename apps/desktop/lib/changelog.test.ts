import { describe, it, expect } from "vitest";
import { CHANGELOG, getRelease } from "./changelog";

describe("CHANGELOG", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(CHANGELOG)).toBe(true);
    expect(CHANGELOG.length).toBeGreaterThan(0);
  });

  it("every entry has a semver-like version string", () => {
    for (const release of CHANGELOG) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("every item has a valid tag and non-empty label", () => {
    for (const release of CHANGELOG) {
      for (const item of release.items) {
        expect(["new", "fix", "imp"]).toContain(item.tag);
        expect(item.label.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("getRelease", () => {
  it("returns the release for a known version", () => {
    const r = getRelease(CHANGELOG[0].version);
    expect(r).toBeDefined();
    expect(r!.version).toBe(CHANGELOG[0].version);
  });

  it("returns undefined for an unknown version", () => {
    expect(getRelease("0.0.0")).toBeUndefined();
  });
});
