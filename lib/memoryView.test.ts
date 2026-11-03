import { describe, it, expect, vi, afterEach } from "vitest";
import { memoryExportFileName, memoryExportMarkdown, relativeMemoryDate } from "./memoryView";
import {
  MEMORY_SAVED_EVENT,
  dispatchMemorySaved,
  formatRememberToolResult,
  parseRememberToolResult,
} from "./memoryEvents";

const now = new Date("2026-11-02T12:00:00.000Z");

describe("relativeMemoryDate", () => {
  it("describes recent and older timestamps", () => {
    expect(relativeMemoryDate("2026-11-02T11:59:30.000Z", now, "en", "just now")).toBe("just now");
    expect(relativeMemoryDate("2026-11-02T11:55:00.000Z", now, "en", "just now")).toBe("5 minutes ago");
    expect(relativeMemoryDate("2026-11-01T12:00:00.000Z", now, "en", "just now")).toBe("yesterday");
    expect(relativeMemoryDate("2026-10-20T12:00:00.000Z", now, "en", "just now")).toBe("last week");
    expect(relativeMemoryDate("2024-11-02T12:00:00.000Z", now, "en", "just now")).toBe("2 years ago");
  });

  it("localises to Arabic", () => {
    const out = relativeMemoryDate("2026-10-30T12:00:00.000Z", now, "ar", "الآن");
    expect(out).toBeTruthy();
    expect(out).not.toMatch(/days|ago/);
  });

  it("returns null for missing or invalid timestamps and just-now for the future", () => {
    expect(relativeMemoryDate(null, now, "en", "just now")).toBeNull();
    expect(relativeMemoryDate("not a date", now, "en", "just now")).toBeNull();
    expect(relativeMemoryDate("2027-01-01T00:00:00.000Z", now, "en", "just now")).toBe("just now");
  });
});

describe("memoryExportMarkdown", () => {
  it("writes a heading and one bullet per entry, keeping timestamps", () => {
    const md = memoryExportMarkdown("Marven memory: Global", [
      { id: "a", timestamp: "2026-01-01T00:00:00.000Z", text: "prefers dark mode" },
      { id: "entry-1", timestamp: null, text: "line one\nline two" },
    ]);
    expect(md).toBe(
      "# Marven memory: Global\n\n- [2026-01-01T00:00:00.000Z] prefers dark mode\n- line one\n  line two\n",
    );
  });

  it("builds a dated file name", () => {
    expect(memoryExportFileName("project", now)).toBe("marven-memory-project-2026-11-02.md");
  });
});

describe("remember tool result", () => {
  it("round-trips scope and id", () => {
    const text = formatRememberToolResult("global", "2026-11-02T10:00:00.000Z");
    expect(parseRememberToolResult(text)).toEqual({ scope: "global", id: "2026-11-02T10:00:00.000Z" });
  });

  it("ignores results without an id and other tool output", () => {
    expect(parseRememberToolResult(formatRememberToolResult("project"))).toBeNull();
    expect(parseRememberToolResult("Remember failed: disk full")).toBeNull();
  });
});

describe("dispatchMemorySaved", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches marven:memory-saved with the detail", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const seen: unknown[] = [];
    target.addEventListener(MEMORY_SAVED_EVENT, (e) => seen.push((e as CustomEvent).detail));
    dispatchMemorySaved({ scope: "global", text: "likes tea", id: "x" });
    expect(seen).toEqual([{ scope: "global", text: "likes tea", id: "x" }]);
  });
});
