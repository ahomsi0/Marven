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
    const baks = fs.readdirSync(dir).filter((n) => /^a\.json\.\d+\.bak$/.test(n));
    expect(baks).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, baks[0]), "utf8")).toBe("{not json");
    expect(fs.existsSync(file)).toBe(false);
    errors.mockRestore();
  });

  it("does not overwrite an earlier backup on a second corrupt file", () => {
    const file = path.join(dir, "a.json");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fs.writeFileSync(file, "{first");
    createJsonStore(file, { n: 0 });
    vi.advanceTimersByTime(5);
    fs.writeFileSync(file, "{second");
    createJsonStore(file, { n: 0 });
    const baks = fs.readdirSync(dir).filter((n) => n.endsWith(".bak")).sort();
    expect(baks.map((n) => fs.readFileSync(path.join(dir, n), "utf8"))).toEqual(["{first", "{second"]);
    errors.mockRestore();
  });

  it("never replaces a file it could not read for a reason other than bad JSON", () => {
    const file = path.join(dir, "a.json");
    fs.mkdirSync(file); // reading a directory fails with EISDIR, not a parse error
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createJsonStore(file, { n: 0 });
    expect(store.get()).toEqual({ n: 0 });
    store.set({ n: 1 });
    expect(() => store.flush()).not.toThrow();
    expect(store.get()).toEqual({ n: 1 });
    expect(fs.statSync(file).isDirectory()).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(["a.json"]);
    errors.mockRestore();
  });

  it("leaves the previous file intact when a write fails", () => {
    const file = path.join(dir, "a.json");
    fs.writeFileSync(file, JSON.stringify({ n: 1 }));
    const store = createJsonStore(file, { n: 0 });
    fs.mkdirSync(`${file}.${process.pid}.tmp`); // opening the temp file fails
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    store.set({ n: 2 });
    expect(() => store.flush()).not.toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(JSON.stringify({ n: 1 }));
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("writes the file readable only by the owner", () => {
    const file = path.join(dir, "a.json");
    const store = createJsonStore(file, { n: 0 });
    store.set({ n: 1 });
    store.flush();
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("removes leftover temp files on load", () => {
    const file = path.join(dir, "a.json");
    fs.writeFileSync(file, JSON.stringify({ n: 3 }));
    fs.writeFileSync(`${file}.12345.tmp`, "{half");
    fs.writeFileSync(path.join(dir, "other.json.1.tmp"), "keep");
    expect(createJsonStore(file, { n: 0 }).get()).toEqual({ n: 3 });
    expect(fs.readdirSync(dir).sort()).toEqual(["a.json", "other.json.1.tmp"]);
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
