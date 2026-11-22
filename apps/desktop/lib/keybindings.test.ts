import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_KEYBINDINGS,
  loadKeybindings,
  saveKeybindings,
  resetKeybindings,
  parseCombo,
  getBindingCombo,
  eventMatchesCombo,
  formatCombo,
  formatBinding,
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

// ── Combo parsing / matching ─────────────────────────────────────────────────

function keyEvent(over: Partial<KeyboardEvent>) {
  return { key: "", code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over } as KeyboardEvent;
}

describe("parseCombo", () => {
  it("reads ⌘ in defaults as the platform modifier", () => {
    expect(parseCombo("⌘⇧P", true, true)).toEqual({ key: "p", meta: true, ctrl: false, alt: false, shift: true });
    expect(parseCombo("⌘⇧P", false, true)).toEqual({ key: "p", meta: false, ctrl: true, alt: false, shift: true });
  });

  it("reads recorded overrides literally", () => {
    expect(parseCombo("⌃⌥K", true)).toEqual({ key: "k", meta: false, ctrl: true, alt: true, shift: false });
    expect(parseCombo("Ctrl+Shift+Win+J", false)).toEqual({ key: "j", meta: true, ctrl: true, alt: false, shift: true });
    expect(parseCombo("Ctrl+`", false, true)).toEqual({ key: "`", meta: false, ctrl: true, alt: false, shift: false });
  });

  it("handles named keys and rejects unfinished combos", () => {
    expect(parseCombo("⇧Space", true)?.key).toBe(" ");
    expect(parseCombo("⌘+", true)?.key).toBe("+");
    expect(parseCombo("Ctrl+", false)).toBeNull();
    expect(parseCombo("", false)).toBeNull();
  });
});

describe("getBindingCombo / eventMatchesCombo", () => {
  it("matches the default command palette binding", () => {
    const combo = getBindingCombo("command-palette", true)!;
    expect(eventMatchesCombo(keyEvent({ key: "p", code: "KeyP", metaKey: true, shiftKey: true }), combo)).toBe(true);
    // Shift makes e.key upper-case on some layouts.
    expect(eventMatchesCombo(keyEvent({ key: "P", code: "KeyP", metaKey: true, shiftKey: true }), combo)).toBe(true);
    // Without shift it's Quick Open, not the palette.
    expect(eventMatchesCombo(keyEvent({ key: "p", code: "KeyP", metaKey: true }), combo)).toBe(false);
  });

  it("uses Ctrl off macOS", () => {
    const combo = getBindingCombo("command-palette", false)!;
    expect(eventMatchesCombo(keyEvent({ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }), combo)).toBe(true);
    expect(eventMatchesCombo(keyEvent({ key: "P", code: "KeyP", metaKey: true, shiftKey: true }), combo)).toBe(false);
  });

  it("honours a remapped binding", () => {
    const combo = getBindingCombo("command-palette", true, { "command-palette": "⌥⌘K" })!;
    expect(eventMatchesCombo(keyEvent({ key: "˚", code: "KeyK", metaKey: true, altKey: true }), combo)).toBe(true);
    expect(eventMatchesCombo(keyEvent({ key: "p", code: "KeyP", metaKey: true, shiftKey: true }), combo)).toBe(false);
  });

  it("returns null for unknown ids", () => {
    expect(getBindingCombo("nope", true)).toBeNull();
  });
});

describe("formatCombo / formatBinding", () => {
  it("formats per platform", () => {
    expect(formatCombo(parseCombo("⌘⇧P", true, true)!, true)).toBe("⇧⌘P");
    expect(formatBinding("command-palette", false)).toBe("Ctrl+Shift+P");
    expect(formatBinding("command-palette", true, { "command-palette": "⌥⌘K" })).toBe("⌥⌘K");
    expect(formatBinding("missing", true)).toBe("");
  });
});
