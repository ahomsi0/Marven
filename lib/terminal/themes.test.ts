import { describe, it, expect } from "vitest";
import {
  MARVEN_THEMES,
  TERMINAL_PRESETS,
  TERMINAL_COLOR_KEYS,
  isTerminalPresetId,
  resolveTerminalTheme,
} from "./themes";

const COLOR = /^(#[0-9a-f]{6}|rgba\(\d{1,3},\s*\d{1,3},\s*\d{1,3},\s*(0(\.\d+)?|1(\.0+)?)\))$/i;

const ALL = [...Object.values(MARVEN_THEMES), ...TERMINAL_PRESETS];

describe("terminal themes", () => {
  it("ships 12 selectable presets", () => {
    expect(TERMINAL_PRESETS).toHaveLength(12);
  });

  it("defines all 21 colors on every theme, each a valid color", () => {
    expect(TERMINAL_COLOR_KEYS).toHaveLength(21);
    for (const theme of ALL) {
      for (const key of TERMINAL_COLOR_KEYS) {
        const value = theme.colors[key];
        expect(value, `${theme.id}.${key}`).toMatch(COLOR);
      }
    }
  });

  it("uses unique ids that never collide with match-app", () => {
    const ids = ALL.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("match-app");
  });

  it("recognises preset ids only", () => {
    expect(isTerminalPresetId("dracula")).toBe(true);
    expect(isTerminalPresetId("match-app")).toBe(false);
    expect(isTerminalPresetId("marven-dark")).toBe(false);
    expect(isTerminalPresetId("nope")).toBe(false);
  });

  it("maps match-app to the Marven theme for each app theme", () => {
    expect(resolveTerminalTheme("match-app", "dark").id).toBe("marven-dark");
    expect(resolveTerminalTheme("match-app", "midnight").id).toBe("marven-midnight");
    expect(resolveTerminalTheme("match-app", "aurora").id).toBe("marven-aurora");
    // Light app theme keeps a dark terminal, as before.
    expect(resolveTerminalTheme("match-app", "light").id).toBe("marven-dark");
  });

  it("returns the chosen preset regardless of app theme", () => {
    expect(resolveTerminalTheme("nord", "dark").id).toBe("nord");
    expect(resolveTerminalTheme("nord", "light").id).toBe("nord");
  });

  it("treats an unknown id like match-app", () => {
    expect(resolveTerminalTheme("gone-theme", "midnight").id).toBe("marven-midnight");
  });

  it("keeps the Marven themes' original base colors", () => {
    expect(MARVEN_THEMES.dark.colors.background).toBe("#1a1a1a");
    expect(MARVEN_THEMES.midnight.colors.background).toBe("#21252b");
    expect(MARVEN_THEMES.aurora.colors.cursor).toBe("#f97ef8");
  });
});
