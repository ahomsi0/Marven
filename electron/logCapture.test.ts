import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// logCapture.js is CommonJS (Electron main process).
const require = createRequire(import.meta.url);
const { createLogCapture, patchConsole, rendererConsoleEntry } = require("./logCapture") as {
  createLogCapture: (opts: {
    getDir: () => string;
    maxLines?: number;
    maxBytes?: number;
    homeDir?: string;
    now?: () => Date;
  }) => { push: (level: string, source: string, args: unknown[]) => void; recent: () => string[] };
  patchConsole: (capture: { push: (level: string, source: string, args: unknown[]) => void }, target: Record<string, unknown>) => void;
  rendererConsoleEntry: (...args: unknown[]) => { level: string; text: string } | null;
};

const fixedNow = () => new Date("2026-11-02T10:00:00.000Z");
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "marven-logs-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createLogCapture", () => {
  it("formats, redacts and buffers lines", () => {
    const cap = createLogCapture({ getDir: () => dir, now: fixedNow, homeDir: "/Users/jane" });
    cap.push("warn", "main", ["key %s in", "gsk_ABCDEFGHIJKLMNOP1234", "/Users/jane/app"]);
    expect(cap.recent()).toEqual([
      "2026-11-02T10:00:00.000Z [main] WARN key [REDACTED_KEY] in ~/app",
    ]);
  });

  it("keeps only the last maxLines entries", () => {
    const cap = createLogCapture({ getDir: () => dir, now: fixedNow, maxLines: 3 });
    for (let i = 1; i <= 5; i++) cap.push("log", "main", [`line ${i}`]);
    const recent = cap.recent();
    expect(recent).toHaveLength(3);
    expect(recent[0]).toContain("line 3");
    expect(recent[2]).toContain("line 5");
  });

  it("appends to main.log and rotates to main.log.1 past maxBytes", () => {
    const cap = createLogCapture({ getDir: () => dir, now: fixedNow, maxBytes: 200 });
    for (let i = 0; i < 6; i++) cap.push("error", "main", [`entry number ${i} ${"x".repeat(20)}`]);
    const main = readFileSync(join(dir, "main.log"), "utf8");
    expect(existsSync(join(dir, "main.log.1"))).toBe(true);
    expect(Buffer.byteLength(main)).toBeLessThanOrEqual(200);
    expect(main).toContain("entry number 5");
  });

  it("counts an existing log file toward the rotation size", () => {
    writeFileSync(join(dir, "main.log"), "y".repeat(190));
    const cap = createLogCapture({ getDir: () => dir, now: fixedNow, maxBytes: 200 });
    cap.push("log", "main", ["fresh"]);
    expect(readFileSync(join(dir, "main.log.1"), "utf8")).toBe("y".repeat(190));
    expect(readFileSync(join(dir, "main.log"), "utf8")).toContain("fresh");
  });

  it("keeps working in memory when the log directory can't be created", () => {
    const cap = createLogCapture({
      getDir: () => {
        throw new Error("no userData");
      },
      now: fixedNow,
    });
    cap.push("log", "main", ["still buffered"]);
    expect(cap.recent()[0]).toContain("still buffered");
  });
});

describe("patchConsole", () => {
  it("still calls the original method and captures the call", () => {
    const original = vi.fn();
    const target: Record<string, unknown> = { log: original, warn: original, error: original };
    const cap = createLogCapture({ getDir: () => dir, now: fixedNow });
    patchConsole(cap, target);
    (target.error as (...a: unknown[]) => void)("boom", 42);
    expect(original).toHaveBeenCalledWith("boom", 42);
    expect(cap.recent()[0]).toBe("2026-11-02T10:00:00.000Z [main] ERROR boom 42");
  });
});

describe("rendererConsoleEntry", () => {
  it("reads the event-object form and skips info-level messages", () => {
    expect(rendererConsoleEntry({ level: "error", message: "bad", lineNumber: 3, sourceId: "app.js" })).toEqual({
      level: "error",
      text: "bad (app.js:3)",
    });
    expect(rendererConsoleEntry({ level: "info", message: "hi" })).toBeNull();
  });

  it("reads the legacy positional form", () => {
    expect(rendererConsoleEntry({}, 2, "careful", 0, "")).toEqual({ level: "warn", text: "careful" });
    expect(rendererConsoleEntry({}, 1, "fine")).toBeNull();
  });
});
