import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_KEYBINDINGS,
  loadKeybindings,
  saveKeybindings,
  resetKeybindings,
} from "./keybindings";

// ── localStorage mock ─────────────────────────────────────────────────────────

const store: Record<string, string> = {};

const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};

// Vitest runs in a Node environment — attach mock before tests.
Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// ─────────────────────────────────────────────────────────────────────────────

describe("DEFAULT_KEYBINDINGS", () => {
  it("has at least 15 entries", () => {
    expect(DEFAULT_KEYBINDINGS.length).toBeGreaterThanOrEqual(15);
  });

  it("every entry has required fields", () => {
    for (const kb of DEFAULT_KEYBINDINGS) {
      expect(typeof kb.id).toBe("string");
      expect(kb.id.length).toBeGreaterThan(0);
      expect(typeof kb.label).toBe("string");
      expect(typeof kb.defaultKey).toBe("string");
      expect(typeof kb.defaultKey_code).toBe("string");
    }
  });

  it("all ids are unique", () => {
    const ids = DEFAULT_KEYBINDINGS.map((kb) => kb.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

describe("loadKeybindings", () => {
  beforeEach(() => localStorageMock.clear());
  afterEach(() => localStorageMock.clear());

  it("returns empty object when localStorage has no entry", () => {
    expect(loadKeybindings()).toEqual({});
  });

  it("returns empty object when stored value is invalid JSON", () => {
    localStorageMock.setItem("marven-keybindings", "not-json{{{");
    expect(loadKeybindings()).toEqual({});
  });

  it("returns the stored overrides object", () => {
    const overrides = { "save-file": "Ctrl+S", "find": "⌘F" };
    localStorageMock.setItem("marven-keybindings", JSON.stringify(overrides));
    expect(loadKeybindings()).toEqual(overrides);
  });
});

describe("saveKeybindings + loadKeybindings round-trip", () => {
  beforeEach(() => localStorageMock.clear());
  afterEach(() => localStorageMock.clear());

  it("saves and loads an override", () => {
    saveKeybindings({ "save-file": "⌘S" });
    expect(loadKeybindings()).toEqual({ "save-file": "⌘S" });
  });

  it("overwrites previous overrides on subsequent saves", () => {
    saveKeybindings({ "save-file": "⌘S" });
    saveKeybindings({ "find": "⌘F" });
    expect(loadKeybindings()).toEqual({ "find": "⌘F" });
  });
});

describe("resetKeybindings", () => {
  beforeEach(() => localStorageMock.clear());
  afterEach(() => localStorageMock.clear());

  it("removes the stored key so loadKeybindings returns {}", () => {
    saveKeybindings({ "save-file": "⌘S" });
    expect(loadKeybindings()).not.toEqual({});
    resetKeybindings();
    expect(loadKeybindings()).toEqual({});
  });
});
