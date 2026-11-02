import { describe, it, expect } from "vitest";
import { ENGINES, DEFAULT_ENGINE_ID, searchEngine } from "./searchEngines.js";

describe("searchEngine", () => {
  it("finds an engine by id", () => {
    expect(searchEngine("google")!.searchUrl).toBe("https://www.google.com/search?q=");
    expect(searchEngine("duckduckgo")!.homeUrl).toBe("https://duckduckgo.com/");
  });

  it("falls back to Brave for unknown or missing ids", () => {
    expect(DEFAULT_ENGINE_ID).toBe("brave");
    expect(searchEngine("altavista")!.id).toBe("brave");
    expect(searchEngine(undefined)!.id).toBe("brave");
  });

  it("only lists https search and home URLs with unique ids", () => {
    const ids = ENGINES.map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of ENGINES as { searchUrl: string; homeUrl: string }[]) {
      expect(e.searchUrl.startsWith("https://")).toBe(true);
      expect(e.homeUrl.startsWith("https://")).toBe(true);
    }
  });
});
