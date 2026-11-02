import { describe, it, expect } from "vitest";
import { toggleBookmark, removeBookmark, searchBookmarks, sanitizeBookmarks } from "./bookmarks.js";

describe("bookmarks", () => {
  it("adds, then removes on a second toggle", () => {
    const added = toggleBookmark([], "https://a.com/", "A", 10, () => "b1");
    expect(added).toEqual({ list: [{ id: "b1", url: "https://a.com/", title: "A", addedAt: 10 }], bookmarked: true });
    const removed = toggleBookmark(added.list, "https://a.com/", "A", 20, () => "b2");
    expect(removed).toEqual({ list: [], bookmarked: false });
  });

  it("caps titles and refuses non-web URLs", () => {
    const { list } = toggleBookmark([], "https://a.com/", "x".repeat(500), 1, () => "b1");
    expect(list[0].title).toHaveLength(300);
    expect(toggleBookmark([], "file:///x", "x", 1, () => "b1")).toEqual({ list: [], bookmarked: false });
  });

  it("removes by id", () => {
    const list = [{ id: "b1", url: "https://a.com/", title: "A", addedAt: 1 }];
    expect(removeBookmark(list, "b1")).toEqual([]);
    expect(removeBookmark(list, "nope")).toBe(list);
  });

  it("searches title and URL, newest first", () => {
    const list = [
      { id: "1", url: "https://github.com/", title: "GitHub", addedAt: 1 },
      { id: "2", url: "https://docs.python.org/", title: "Python docs", addedAt: 3 },
      { id: "3", url: "https://gitlab.com/", title: "GitLab", addedAt: 2 },
    ];
    expect(searchBookmarks(list, "").map((b: { id: string }) => b.id)).toEqual(["2", "3", "1"]);
    expect(searchBookmarks(list, "GIT").map((b: { id: string }) => b.id)).toEqual(["3", "1"]);
    expect(searchBookmarks(list, "python").map((b: { id: string }) => b.id)).toEqual(["2"]);
  });

  it("sanitizes whatever was on disk", () => {
    expect(sanitizeBookmarks({})).toEqual([]);
    expect(
      sanitizeBookmarks([
        { id: "1", url: "https://ok.com/", title: "Ok", addedAt: 1 },
        { id: "2", url: "javascript:x", title: "", addedAt: 1 },
        { id: "../x", url: "https://bad-id.com/", title: "", addedAt: 1 },
        { id: "3", url: "https://ok.com/", title: "dupe", addedAt: 2 },
        { id: "1", url: "https://other.com/", title: "same id", addedAt: 3 },
      ]),
    ).toEqual([{ id: "1", url: "https://ok.com/", title: "Ok", addedAt: 1 }]);
  });
});
