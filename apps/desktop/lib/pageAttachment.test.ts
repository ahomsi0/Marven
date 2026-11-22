import { describe, expect, it } from "vitest";
import {
  MAX_PAGE_TEXT,
  MAX_SELECTION_TEXT,
  PAGE_FOOTER,
  UNTRUSTED_PAGE_HEADER,
  cleanPageDetail,
  pageChipTitle,
  pageToDocAttachment,
} from "./pageAttachment";

const page = { url: "https://example.com/a", title: "Example", text: "Body text", selection: "" };

describe("cleanPageDetail", () => {
  it("accepts a page and trims fields", () => {
    expect(cleanPageDetail({ ...page, title: "  Example \n Title ", prompt: " Summarise this page. " })).toEqual({
      ...page,
      title: "Example Title",
      prompt: "Summarise this page.",
    });
  });

  it("rejects non-web URLs, empty pages and junk", () => {
    expect(cleanPageDetail({ ...page, url: "file:///etc/passwd" })).toBeNull();
    expect(cleanPageDetail({ ...page, url: "javascript:alert(1)" })).toBeNull();
    expect(cleanPageDetail({ ...page, text: "  ", selection: "" })).toBeNull();
    expect(cleanPageDetail(null)).toBeNull();
    expect(cleanPageDetail("page")).toBeNull();
  });

  it("caps text and selection", () => {
    const out = cleanPageDetail({ ...page, text: "a".repeat(MAX_PAGE_TEXT + 50), selection: "b".repeat(MAX_SELECTION_TEXT + 50) });
    expect(out?.text).toHaveLength(MAX_PAGE_TEXT);
    expect(out?.selection).toHaveLength(MAX_SELECTION_TEXT);
  });

  it("drops a non-string prompt", () => {
    expect(cleanPageDetail({ ...page, prompt: 42 })).not.toHaveProperty("prompt");
  });
});

describe("pageChipTitle", () => {
  it("uses the title, falls back to the host, and shortens long titles", () => {
    expect(pageChipTitle(page)).toBe("Example");
    expect(pageChipTitle({ ...page, title: "" })).toBe("example.com");
    const long = pageChipTitle({ ...page, title: "x".repeat(200) });
    expect(long).toHaveLength(80);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("pageToDocAttachment", () => {
  it("wraps the page text in an untrusted-content header", () => {
    const doc = pageToDocAttachment(page, "Page: Example");
    expect(doc.name).toBe("Page: Example");
    expect(doc.mimeType).toBe("text/html");
    expect(doc.text.startsWith(UNTRUSTED_PAGE_HEADER)).toBe(true);
    expect(doc.text).toContain("Title: Example\nURL: https://example.com/a");
    expect(doc.text).toContain("\n\nBody text\n\n");
    expect(doc.text.endsWith(PAGE_FOOTER)).toBe(true);
  });

  it("prefers the selection over the page text", () => {
    const doc = pageToDocAttachment({ ...page, selection: "Just this bit" }, "Page: Example");
    expect(doc.text).toContain("Just this bit");
    expect(doc.text).not.toContain("Body text");
    expect(doc.text).toContain("selected");
  });
});
