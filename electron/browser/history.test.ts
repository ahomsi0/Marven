import { describe, it, expect } from "vitest";
import { recordVisit, updateTitle, prune, sanitizeHistory, MAX_ENTRIES, MAX_AGE_MS } from "./history.js";

const DAY = 86_400_000;

describe("history", () => {
  it("records visits and counts repeats", () => {
    let h = recordVisit({}, "https://a.com/", "A", 1000);
    h = recordVisit(h, "https://a.com/", "", 2000);
    expect(h["https://a.com/"]).toEqual({ title: "A", visits: 2, lastVisit: 2000 });
  });

  it("ignores non-web URLs", () => {
    const h = recordVisit({}, "about:blank", "x", 1);
    expect(h).toEqual({});
  });

  it("updates the title of a known URL only", () => {
    const h = recordVisit({}, "https://a.com/", "", 1);
    expect(updateTitle(h, "https://a.com/", "Real")["https://a.com/"].title).toBe("Real");
    expect(updateTitle(h, "https://other.com/", "x")).toBe(h);
  });

  it("drops entries older than 90 days", () => {
    const now = 200 * DAY;
    const h = { "https://old.com/": { title: "", visits: 1, lastVisit: now - MAX_AGE_MS - 1 }, "https://new.com/": { title: "", visits: 1, lastVisit: now - DAY } };
    expect(Object.keys(prune(h, now))).toEqual(["https://new.com/"]);
  });

  it("keeps only the most recent entries", () => {
    const h: Record<string, { title: string; visits: number; lastVisit: number }> = {};
    for (let i = 0; i < MAX_ENTRIES + 10; i++) h[`https://s${i}.com/`] = { title: "", visits: 1, lastVisit: 1_000_000 + i };
    const pruned = prune(h, 1_000_000 + MAX_ENTRIES + 10);
    expect(Object.keys(pruned)).toHaveLength(MAX_ENTRIES);
    expect(pruned["https://s0.com/"]).toBeUndefined();
    expect(pruned[`https://s${MAX_ENTRIES + 9}.com/`]).toBeDefined();
  });

  it("sanitizes whatever was on disk", () => {
    expect(sanitizeHistory(null)).toEqual({});
    expect(sanitizeHistory([1, 2])).toEqual({});
    expect(
      sanitizeHistory({
        "https://ok.com/": { title: "Ok", visits: 3, lastVisit: 5 },
        "javascript:x": { title: "", visits: 1, lastVisit: 1 },
        "https://bad.com/": { title: "x", visits: "lots", lastVisit: 1 },
      }),
    ).toEqual({ "https://ok.com/": { title: "Ok", visits: 3, lastVisit: 5 } });
  });
});
