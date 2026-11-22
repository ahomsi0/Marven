import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join, normalize } from "path";
import { tmpdir } from "os";
import {
  readMemory,
  appendMemory,
  writeMemory,
  clearMemory,
  buildScopedMemoryBlock,
  resolveMemoryPath,
  parseMemoryFile,
  parseMemoryEntries,
  listMemoryEntries,
  editMemoryEntry,
  deleteMemoryEntry,
  type MemoryContext,
} from "./memoryClient";

let tmpDir: string;
let memPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "marven-test-"));
  memPath = join(tmpDir, "memory.md");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("readMemory", () => {
  it("returns empty string when file does not exist", () => {
    expect(readMemory(memPath)).toBe("");
  });

  it("returns file contents when file exists", () => {
    writeMemory("hello", memPath);
    expect(readMemory(memPath)).toBe("hello");
  });
});

describe("appendMemory", () => {
  it("creates file on first append", () => {
    appendMemory("first entry", memPath);
    const content = readMemory(memPath);
    expect(content).toContain("first entry");
  });

  it("appends to existing content with timestamp prefix", () => {
    writeMemory("existing", memPath);
    appendMemory("new entry", memPath);
    const content = readMemory(memPath);
    expect(content).toContain("existing");
    expect(content).toContain("new entry");
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("writeMemory", () => {
  it("creates intermediate directories if they do not exist", () => {
    const nested = join(tmpDir, "a", "b", "memory.md");
    writeMemory("data", nested);
    expect(readFileSync(nested, "utf8")).toBe("data");
  });

  it("overwrites existing content", () => {
    writeMemory("first", memPath);
    writeMemory("second", memPath);
    expect(readMemory(memPath)).toBe("second");
  });
});

describe("clearMemory", () => {
  it("writes empty string to file", () => {
    writeMemory("some content", memPath);
    clearMemory(memPath);
    expect(readMemory(memPath)).toBe("");
  });
});

describe("scoped memory helpers", () => {
  it("resolves deterministic project and conversation paths", () => {
    const ctx: MemoryContext = { workspaceRoot: "/tmp/project", conversationId: "conv-123" };
    expect(normalize(resolveMemoryPath("project", ctx))).toContain(normalize("/projects/"));
    expect(normalize(resolveMemoryPath("conversation", ctx))).toContain(
      normalize("/conversations/conv-123.md"),
    );
  });

  it("rejects conversation IDs that could escape the memory directory", () => {
    expect(() => resolveMemoryPath("conversation", { conversationId: "../outside" })).toThrow(
      "Invalid conversationId",
    );
    expect(() => resolveMemoryPath("conversation", { conversationId: "nested/child" })).toThrow(
      "Invalid conversationId",
    );
  });

  it("builds a scoped memory block with labels", () => {
    const text = buildScopedMemoryBlock({
      global: ["prefers dark mode"],
      project: ["uses pnpm"],
      conversation: ["fix navbar spacing"],
    });
    expect(text).toContain("Global memory:");
    expect(text).toContain("Project memory:");
    expect(text).toContain("Conversation memory:");
  });
});

describe("per-entry memory helpers", () => {
  const FILE = [
    "",
    "",
    "- [2026-01-01T00:00:00.000Z] prefers dark mode",
    "",
    "- [2026-01-02T00:00:00.000Z] uses pnpm",
    "",
    "- legacy entry without a timestamp",
  ].join("\n");

  it("parses entries with timestamp ids and position ids for legacy lines", () => {
    expect(parseMemoryFile(FILE)).toEqual([
      { id: "2026-01-01T00:00:00.000Z", timestamp: "2026-01-01T00:00:00.000Z", text: "prefers dark mode" },
      { id: "2026-01-02T00:00:00.000Z", timestamp: "2026-01-02T00:00:00.000Z", text: "uses pnpm" },
      { id: "entry-2", timestamp: null, text: "legacy entry without a timestamp" },
    ]);
    expect(parseMemoryFile("")).toEqual([]);
  });

  it("gives duplicate timestamps distinct ids", () => {
    const ids = parseMemoryFile("- [2026-01-01T00:00:00.000Z] a\n\n- [2026-01-01T00:00:00.000Z] b").map((e) => e.id);
    expect(ids).toEqual(["2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z~1"]);
  });

  it("appendMemory returns the new entry with a unique timestamp id", () => {
    const a = appendMemory("first", memPath);
    const b = appendMemory("second", memPath);
    expect(a.text).toBe("first");
    expect(a.id).toBe(a.timestamp);
    expect(b.id).not.toBe(a.id);
    expect(listMemoryEntries(memPath).map((e) => e.id)).toEqual([a.id, b.id]);
  });

  it("appendMemory collapses blank lines so the entry stays one entry", () => {
    appendMemory("line one\n\n\nline two", memPath);
    expect(listMemoryEntries(memPath).map((e) => e.text)).toEqual(["line one\nline two"]);
  });

  it("edits one entry's text and keeps its timestamp and the file layout", () => {
    writeMemory(FILE, memPath);
    const edited = editMemoryEntry("2026-01-02T00:00:00.000Z", "uses pnpm 9", memPath);
    expect(edited).toEqual({ id: "2026-01-02T00:00:00.000Z", timestamp: "2026-01-02T00:00:00.000Z", text: "uses pnpm 9" });
    expect(readMemory(memPath)).toBe(FILE.replace("uses pnpm", "uses pnpm 9"));
  });

  it("edits a legacy entry without adding a timestamp", () => {
    writeMemory(FILE, memPath);
    editMemoryEntry("entry-2", "renamed", memPath);
    expect(readMemory(memPath)).toBe(FILE.replace("- legacy entry without a timestamp", "- renamed"));
  });

  it("returns null when editing an unknown id and rejects empty text", () => {
    writeMemory(FILE, memPath);
    expect(editMemoryEntry("2030-01-01T00:00:00.000Z", "x", memPath)).toBeNull();
    expect(() => editMemoryEntry("2026-01-01T00:00:00.000Z", "   ", memPath)).toThrow("text is required");
    expect(readMemory(memPath)).toBe(FILE);
  });

  it("deletes one entry and leaves the others untouched", () => {
    writeMemory(FILE, memPath);
    expect(deleteMemoryEntry("2026-01-01T00:00:00.000Z", memPath)).toBe(true);
    expect(readMemory(memPath)).toBe(
      "\n\n- [2026-01-02T00:00:00.000Z] uses pnpm\n\n- legacy entry without a timestamp",
    );
    expect(deleteMemoryEntry("2026-01-01T00:00:00.000Z", memPath)).toBe(false);
  });

  it("empties the file when the last entry is deleted, and appends cleanly after", () => {
    const entry = appendMemory("only one", memPath);
    expect(deleteMemoryEntry(entry.id, memPath)).toBe(true);
    expect(readMemory(memPath)).toBe("");
    appendMemory("again", memPath);
    expect(listMemoryEntries(memPath).map((e) => e.text)).toEqual(["again"]);
  });

  it("keeps parseMemoryEntries in step with the parsed entries", () => {
    expect(parseMemoryEntries(FILE)).toEqual(parseMemoryFile(FILE).map((e) => e.text));
  });
});
