import { describe, it, expect } from "vitest";
import {
  MARVEN_THEMES,
  TERMINAL_PRESETS,
  TERMINAL_COLOR_KEYS,
  isTerminalPresetId,
  resolveTerminalTheme,
} from "./themes";

const COLOR = /^(#[0-9a-f]{6}|rgba\((25[0-5]|2[0-4]\d|1?\d?\d),\s*(25[0-5]|2[0-4]\d|1?\d?\d),\s*(25[0-5]|2[0-4]\d|1?\d?\d),\s*(0(\.\d+)?|1(\.0+)?)\))$/i;

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

  it("keeps every theme legible", () => {
    for (const theme of ALL) {
      expect(theme.colors.foreground, theme.id).not.toBe(theme.colors.background);
      expect(theme.colors.brightBlack, theme.id).not.toBe(theme.colors.background);
    }
  });

  it("pins a few canonical values so a wrong key is caught", () => {
    const byId = (id: string) => TERMINAL_PRESETS.find((p) => p.id === id)!;
    expect(byId("dracula").colors.red).toBe("#ff5555");
    expect(byId("nord").colors.blue).toBe("#81a1c1");
    expect(byId("gruvbox-dark").colors.brightYellow).toBe("#fabd2f");
    expect(byId("tokyo-night").colors.magenta).toBe("#bb9af7");
    // Documented deviation: base01, not the canonical base03.
    expect(byId("solarized-dark").colors.brightBlack).toBe("#586e75");
  });

  it("keeps key colors from the original Marven terminal themes", () => {
    expect(MARVEN_THEMES.dark.colors.background).toBe("#1a1a1a");
    expect(MARVEN_THEMES.midnight.colors.background).toBe("#21252b");
    expect(MARVEN_THEMES.aurora.colors.cursor).toBe("#f97ef8");
  });
});
