import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLibrary } from "./library.js";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

let dir: string;
let ids: number;
const newId = () => `id-${++ids}`;
const file = (name: string) => path.join(dir, name);
const write = (name: string, text: string) => fs.writeFileSync(file(name), text);
const read = (name: string) => JSON.parse(fs.readFileSync(file(name), "utf8"));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "marven-browser-library-"));
  ids = 0;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("createLibrary", () => {
  it("starts empty when nothing is saved, and writes nothing", () => {
    const library = createLibrary({ dir, newId });
    expect(library.savedTabs()).toEqual({ tabs: [], activeIndex: 0 });
    expect(library.listBookmarks("")).toEqual([]);
    library.flush();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("cleans saved files on load and writes them back", () => {
    write("history.json", JSON.stringify({
      "https://kept.com/": { title: "Kept", visits: 2, lastVisit: NOW - DAY },
      "https://old.com/": { title: "Old", visits: 1, lastVisit: NOW - 400 * DAY },
      "file:///etc/passwd": { title: "Nope", visits: 1, lastVisit: NOW },
    }));
    write("bookmarks.json", JSON.stringify([
      { id: "b1", url: "https://a.com/", title: "A", addedAt: 1 },
      { id: "b2", url: "https://a.com/", title: "Duplicate", addedAt: 2 },
      { id: "b3", url: "javascript:alert(1)", title: "Bad", addedAt: 3 },
    ]));
    write("sites.json", JSON.stringify({ blockingDisabled: ["news.com", "not a host", 42] }));

    const library = createLibrary({ dir, newId });
    library.flush();

    expect(Object.keys(read("history.json"))).toEqual(["https://kept.com/"]);
    expect(read("bookmarks.json")).toEqual([{ id: "b1", url: "https://a.com/", title: "A", addedAt: 1 }]);
    expect(read("sites.json")).toEqual({ blockingDisabled: ["news.com"] });
  });

  it("falls back to no blocked sites when sites.json has the wrong shape", () => {
    write("sites.json", JSON.stringify({ blockingDisabled: "news.com" }));
    const library = createLibrary({ dir, newId });
    expect(library.blockingDisabled("news.com")).toBe(false);
    library.flush();
    expect(read("sites.json")).toEqual({ blockingDisabled: [] });
  });

  it("leaves files that are already clean untouched", () => {
    // Pretty-printed, so a rewrite (always compact) would show.
    const history = JSON.stringify({ "https://a.com/": { title: "A", visits: 1, lastVisit: NOW - DAY } }, null, 2);
    const bookmarks = JSON.stringify([{ id: "b1", url: "https://a.com/", title: "A", addedAt: 1 }], null, 2);
    const sites = JSON.stringify({ blockingDisabled: ["a.com"] }, null, 2);
    write("history.json", history);
    write("bookmarks.json", bookmarks);
    write("sites.json", sites);

    createLibrary({ dir, newId }).flush();

    expect(fs.readFileSync(file("history.json"), "utf8")).toBe(history);
    expect(fs.readFileSync(file("bookmarks.json"), "utf8")).toBe(bookmarks);
    expect(fs.readFileSync(file("sites.json"), "utf8")).toBe(sites);
  });

  it("saves the tab list as given", () => {
    const saved = { tabs: [{ url: "https://a.com/", title: "A" }], activeIndex: 0 };
    createLibrary({ dir, newId }).saveTabs(saved);
    vi.runAllTimers();
    expect(read("tabs.json")).toEqual(saved);
    expect(createLibrary({ dir, newId }).savedTabs()).toEqual(saved);
  });

  it("toggles, finds and removes bookmarks", () => {
    const library = createLibrary({ dir, newId });
    expect(library.toggleBookmark("https://a.com/", "Alpha")).toBe(true);
    expect(library.isBookmarked("https://a.com/")).toBe(true);
    expect(library.listBookmarks("alp")).toEqual([{ id: "id-1", url: "https://a.com/", title: "Alpha", addedAt: NOW }]);

    expect(library.toggleBookmark("https://a.com/", "Alpha")).toBe(false);
    expect(library.isBookmarked("https://a.com/")).toBe(false);

    library.toggleBookmark("https://b.com/", "Beta");
    library.removeBookmark("id-2");
    expect(library.listBookmarks("")).toEqual([]);
  });

  it("records visits and titles, and suggests from them and bookmarks", () => {
    const library = createLibrary({ dir, newId });
    library.recordVisit("https://docs.example.com/", "");
    library.updateTitle("https://docs.example.com/", "Example Docs");
    library.toggleBookmark("https://example.com/", "Example");

    expect(library.suggest("example")).toEqual([
      { kind: "bookmark", url: "https://example.com/", title: "Example" },
      { kind: "history", url: "https://docs.example.com/", title: "Example Docs" },
    ]);
    library.flush();
    expect(read("history.json")).toEqual({ "https://docs.example.com/": { title: "Example Docs", visits: 1, lastVisit: NOW } });
  });

  it("turns blocking off and on per site", () => {
    const library = createLibrary({ dir, newId });
    library.setBlocking("news.com", false);
    library.setBlocking("news.com", false);
    expect(library.blockingDisabled("news.com")).toBe(true);
    expect(library.blockingDisabled("other.com")).toBe(false);
    expect(library.blockingDisabled("")).toBe(false);
    library.flush();
    expect(read("sites.json")).toEqual({ blockingDisabled: ["news.com"] });

    library.setBlocking("news.com", true);
    expect(library.blockingDisabled("news.com")).toBe(false);
  });

  it("clears history but keeps bookmarks and site settings", () => {
    const library = createLibrary({ dir, newId });
    library.recordVisit("https://a.com/", "A");
    library.toggleBookmark("https://b.com/", "B");
    library.setBlocking("c.com", false);

    library.clearData();

    expect(library.suggest("a.com")).toEqual([]);
    expect(library.isBookmarked("https://b.com/")).toBe(true);
    expect(library.blockingDisabled("c.com")).toBe(true);
  });
});
