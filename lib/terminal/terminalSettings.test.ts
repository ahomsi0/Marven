// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DEFAULT_FONT_STACK,
  DEFAULT_TERMINAL_SETTINGS,
  TERMINAL_SETTINGS_EVENT,
  TERMINAL_SETTINGS_KEY,
  getTerminalSettings,
  normalizeTerminalSettings,
  resetTerminalSettings,
  setTerminalSettings,
  terminalFontStack,
} from "./terminalSettings";

beforeEach(() => {
  localStorage.clear();
});

describe("terminal settings", () => {
  it("defaults reproduce today's terminal", () => {
    expect(DEFAULT_TERMINAL_SETTINGS).toEqual({
      theme: "match-app",
      fontFamily: "",
      fontSize: 12,
      lineHeight: 1,
      cursorStyle: "block",
      cursorBlink: true,
    });
  });

  it("returns defaults when nothing is stored", () => {
    expect(getTerminalSettings()).toEqual(DEFAULT_TERMINAL_SETTINGS);
  });

  it("returns defaults for corrupt JSON", () => {
    localStorage.setItem(TERMINAL_SETTINGS_KEY, "{not json");
    expect(getTerminalSettings()).toEqual(DEFAULT_TERMINAL_SETTINGS);
  });

  it("falls back to match-app for an unknown theme id", () => {
    localStorage.setItem(TERMINAL_SETTINGS_KEY, JSON.stringify({ theme: "deleted-theme" }));
    expect(getTerminalSettings().theme).toBe("match-app");
  });

  it("keeps a known preset id", () => {
    localStorage.setItem(TERMINAL_SETTINGS_KEY, JSON.stringify({ theme: "dracula" }));
    expect(getTerminalSettings().theme).toBe("dracula");
  });

  it("clamps font size and line height", () => {
    expect(normalizeTerminalSettings({ fontSize: 99, lineHeight: 9 })).toMatchObject({ fontSize: 20, lineHeight: 1.6 });
    expect(normalizeTerminalSettings({ fontSize: 2, lineHeight: 0.2 })).toMatchObject({ fontSize: 10, lineHeight: 1 });
    expect(normalizeTerminalSettings({ fontSize: 13.6, lineHeight: 1.234 })).toMatchObject({ fontSize: 14, lineHeight: 1.2 });
  });

  it("replaces invalid field types with defaults", () => {
    expect(
      normalizeTerminalSettings({ fontSize: "big", cursorStyle: "beam", cursorBlink: "yes", fontFamily: 7 }),
    ).toEqual(DEFAULT_TERMINAL_SETTINGS);
  });

  it("merges a patch, saves it, and fires the change event", () => {
    const listener = vi.fn();
    window.addEventListener(TERMINAL_SETTINGS_EVENT, listener);
    const next = setTerminalSettings({ theme: "nord", fontSize: 14 });
    window.removeEventListener(TERMINAL_SETTINGS_EVENT, listener);

    expect(next).toEqual({ ...DEFAULT_TERMINAL_SETTINGS, theme: "nord", fontSize: 14 });
    expect(JSON.parse(localStorage.getItem(TERMINAL_SETTINGS_KEY)!)).toEqual(next);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getTerminalSettings()).toEqual(next);
  });

  it("validates patched values too", () => {
    expect(setTerminalSettings({ fontSize: 500 }).fontSize).toBe(20);
  });

  it("reset restores defaults and fires the change event", () => {
    setTerminalSettings({ theme: "nord", cursorStyle: "bar" });
    const listener = vi.fn();
    window.addEventListener(TERMINAL_SETTINGS_EVENT, listener);
    expect(resetTerminalSettings()).toEqual(DEFAULT_TERMINAL_SETTINGS);
    window.removeEventListener(TERMINAL_SETTINGS_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getTerminalSettings()).toEqual(DEFAULT_TERMINAL_SETTINGS);
  });

  it("builds a font stack with the default fallback", () => {
    expect(terminalFontStack("")).toBe(DEFAULT_FONT_STACK);
    expect(terminalFontStack("  ")).toBe(DEFAULT_FONT_STACK);
    expect(terminalFontStack("JetBrains Mono")).toBe(`"JetBrains Mono", ${DEFAULT_FONT_STACK}`);
    expect(terminalFontStack("Menlo")).toBe(`"Menlo", ${DEFAULT_FONT_STACK}`);
    // Quotes and backslashes in a typed name can't break out of the CSS string.
    expect(terminalFontStack('Evil", serif')).toBe(`"Evil, serif", ${DEFAULT_FONT_STACK}`);
  });
});
