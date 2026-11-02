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

  it("treats a long title equal to the stored capped one as unchanged", () => {
    const long = "t".repeat(1000);
    const h = recordVisit({}, "https://a.com/", long, 1);
    expect(h["https://a.com/"].title).toHaveLength(300);
    expect(updateTitle(h, "https://a.com/", long)).toBe(h);
  });

  it("prunes as it records once well past the entry limit", () => {
    const now = 10 * DAY;
    const h: Record<string, { title: string; visits: number; lastVisit: number }> = {};
    const over = Math.floor(MAX_ENTRIES * 1.1);
    for (let i = 0; i < over; i++) h[`https://s${i}.com/`] = { title: "", visits: 1, lastVisit: now - DAY + i };
    expect(Object.keys(recordVisit(h, "https://s0.com/", "", now))).toHaveLength(over); // no growth, no prune
    const next = recordVisit(h, "https://new.com/", "", now);
    expect(Object.keys(next)).toHaveLength(MAX_ENTRIES);
    expect(next["https://new.com/"]).toBeDefined();
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
    expect(sanitizeHistory(null, 100)).toEqual({});
    expect(sanitizeHistory([1, 2], 100)).toEqual({});
    expect(
      sanitizeHistory({
        "https://ok.com/": { title: "Ok", visits: 3, lastVisit: 5 },
        "javascript:x": { title: "", visits: 1, lastVisit: 1 },
        "https://bad.com/": { title: "x", visits: "lots", lastVisit: 1 },
        "https://zero.com/": { title: "x", visits: 0, lastVisit: 1 },
        "https://half.com/": { title: "x", visits: 1.5, lastVisit: 1 },
      }, 100),
    ).toEqual({ "https://ok.com/": { title: "Ok", visits: 3, lastVisit: 5 } });
  });

  it("clamps a lastVisit in the future to now", () => {
    expect(sanitizeHistory({ "https://a.com/": { title: "", visits: 2, lastVisit: 10_000 } }, 500)).toEqual({
      "https://a.com/": { title: "", visits: 2, lastVisit: 500 },
    });
  });
});
