import { describe, it, expect } from "vitest";
import { extractContextWindow } from "./contextWindow";

describe("extractContextWindow", () => {
  it("derives filename from filePath", () => {
    const ctx = extractContextWindow("hello", 5, "/abs/path/to/foo.ts");
    expect(ctx.filename).toBe("foo.ts");
  });

  it("derives languageId from extension (ts → typescript)", () => {
    const ctx = extractContextWindow("x", 1, "a.ts");
    expect(ctx.languageId).toBe("typescript");
  });

  it("derives languageId for py, js, tsx, jsx, rs, go, java, rb, json, md", () => {
    const cases: Array<[string, string]> = [
      ["a.py", "python"],
      ["a.js", "javascript"],
      ["a.tsx", "typescriptreact"],
      ["a.jsx", "javascriptreact"],
      ["a.rs", "rust"],
      ["a.go", "go"],
      ["a.java", "java"],
      ["a.rb", "ruby"],
      ["a.json", "json"],
      ["a.md", "markdown"],
    ];
    for (const [path, lang] of cases) {
      expect(extractContextWindow("x", 1, path).languageId).toBe(lang);
    }
  });

  it("falls back to plaintext for unknown extension", () => {
    expect(extractContextWindow("x", 1, "f.weird").languageId).toBe("plaintext");
  });

  it("splits prefix/suffix at cursorOffset", () => {
    const doc = "abc\ndef\nghi";
    const off = doc.indexOf("d") + 1; // after 'd' on line 1
    const ctx = extractContextWindow(doc, off, "x.ts");
    expect(ctx.prefix).toBe("abc\nd");
    expect(ctx.suffix).toBe("ef\nghi");
  });

  it("respects linesBefore cap", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `L${i}`);
    const doc = lines.join("\n");
    const cursor = doc.length; // end of file
    const ctx = extractContextWindow(doc, cursor, "x.ts", { linesBefore: 5, linesAfter: 0 });
    // Should keep last 5 lines plus the current line (cursor is on line 99)
    expect(ctx.prefix.split("\n").length).toBeLessThanOrEqual(6);
    expect(ctx.prefix.endsWith("L99")).toBe(true);
  });

  it("respects linesAfter cap", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `L${i}`);
    const doc = lines.join("\n");
    const ctx = extractContextWindow(doc, 0, "x.ts", { linesBefore: 0, linesAfter: 3 });
    // suffix from cursor (offset 0) through 3 lines after line 0
    expect(ctx.suffix.split("\n").length).toBeLessThanOrEqual(4);
  });

  it("clamps maxCharsPerSide from the inside", () => {
    const big = "a".repeat(20000);
    const doc = big + "|" + big;
    const cursor = big.length + 1;
    const ctx = extractContextWindow(doc, cursor, "x.ts", { maxCharsPerSide: 100 });
    expect(ctx.prefix.length).toBeLessThanOrEqual(100);
    expect(ctx.suffix.length).toBeLessThanOrEqual(100);
    // Should keep the *end* of prefix (closest to cursor)
    expect(ctx.prefix.endsWith("|") || ctx.prefix.endsWith("a")).toBe(true);
  });

  it("returns 0-indexed cursorLine", () => {
    const doc = "a\nb\nc";
    const off = doc.indexOf("c");
    const ctx = extractContextWindow(doc, off, "x.ts");
    expect(ctx.cursorLine).toBe(2);
  });
});
