import { describe, it, expect } from "vitest";
import { fuzzyMatch, fuzzyRank, matchRanges } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches a subsequence across words", () => {
    const m = fuzzyMatch("nwtab", "New tab");
    expect(m).not.toBeNull();
    expect(m!.indices).toEqual([0, 2, 4, 5, 6]);
  });

  it("is case-insensitive and ignores spaces in the query", () => {
    expect(fuzzyMatch("NEW TAB", "new tab")?.indices).toEqual([0, 1, 2, 4, 5, 6]);
  });

  it("returns null when characters are missing or out of order", () => {
    expect(fuzzyMatch("xyz", "New tab")).toBeNull();
    expect(fuzzyMatch("bat", "tab")).toBeNull();
    expect(fuzzyMatch("toolongquery", "short")).toBeNull();
  });

  it("matches everything with an empty query", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
    expect(fuzzyMatch("   ", "anything")).toEqual({ score: 0, indices: [] });
  });

  it("prefers word starts over letters in the middle of words", () => {
    // "ot" should land on "Open" + "tab", not the "o" and "t" inside "bottom".
    const m = fuzzyMatch("ot", "bottom Open tab");
    expect(m!.indices).toEqual([7, 12]);
  });

  it("scores a prefix match above a mid-word match", () => {
    const prefix = fuzzyMatch("set", "Settings")!;
    const middle = fuzzyMatch("set", "Reset theme")!;
    expect(prefix.score).toBeGreaterThan(middle.score);
  });

  it("scores consecutive characters above scattered ones", () => {
    const run = fuzzyMatch("tab", "Open tabs")!;
    const scattered = fuzzyMatch("tab", "Open tidy label")!;
    expect(run.score).toBeGreaterThan(scattered.score);
  });

  it("rewards camelCase boundaries", () => {
    const camel = fuzzyMatch("gp", "gitPanel")!;
    expect(camel.indices).toEqual([0, 3]);
  });

  it("works on non-Latin text", () => {
    expect(fuzzyMatch("محادثة", "محادثة جديدة")?.indices).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("fuzzyRank", () => {
  const items = ["Reset theme", "Settings", "New tab", "Search conversations"];

  it("keeps original order for an empty query", () => {
    expect(fuzzyRank("", items, (s) => s).map((r) => r.item)).toEqual(items);
  });

  it("filters out non-matches and sorts best first", () => {
    const out = fuzzyRank("set", items, (s) => s).map((r) => r.item);
    expect(out[0]).toBe("Settings");
    expect(out).toContain("Reset theme");
    expect(out).not.toContain("New tab");
  });

  it("falls back to keywords, ranked below label matches, without highlights", () => {
    const cmds = [
      { label: "Change theme", keywords: ["appearance"] },
      { label: "Appearance guide", keywords: [] },
    ];
    const out = fuzzyRank("appear", cmds, (c) => c.label, (c) => c.keywords);
    expect(out.map((r) => r.item.label)).toEqual(["Appearance guide", "Change theme"]);
    expect(out[1].match.indices).toEqual([]);
  });
});

describe("matchRanges", () => {
  it("groups consecutive indices", () => {
    expect(matchRanges([0, 2, 4, 5, 6])).toEqual([[0, 1], [2, 3], [4, 7]]);
    expect(matchRanges([])).toEqual([]);
  });
});
