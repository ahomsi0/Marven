import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readMemory, appendMemory, writeMemory, clearMemory } from "./memoryClient";

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
