import { describe, it, expect } from "vitest";
import { chunkFile } from "./chunker";

describe("chunkFile", () => {
  it("returns no chunks for empty content", () => {
    expect(chunkFile("a.ts", "")).toEqual([]);
    expect(chunkFile("a.ts", "   \n  \n")).toEqual([]);
  });
  it("returns a single chunk for a short file", () => {
    const c = chunkFile("a.ts", "line1\nline2\nline3");
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ path: "a.ts", startLine: 0, endLine: 2 });
    expect(c[0].text).toBe("line1\nline2\nline3");
  });
  it("overlaps adjacent chunks", () => {
    const lines = Array.from({ length: 150 }, (_, i) => `L${i}`);
    const content = lines.join("\n");
    const c = chunkFile("a.ts", content, { linesPerChunk: 60, overlapLines: 10 });
    expect(c.length).toBeGreaterThan(2);
    expect(c[0].startLine).toBe(0);
    expect(c[0].endLine).toBe(59);
    expect(c[1].startLine).toBe(50);
    expect(c[1].endLine).toBe(109);
    expect(c[c.length - 1].endLine).toBe(149);
  });
  it("skips chunks above maxChars", () => {
    const huge = "x".repeat(10_000);
    const content = `${huge}\n${huge}\n${huge}`;
    const c = chunkFile("a.ts", content, { maxChars: 8000 });
    expect(c).toEqual([]);
  });
  it("skips whitespace-only chunks", () => {
    const c = chunkFile("a.ts", "\n\n\n\n");
    expect(c).toEqual([]);
  });
});
