import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJsonStore } from "./store.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "marven-browser-store-"));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("createJsonStore", () => {
  it("starts from the fallback when the file is missing", () => {
    const store = createJsonStore(path.join(dir, "a.json"), { n: 0 });
    expect(store.get()).toEqual({ n: 0 });
  });

  it("writes once after the delay, batching changes", () => {
    const file = path.join(dir, "sub", "a.json");
    const store = createJsonStore(file, { n: 0 }, { delayMs: 1000 });
    store.set({ n: 1 });
    store.set({ n: 2 });
    expect(fs.existsSync(file)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ n: 2 });
    expect(fs.readdirSync(path.dirname(file))).toEqual(["a.json"]); // no temp file left behind
  });

  it("flush writes immediately, and only when something changed", () => {
    const file = path.join(dir, "a.json");
    const store = createJsonStore(file, { n: 0 });
    store.flush();
    expect(fs.existsSync(file)).toBe(false);
    store.set({ n: 5 });
    store.flush();
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ n: 5 });
  });

  it("loads what was saved", () => {
    const file = path.join(dir, "a.json");
    fs.writeFileSync(file, JSON.stringify({ n: 9 }));
    expect(createJsonStore(file, { n: 0 }).get()).toEqual({ n: 9 });
  });

  it("moves an unreadable file aside and starts fresh", () => {
    const file = path.join(dir, "a.json");
    fs.writeFileSync(file, "{not json");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createJsonStore(file, { n: 0 });
    expect(store.get()).toEqual({ n: 0 });
    expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe("{not json");
    expect(fs.existsSync(file)).toBe(false);
    errors.mockRestore();
  });

  it("keeps working in memory when a write fails", () => {
    const file = path.join(dir, "a.json");
    const store = createJsonStore(file, { n: 0 });
    fs.mkdirSync(file); // a directory appears where the file should go → rename fails
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    store.set({ n: 1 });
    expect(() => store.flush()).not.toThrow();
    expect(store.get()).toEqual({ n: 1 });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
