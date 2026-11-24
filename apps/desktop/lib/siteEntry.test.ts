import { describe, expect, it } from "vitest";
import { findSiteEntry } from "./siteEntry";

const f = (path: string, type?: "file" | "folder") => ({ path, name: path.split("/").pop() ?? path, type });

describe("findSiteEntry", () => {
  it("finds a top-level index.html", () => {
    expect(findSiteEntry([f("style.css"), f("index.html")])).toBe("index.html");
  });
  it("falls back to index.htm and ignores case", () => {
    expect(findSiteEntry([f("Index.HTM")])).toBe("Index.HTM");
  });
  it("prefers index.html over index.htm", () => {
    expect(findSiteEntry([f("index.htm"), f("index.html")])).toBe("index.html");
  });
  it("ignores nested files and folders", () => {
    expect(findSiteEntry([f("docs/index.html"), f("index.html", "folder")])).toBeNull();
    expect(findSiteEntry([])).toBeNull();
  });
});
