import { describe, it, expect } from "vitest";
import { rankSuggestions, HALF_LIFE_MS } from "./suggest.js";

const NOW = 1_000 * HALF_LIFE_MS;

describe("rankSuggestions", () => {
  it("returns nothing for an empty query", () => {
    expect(rankSuggestions({ query: "  ", bookmarks: [], history: {}, now: NOW })).toEqual([]);
  });

  it("puts bookmarks before history and does not repeat a URL", () => {
    const rows = rankSuggestions({
      query: "git",
      bookmarks: [{ id: "1", url: "https://github.com/", title: "GitHub", addedAt: 1 }],
      history: {
        "https://github.com/": { title: "GitHub", visits: 50, lastVisit: NOW },
        "https://gitlab.com/": { title: "GitLab", visits: 1, lastVisit: NOW },
      },
      now: NOW,
    });
    expect(rows).toEqual([
      { kind: "bookmark", url: "https://github.com/", title: "GitHub" },
      { kind: "history", url: "https://gitlab.com/", title: "GitLab" },
    ]);
  });

  it("weighs visits by recency, halving every 7 days", () => {
    const rows = rankSuggestions({
      query: "news",
      bookmarks: [],
      history: {
        "https://old-news.com/": { title: "", visits: 10, lastVisit: NOW - 4 * HALF_LIFE_MS }, // 10 / 16 = 0.625
        "https://fresh-news.com/": { title: "", visits: 1, lastVisit: NOW }, // 1
      },
      now: NOW,
    });
    expect(rows.map((r) => r.url)).toEqual(["https://fresh-news.com/", "https://old-news.com/"]);
  });

  it("does not let an entry dated in the future outrank a busy one from today", () => {
    const rows = rankSuggestions({
      query: "site",
      bookmarks: [],
      history: {
        "https://future-site.com/": { title: "", visits: 1, lastVisit: NOW + 100 * HALF_LIFE_MS },
        "https://busy-site.com/": { title: "", visits: 999, lastVisit: NOW },
      },
      now: NOW,
    });
    expect(rows.map((r) => r.url)).toEqual(["https://busy-site.com/", "https://future-site.com/"]);
  });

  it("matches the title too, case-insensitively, and breaks ties by shorter URL", () => {
    const rows = rankSuggestions({
      query: "PYTHON",
      bookmarks: [],
      history: {
        "https://docs.example.org/3/library/": { title: "Python docs", visits: 1, lastVisit: NOW },
        "https://py.org/": { title: "Python", visits: 1, lastVisit: NOW },
      },
      now: NOW,
    });
    expect(rows.map((r) => r.url)).toEqual(["https://py.org/", "https://docs.example.org/3/library/"]);
  });

  it("returns at most 5 rows", () => {
    const history: Record<string, { title: string; visits: number; lastVisit: number }> = {};
    for (let i = 0; i < 20; i++) history[`https://site${i}.com/`] = { title: "site", visits: i, lastVisit: NOW };
    expect(rankSuggestions({ query: "site", bookmarks: [], history, now: NOW })).toHaveLength(5);
  });
});
