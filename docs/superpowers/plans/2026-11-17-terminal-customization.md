# Terminal Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people pick a terminal color scheme (12 built-in presets or "Match app theme") and set the terminal's font, size, line height and cursor from a new Settings page, with changes applied live to open terminals.

**Architecture:** The code is split into four units:
- `lib/terminal/themes.ts` holds the preset color data and theme resolution.
- `lib/terminal/terminalSettings.ts` stores the settings in localStorage, validates them, and announces changes with a window event. It also exports a React hook that subscribes to those changes.
- `TerminalView.tsx` reads the settings when it creates the terminal and updates the running xterm when they change.
- `TerminalSettingsPage.tsx` is the new Settings page. `SettingsModal.tsx` only wires it into the nav.

**Tech Stack:** Next.js 15 / React (client components), TypeScript, xterm.js 6 (`@xterm/xterm`, `@xterm/addon-fit`), Tailwind v4 with `var(--m-*)` tokens, i18next (`useT` from `@/lib/i18n`), Vitest (jsdom via `// @vitest-environment jsdom`).

**Spec:** `docs/superpowers/specs/2026-11-17-terminal-customization-design.md`

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `lib/terminal/themes.ts` | Create | Preset data (3 Marven themes + 12 presets) and `resolveTerminalTheme` |
| `lib/terminal/themes.test.ts` | Create | Preset completeness, unique ids, resolution rules |
| `lib/terminal/terminalSettings.ts` | Create | Settings type, defaults, validation, storage, change event, `useTerminalSettings`, `terminalFontStack` |
| `lib/terminal/terminalSettings.test.ts` | Create | Defaults, recovery from bad data, clamping, event dispatch, font stack |
| `app/components/marven/TerminalView.tsx` | Modify | Use settings and presets, apply them live, re-fit after font changes |
| `app/components/marven/TerminalSettingsPage.tsx` | Create | Preview, theme gallery, font and cursor controls |
| `lib/settingsNav.ts` | Modify | Add `"terminal"` to `SETTINGS_PAGES` |
| `app/components/marven/SettingsModal.tsx` | Modify | Nav entry and page render |
| `app/components/marven/ChatLayout.tsx` | Modify | "Terminal: Change theme…" palette command |
| `lib/i18n/settings.en.ts`, `lib/i18n/settings.ar.ts` | Modify | Settings page strings |
| `lib/i18n/en.ts`, `lib/i18n/ar.ts` | Modify | Palette command label |

Commands used throughout:
- Single test file: `npx vitest run <path>`
- Typecheck: `npm run typecheck`

---

### Task 1: Theme presets and resolution

**Files:**
- Create: `lib/terminal/themes.ts`
- Test: `lib/terminal/themes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/terminal/themes.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/terminal/themes.test.ts`
Expected: FAIL — `Failed to resolve import "./themes"`.

- [ ] **Step 3: Write the implementation**

Create `lib/terminal/themes.ts`:

```ts
// Terminal color schemes. Marven's three themes back "Match app theme"; the
// twelve presets are well-known schemes with their published palettes.
// Data only — no React, no storage — so it is easy to test and reuse.

import type { ITheme } from "@xterm/xterm";
import type { Theme } from "@/lib/theme";

export const TERMINAL_COLOR_KEYS = [
  "background", "foreground", "cursor", "cursorAccent", "selectionBackground",
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
] as const;

export type TerminalColorKey = (typeof TERMINAL_COLOR_KEYS)[number];
export type TerminalColors = Required<Pick<ITheme, TerminalColorKey>>;

export interface TerminalThemePreset {
  id: string;
  /** Proper noun; not translated. */
  name: string;
  kind: "dark" | "light";
  colors: TerminalColors;
}

/** "match-app" or a preset id from TERMINAL_PRESETS. */
export type TerminalThemeSetting = string;
export const MATCH_APP = "match-app";

export const MARVEN_THEMES: Record<"dark" | "midnight" | "aurora", TerminalThemePreset> = {
  dark: {
    id: "marven-dark",
    name: "Marven Dark",
    kind: "dark",
    colors: {
      background: "#1a1a1a", foreground: "#d4d4d4", cursor: "#d4d4d4", cursorAccent: "#1a1a1a",
      selectionBackground: "rgba(209,154,102,0.3)",
      black: "#3a3a3a", red: "#e06c75", green: "#98c379", yellow: "#e5c07b",
      blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#d4d4d4",
      brightBlack: "#6b6b6b", brightRed: "#ef8891", brightGreen: "#b0d98f", brightYellow: "#f0d197",
      brightBlue: "#82c0f5", brightMagenta: "#d699e8", brightCyan: "#74c9d3", brightWhite: "#ffffff",
    },
  },
  midnight: {
    id: "marven-midnight",
    name: "Marven Midnight",
    kind: "dark",
    colors: {
      background: "#21252b", foreground: "#abb2bf", cursor: "#abb2bf", cursorAccent: "#21252b",
      selectionBackground: "rgba(97,175,239,0.3)",
      black: "#3f4451", red: "#e06c75", green: "#98c379", yellow: "#e5c07b",
      blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#abb2bf",
      brightBlack: "#5c6370", brightRed: "#ec8189", brightGreen: "#a9d18c", brightYellow: "#ecc98a",
      brightBlue: "#7cbcf2", brightMagenta: "#d18ee6", brightCyan: "#6ec5d0", brightWhite: "#e6e6e6",
    },
  },
  aurora: {
    id: "marven-aurora",
    name: "Marven Aurora",
    kind: "dark",
    colors: {
      background: "#1a1229", foreground: "#f0e6d3", cursor: "#f97ef8", cursorAccent: "#1a1229",
      selectionBackground: "rgba(249,126,248,0.25)",
      black: "#2d2140", red: "#ff6b8b", green: "#7ee2a8", yellow: "#ffd479",
      blue: "#7aa2ff", magenta: "#f97ef8", cyan: "#6ee7f0", white: "#f0e6d3",
      brightBlack: "#6a5a85", brightRed: "#ff8fa6", brightGreen: "#9ef0bf", brightYellow: "#ffe19c",
      brightBlue: "#9bbaff", brightMagenta: "#fca1fb", brightCyan: "#95f0f5", brightWhite: "#ffffff",
    },
  },
};

export const TERMINAL_PRESETS: readonly TerminalThemePreset[] = [
  {
    id: "one-dark", name: "One Dark", kind: "dark",
    colors: {
      background: "#282c34", foreground: "#abb2bf", cursor: "#528bff", cursorAccent: "#282c34",
      selectionBackground: "#3e4451",
      black: "#282c34", red: "#e06c75", green: "#98c379", yellow: "#e5c07b",
      blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#abb2bf",
      brightBlack: "#5c6370", brightRed: "#e06c75", brightGreen: "#98c379", brightYellow: "#e5c07b",
      brightBlue: "#61afef", brightMagenta: "#c678dd", brightCyan: "#56b6c2", brightWhite: "#ffffff",
    },
  },
  {
    id: "dracula", name: "Dracula", kind: "dark",
    colors: {
      background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2", cursorAccent: "#282a36",
      selectionBackground: "#44475a",
      black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c",
      blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
      brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94", brightYellow: "#ffffa5",
      brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff",
    },
  },
  {
    id: "nord", name: "Nord", kind: "dark",
    colors: {
      background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", cursorAccent: "#2e3440",
      selectionBackground: "#434c5e",
      black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
      blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
      brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c", brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4",
    },
  },
  {
    id: "catppuccin-mocha", name: "Catppuccin Mocha", kind: "dark",
    colors: {
      background: "#1e1e2e", foreground: "#cdd6f4", cursor: "#f5e0dc", cursorAccent: "#1e1e2e",
      selectionBackground: "#585b70",
      black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af",
      blue: "#89b4fa", magenta: "#f5c2e7", cyan: "#94e2d5", white: "#bac2de",
      brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1", brightYellow: "#f9e2af",
      brightBlue: "#89b4fa", brightMagenta: "#f5c2e7", brightCyan: "#94e2d5", brightWhite: "#a6adc8",
    },
  },
  {
    id: "catppuccin-latte", name: "Catppuccin Latte", kind: "light",
    colors: {
      background: "#eff1f5", foreground: "#4c4f69", cursor: "#dc8a78", cursorAccent: "#eff1f5",
      selectionBackground: "#acb0be",
      black: "#5c5f77", red: "#d20f39", green: "#40a02b", yellow: "#df8e1d",
      blue: "#1e66f5", magenta: "#ea76cb", cyan: "#179299", white: "#acb0be",
      brightBlack: "#6c6f85", brightRed: "#d20f39", brightGreen: "#40a02b", brightYellow: "#df8e1d",
      brightBlue: "#1e66f5", brightMagenta: "#ea76cb", brightCyan: "#179299", brightWhite: "#bcc0cc",
    },
  },
  {
    id: "gruvbox-dark", name: "Gruvbox Dark", kind: "dark",
    colors: {
      background: "#282828", foreground: "#ebdbb2", cursor: "#ebdbb2", cursorAccent: "#282828",
      selectionBackground: "#504945",
      black: "#282828", red: "#cc241d", green: "#98971a", yellow: "#d79921",
      blue: "#458588", magenta: "#b16286", cyan: "#689d6a", white: "#a89984",
      brightBlack: "#928374", brightRed: "#fb4934", brightGreen: "#b8bb26", brightYellow: "#fabd2f",
      brightBlue: "#83a598", brightMagenta: "#d3869b", brightCyan: "#8ec07c", brightWhite: "#ebdbb2",
    },
  },
  {
    id: "tokyo-night", name: "Tokyo Night", kind: "dark",
    colors: {
      background: "#1a1b26", foreground: "#c0caf5", cursor: "#c0caf5", cursorAccent: "#1a1b26",
      selectionBackground: "#33467c",
      black: "#15161e", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68",
      blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#a9b1d6",
      brightBlack: "#414868", brightRed: "#f7768e", brightGreen: "#9ece6a", brightYellow: "#e0af68",
      brightBlue: "#7aa2f7", brightMagenta: "#bb9af7", brightCyan: "#7dcfff", brightWhite: "#c0caf5",
    },
  },
  {
    // brightBlack is base01 rather than the canonical base03, which equals the
    // background and would make "bright black" text invisible.
    id: "solarized-dark", name: "Solarized Dark", kind: "dark",
    colors: {
      background: "#002b36", foreground: "#839496", cursor: "#93a1a1", cursorAccent: "#002b36",
      selectionBackground: "#073642",
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
      blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83",
      brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
  },
  {
    id: "solarized-light", name: "Solarized Light", kind: "light",
    colors: {
      background: "#fdf6e3", foreground: "#657b83", cursor: "#586e75", cursorAccent: "#fdf6e3",
      selectionBackground: "#eee8d5",
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
      blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83",
      brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
  },
  {
    id: "monokai", name: "Monokai", kind: "dark",
    colors: {
      background: "#272822", foreground: "#f8f8f2", cursor: "#f8f8f0", cursorAccent: "#272822",
      selectionBackground: "#49483e",
      black: "#272822", red: "#f92672", green: "#a6e22e", yellow: "#f4bf75",
      blue: "#66d9ef", magenta: "#ae81ff", cyan: "#a1efe4", white: "#f8f8f2",
      brightBlack: "#75715e", brightRed: "#f92672", brightGreen: "#a6e22e", brightYellow: "#f4bf75",
      brightBlue: "#66d9ef", brightMagenta: "#ae81ff", brightCyan: "#a1efe4", brightWhite: "#f9f8f5",
    },
  },
  {
    id: "github-dark", name: "GitHub Dark", kind: "dark",
    colors: {
      background: "#0d1117", foreground: "#e6edf3", cursor: "#2f81f7", cursorAccent: "#0d1117",
      selectionBackground: "rgba(56,139,253,0.4)",
      black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922",
      blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39c5cf", white: "#b1bac4",
      brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364", brightYellow: "#e3b341",
      brightBlue: "#79c0ff", brightMagenta: "#d2a8ff", brightCyan: "#56d4dd", brightWhite: "#ffffff",
    },
  },
  {
    id: "rose-pine", name: "Rosé Pine", kind: "dark",
    colors: {
      background: "#191724", foreground: "#e0def4", cursor: "#e0def4", cursorAccent: "#191724",
      selectionBackground: "#403d52",
      black: "#26233a", red: "#eb6f92", green: "#31748f", yellow: "#f6c177",
      blue: "#9ccfd8", magenta: "#c4a7e7", cyan: "#ebbcba", white: "#e0def4",
      brightBlack: "#6e6a86", brightRed: "#eb6f92", brightGreen: "#31748f", brightYellow: "#f6c177",
      brightBlue: "#9ccfd8", brightMagenta: "#c4a7e7", brightCyan: "#ebbcba", brightWhite: "#e0def4",
    },
  },
];

const PRESET_BY_ID = new Map(TERMINAL_PRESETS.map((p) => [p.id, p]));

export function isTerminalPresetId(id: string): boolean {
  return PRESET_BY_ID.has(id);
}

/** The Marven theme "Match app theme" uses for an app theme. Light keeps a dark terminal. */
export function marvenThemeFor(appTheme: Theme): TerminalThemePreset {
  if (appTheme === "midnight") return MARVEN_THEMES.midnight;
  if (appTheme === "aurora") return MARVEN_THEMES.aurora;
  return MARVEN_THEMES.dark;
}

/** Colors to render: the chosen preset, or the app-matched Marven theme for match-app / unknown ids. */
export function resolveTerminalTheme(setting: TerminalThemeSetting, appTheme: Theme): TerminalThemePreset {
  return PRESET_BY_ID.get(setting) ?? marvenThemeFor(appTheme);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/terminal/themes.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/terminal/themes.ts lib/terminal/themes.test.ts
git commit -m "Add terminal color scheme presets and theme resolution"
```

---

### Task 2: Terminal settings storage

**Files:**
- Create: `lib/terminal/terminalSettings.ts`
- Test: `lib/terminal/terminalSettings.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/terminal/terminalSettings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/terminal/terminalSettings.test.ts`
Expected: FAIL — `Failed to resolve import "./terminalSettings"`.

- [ ] **Step 3: Write the implementation**

Create `lib/terminal/terminalSettings.ts`:

```ts
"use client";

// ── Terminal settings ─────────────────────────────────────────────────────────
// Theme, font and cursor for the built-in terminal. Stored as one JSON value in
// localStorage (same approach as lib/formatOnSave.ts). Every read is validated,
// so a corrupt or hand-edited value can never break the terminal. Writes fire
// TERMINAL_SETTINGS_EVENT so open terminals update without a restart.

import { useEffect, useState } from "react";
import { MATCH_APP, isTerminalPresetId, type TerminalThemeSetting } from "./themes";

export type TerminalCursorStyle = "block" | "bar" | "underline";

export interface TerminalSettings {
  theme: TerminalThemeSetting;
  /** "" means Marven's default monospace stack. */
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: TerminalCursorStyle;
  cursorBlink: boolean;
}

export const TERMINAL_SETTINGS_KEY = "marven-terminal-settings";
export const TERMINAL_SETTINGS_EVENT = "marven:terminal-settings";
export const DEFAULT_FONT_STACK = "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace";
export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 20;
export const LINE_HEIGHT_MIN = 1;
export const LINE_HEIGHT_MAX = 1.6;
export const CURSOR_STYLES: readonly TerminalCursorStyle[] = ["block", "bar", "underline"];

export const DEFAULT_TERMINAL_SETTINGS: Readonly<TerminalSettings> = Object.freeze({
  theme: MATCH_APP,
  fontFamily: "",
  fontSize: 12,
  lineHeight: 1,
  cursorStyle: "block",
  cursorBlink: true,
});

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Turns any value into valid settings: bad or missing fields get defaults, numbers are clamped. */
export function normalizeTerminalSettings(raw: unknown): TerminalSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_TERMINAL_SETTINGS;
  return {
    theme: typeof r.theme === "string" && (r.theme === MATCH_APP || isTerminalPresetId(r.theme)) ? r.theme : d.theme,
    fontFamily: typeof r.fontFamily === "string" ? r.fontFamily.trim().slice(0, 100) : d.fontFamily,
    fontSize: isFiniteNumber(r.fontSize) ? Math.round(clamp(r.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX)) : d.fontSize,
    lineHeight: isFiniteNumber(r.lineHeight)
      ? Math.round(clamp(r.lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX) * 10) / 10
      : d.lineHeight,
    cursorStyle: CURSOR_STYLES.includes(r.cursorStyle as TerminalCursorStyle)
      ? (r.cursorStyle as TerminalCursorStyle)
      : d.cursorStyle,
    cursorBlink: typeof r.cursorBlink === "boolean" ? r.cursorBlink : d.cursorBlink,
  };
}

export function getTerminalSettings(): TerminalSettings {
  if (typeof window === "undefined") return { ...DEFAULT_TERMINAL_SETTINGS };
  try {
    const raw = localStorage.getItem(TERMINAL_SETTINGS_KEY);
    return normalizeTerminalSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return { ...DEFAULT_TERMINAL_SETTINGS };
  }
}

function announce(settings: TerminalSettings): void {
  window.dispatchEvent(new CustomEvent<TerminalSettings>(TERMINAL_SETTINGS_EVENT, { detail: settings }));
}

export function setTerminalSettings(patch: Partial<TerminalSettings>): TerminalSettings {
  const next = normalizeTerminalSettings({ ...getTerminalSettings(), ...patch });
  if (typeof window === "undefined") return next;
  try {
    localStorage.setItem(TERMINAL_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: still apply for this session.
  }
  announce(next);
  return next;
}

export function resetTerminalSettings(): TerminalSettings {
  const next = { ...DEFAULT_TERMINAL_SETTINGS };
  if (typeof window === "undefined") return next;
  try {
    localStorage.removeItem(TERMINAL_SETTINGS_KEY);
  } catch {
    // ignore
  }
  announce(next);
  return next;
}

/** CSS font-family value: the chosen font (quoted) followed by the default stack. */
export function terminalFontStack(fontFamily: string): string {
  const name = fontFamily.replace(/["\\]/g, "").trim();
  return name ? `"${name}", ${DEFAULT_FONT_STACK}` : DEFAULT_FONT_STACK;
}

/** Current settings, kept up to date across this window and other Marven windows. */
export function useTerminalSettings(): TerminalSettings {
  const [settings, setSettings] = useState<TerminalSettings>(() => ({ ...DEFAULT_TERMINAL_SETTINGS }));
  useEffect(() => {
    const sync = () => setSettings(getTerminalSettings());
    const onStorage = (e: StorageEvent) => {
      if (e.key === TERMINAL_SETTINGS_KEY || e.key === null) sync();
    };
    sync();
    window.addEventListener(TERMINAL_SETTINGS_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TERMINAL_SETTINGS_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return settings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/terminal/terminalSettings.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/terminal/terminalSettings.ts lib/terminal/terminalSettings.test.ts
git commit -m "Add validated, event-driven terminal settings storage"
```

---

### Task 3: Apply settings in TerminalView

**Files:**
- Modify: `app/components/marven/TerminalView.tsx`

There is no unit test for this task. xterm needs a real canvas, and the repo has no component tests for it. It is checked with typecheck here and by hand in Task 7.

- [ ] **Step 1: Replace the imports and the hardcoded themes**

In `app/components/marven/TerminalView.tsx`, add these imports after the existing `import type { Theme } from "@/lib/theme";` line:

```ts
import { resolveTerminalTheme } from "@/lib/terminal/themes";
import {
  getTerminalSettings,
  terminalFontStack,
  useTerminalSettings,
  type TerminalSettings,
} from "@/lib/terminal/terminalSettings";
```

Delete everything from the comment `// xterm theme objects. Light mode keeps the traditional dark terminal look` through the end of `function xtermTheme(t: Theme) { ... }`. That covers `DARK_THEME`, `MIDNIGHT_THEME`, `AURORA_THEME` and `xtermTheme`. Put this in their place:

```ts
// xterm options derived from the terminal settings and the app theme.
// "Match app theme" resolves to Marven's own scheme for the current app theme.
function xtermOptions(settings: TerminalSettings, appTheme: Theme) {
  return {
    theme: resolveTerminalTheme(settings.theme, appTheme).colors,
    fontFamily: terminalFontStack(settings.fontFamily),
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    cursorStyle: settings.cursorStyle,
    cursorBlink: settings.cursorBlink,
  };
}
```

- [ ] **Step 2: Build the terminal from the saved settings**

Replace the constructor call:

```ts
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
      scrollback: 5000,
      allowProposedApi: true,
      theme: xtermTheme(theme),
    });
```

with:

```ts
    // Read settings directly (not from the hook's state) so the very first
    // frame already uses them instead of flashing the defaults.
    const term = new Terminal({
      ...xtermOptions(getTerminalSettings(), theme),
      scrollback: 5000,
      allowProposedApi: true,
    });
```

- [ ] **Step 3: Replace the theme effect with a live settings effect**

Add this line as the first line inside `TerminalView`, directly above `const containerRef = useRef<HTMLDivElement>(null);`:

```ts
  const settings = useTerminalSettings();
```

Then replace the whole theme-swap effect:

```ts
  // Theme swap — apply colors without recreating the terminal.
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    t.options.theme = xtermTheme(theme);
  }, [theme]);
```

with:

```ts
  // Settings or app theme changed — update the running terminal in place so
  // the shell keeps running. Font changes alter the cell size, so re-fit on the
  // next frame and again once any newly chosen font has finished loading.
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    const next = xtermOptions(settings, theme);
    const fontChanged =
      t.options.fontFamily !== next.fontFamily ||
      t.options.fontSize !== next.fontSize ||
      t.options.lineHeight !== next.lineHeight;
    t.options.theme = next.theme;
    t.options.fontFamily = next.fontFamily;
    t.options.fontSize = next.fontSize;
    t.options.lineHeight = next.lineHeight;
    t.options.cursorStyle = next.cursorStyle;
    t.options.cursorBlink = next.cursorBlink;
    if (!fontChanged) return;

    let cancelled = false;
    const refit = () => {
      if (cancelled) return;
      try { fitRef.current?.fit(); } catch {}
    };
    const raf = requestAnimationFrame(refit);
    document.fonts?.ready.then(refit).catch(() => {});
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [settings, theme]);
```

- [ ] **Step 4: Paint the wrapper with the resolved theme**

In the returned `<div>`'s `style`, replace:

```ts
        background: xtermTheme(theme).background,
```

with:

```ts
        background: resolveTerminalTheme(settings.theme, theme).colors.background,
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exits 0 with no errors. Also confirm nothing still uses the removed function: `grep -n "xtermTheme" app/components/marven/TerminalView.tsx` should print nothing.

- [ ] **Step 6: Commit**

```bash
git add app/components/marven/TerminalView.tsx
git commit -m "Drive the terminal's theme, font and cursor from terminal settings"
```

---

### Task 4: Translation strings

**Files:**
- Modify: `lib/i18n/settings.en.ts`, `lib/i18n/settings.ar.ts`, `lib/i18n/en.ts`, `lib/i18n/ar.ts`

- [ ] **Step 1: Add the page title (English)**

In `lib/i18n/settings.en.ts`, inside `pages`, insert after the line `    keyboard: { title: "Keyboard", description: "Keyboard shortcut reference and customization." },`:

```ts
    terminal: { title: "Terminal", description: "Color theme, font and cursor for the built-in terminal." },
```

- [ ] **Step 2: Add the page strings (English)**

In `lib/i18n/settings.en.ts`, insert directly above the line `  keyboard: {` whose next line is `    capturing: "Press a key combo, or Escape to cancel",`:

```ts
  terminal: {
    preview: "Preview",
    theme: "Theme",
    matchApp: "Match app theme",
    fontAndCursor: "Font and cursor",
    font: "Font",
    fontDefault: "Default (SF Mono / Menlo)",
    fontCustom: "Custom…",
    fontCustomPlaceholder: "Installed font name, e.g. Hack Nerd Font",
    fontCustomHint: "The font must be installed on this computer. If it isn't, the default font is used.",
    size: "Size",
    lineHeight: "Line height",
    cursor: "Cursor",
    cursorBlock: "Block",
    cursorBar: "Bar",
    cursorUnderline: "Underline",
    blink: "Blink",
    reset: "Reset to defaults",
  },
```

- [ ] **Step 3: Add the page title (Arabic)**

In `lib/i18n/settings.ar.ts`, inside `pages`, insert after the line `    keyboard: { title: "لوحة المفاتيح", description: "مرجع اختصارات لوحة المفاتيح وتخصيصها." },`:

```ts
    terminal: { title: "الطرفية", description: "سمة الألوان والخط والمؤشر للطرفية المدمجة." },
```

- [ ] **Step 4: Add the page strings (Arabic)**

In `lib/i18n/settings.ar.ts`, insert directly above the line `  keyboard: {` whose next line is `    capturing: "اضغط مجموعة مفاتيح، أو Escape للإلغاء",`:

```ts
  terminal: {
    preview: "معاينة",
    theme: "السمة",
    matchApp: "مطابقة سمة التطبيق",
    fontAndCursor: "الخط والمؤشر",
    font: "الخط",
    fontDefault: "الافتراضي (SF Mono / Menlo)",
    fontCustom: "مخصص…",
    fontCustomPlaceholder: "اسم خط مثبّت، مثل Hack Nerd Font",
    fontCustomHint: "يجب أن يكون الخط مثبّتًا على هذا الجهاز، وإلا يُستخدم الخط الافتراضي.",
    size: "الحجم",
    lineHeight: "ارتفاع السطر",
    cursor: "المؤشر",
    cursorBlock: "كتلة",
    cursorBar: "شريط",
    cursorUnderline: "خط سفلي",
    blink: "وميض",
    reset: "استعادة الافتراضيات",
  },
```

- [ ] **Step 5: Add the palette label**

In `lib/i18n/en.ts`, insert after `      keyboardShortcuts: "Keyboard shortcuts",`:

```ts
      terminalTheme: "Terminal: Change theme…",
```

In `lib/i18n/ar.ts`, insert after `      keyboardShortcuts: "اختصارات لوحة المفاتيح",`:

```ts
      terminalTheme: "الطرفية: تغيير السمة…",
```

- [ ] **Step 6: Run the i18n tests and typecheck**

Run: `npx vitest run lib/i18n/i18n.test.ts && npm run typecheck`
Expected: i18n tests PASS (Arabic has every English key) and typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add lib/i18n/settings.en.ts lib/i18n/settings.ar.ts lib/i18n/en.ts lib/i18n/ar.ts
git commit -m "Add English and Arabic strings for terminal settings"
```

---

### Task 5: Terminal settings page component

**Files:**
- Create: `app/components/marven/TerminalSettingsPage.tsx`

- [ ] **Step 1: Write the component**

Create `app/components/marven/TerminalSettingsPage.tsx`:

```tsx
"use client";

// Settings → Terminal. Theme gallery, font and cursor controls, and a static
// preview drawn with the selected theme's ANSI colors. Every change saves at
// once and reaches open terminals through terminalSettings' change event.

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import {
  MATCH_APP,
  TERMINAL_PRESETS,
  marvenThemeFor,
  resolveTerminalTheme,
  type TerminalColors,
} from "@/lib/terminal/themes";
import {
  CURSOR_STYLES,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  resetTerminalSettings,
  setTerminalSettings,
  terminalFontStack,
  useTerminalSettings,
  type TerminalCursorStyle,
  type TerminalSettings,
} from "@/lib/terminal/terminalSettings";

const FONT_CHOICES = ["JetBrains Mono", "Fira Code", "Cascadia Code", "Source Code Pro"] as const;
const CUSTOM = "__custom__";

// Literal keys (as const) so the typed t() from lib/i18n accepts them.
const CURSOR_LABEL_KEY = {
  block: "settings.terminal.cursorBlock",
  bar: "settings.terminal.cursorBar",
  underline: "settings.terminal.cursorUnderline",
} as const satisfies Record<TerminalCursorStyle, string>;

function Cursor({ colors, style }: { colors: TerminalColors; style: TerminalCursorStyle }) {
  if (style === "bar") {
    return <span style={{ display: "inline-block", width: 2, height: "1.1em", verticalAlign: "text-bottom", background: colors.cursor }} />;
  }
  if (style === "underline") {
    return <span style={{ display: "inline-block", width: "0.6em", borderBottom: `2px solid ${colors.cursor}` }}>&nbsp;</span>;
  }
  return <span style={{ background: colors.cursor, color: colors.cursorAccent }}>&nbsp;</span>;
}

/** Full preview: prompt, ls, an error and a warning in the theme's ANSI colors. */
function TerminalSample({ colors, settings }: { colors: TerminalColors; settings: TerminalSettings }) {
  return (
    <div
      dir="ltr"
      aria-hidden
      className="overflow-hidden rounded-lg border border-[var(--m-border-subtle)] px-3.5 py-3"
      style={{
        background: colors.background,
        color: colors.foreground,
        fontFamily: terminalFontStack(settings.fontFamily),
        fontSize: settings.fontSize,
        lineHeight: settings.lineHeight + 0.2,
        whiteSpace: "pre",
      }}
    >
      <div>
        <span style={{ color: colors.green }}>~/marven</span> <span style={{ color: colors.magenta }}>git:(main)</span> $ ls
      </div>
      <div>
        <span style={{ color: colors.blue }}>app</span>  <span style={{ color: colors.blue }}>lib</span>  <span style={{ color: colors.cyan }}>scripts</span>  package.json  <span style={{ color: colors.brightBlack }}>.env.local</span>
      </div>
      <div>
        <span style={{ color: colors.red }}>✗ 1 test failed</span>  <span style={{ color: colors.yellow }}>⚠ 2 warnings</span>
      </div>
      <div>
        <span style={{ color: colors.green }}>~/marven</span> $ <Cursor colors={colors} style={settings.cursorStyle} />
      </div>
    </div>
  );
}

/** Small swatch for a theme card. */
function MiniSample({ colors }: { colors: TerminalColors }) {
  return (
    <div
      dir="ltr"
      aria-hidden
      className="h-[58px] px-2.5 py-2 font-mono text-[11px] leading-[1.5]"
      style={{ background: colors.background, color: colors.foreground, whiteSpace: "pre" }}
    >
      <div><span style={{ color: colors.green }}>~</span> $ ls</div>
      <div>
        <span style={{ color: colors.blue }}>src</span> <span style={{ color: colors.magenta }}>pkg</span> <span style={{ color: colors.red }}>err</span> <span style={{ color: colors.yellow }}>warn</span>
      </div>
    </div>
  );
}

export function TerminalSettingsPage() {
  const { t } = useT();
  const { theme: appTheme } = useTheme();
  const settings = useTerminalSettings();
  const colors = resolveTerminalTheme(settings.theme, appTheme).colors;

  const isPresetFont = settings.fontFamily === "" || (FONT_CHOICES as readonly string[]).includes(settings.fontFamily);
  const [customOpen, setCustomOpen] = useState(!isPresetFont);
  const [customDraft, setCustomDraft] = useState(isPresetFont ? "" : settings.fontFamily);

  // Settings load after mount (and can change in another window): keep the
  // font menu in step with the stored value.
  useEffect(() => {
    if (!isPresetFont) {
      setCustomOpen(true);
      setCustomDraft(settings.fontFamily);
    }
  }, [isPresetFont, settings.fontFamily]);

  const fontSelectValue = customOpen ? CUSTOM : settings.fontFamily;

  const cards: Array<{ id: string; name: string; colors: TerminalColors }> = [
    { id: MATCH_APP, name: t("settings.terminal.matchApp"), colors: marvenThemeFor(appTheme).colors },
    ...TERMINAL_PRESETS.map((p) => ({ id: p.id, name: p.name, colors: p.colors })),
  ];

  const commitCustomFont = () => {
    if (customDraft.trim() !== settings.fontFamily) setTerminalSettings({ fontFamily: customDraft });
  };

  return (
    <div className="space-y-6">
      {/* Preview */}
      <section>
        <p className="mb-2 text-[12px] font-medium text-[var(--m-text-muted)]">{t("settings.terminal.preview")}</p>
        <TerminalSample colors={colors} settings={settings} />
      </section>

      {/* Theme gallery */}
      <section>
        <p className="mb-2 text-[12px] font-medium text-[var(--m-text-muted)]">{t("settings.terminal.theme")}</p>
        <div role="radiogroup" aria-label={t("settings.terminal.theme")} className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
          {cards.map((card) => {
            const selected = settings.theme === card.id;
            return (
              <button
                key={card.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTerminalSettings({ theme: card.id })}
                className={`overflow-hidden rounded-lg text-start transition-colors ${
                  selected
                    ? "ring-2 ring-[var(--m-accent)]"
                    : "ring-1 ring-[var(--m-border-subtle)] hover:ring-[var(--m-border)]"
                }`}
              >
                <MiniSample colors={card.colors} />
                <div className="truncate border-t border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-2.5 py-1.5 text-[12px] text-[var(--m-text-muted)]">
                  {card.name}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Font and cursor */}
      <section className="space-y-3">
        <p className="text-[12px] font-medium text-[var(--m-text-muted)]">{t("settings.terminal.fontAndCursor")}</p>

        <div className="flex items-start gap-3">
          <label htmlFor="terminal-font" className="w-28 shrink-0 pt-1.5 text-[13px] text-[var(--m-text-muted)]">
            {t("settings.terminal.font")}
          </label>
          <div className="min-w-0 flex-1 space-y-2">
            <select
              id="terminal-font"
              value={fontSelectValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === CUSTOM) {
                  setCustomOpen(true);
                  return;
                }
                setCustomOpen(false);
                setTerminalSettings({ fontFamily: v });
              }}
              className="w-full rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--m-text)] outline-none focus:border-[var(--m-accent)]/50"
            >
              <option value="">{t("settings.terminal.fontDefault")}</option>
              {FONT_CHOICES.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
              <option value={CUSTOM}>{t("settings.terminal.fontCustom")}</option>
            </select>
            {customOpen && (
              <div>
                <input
                  type="text"
                  value={customDraft}
                  onChange={(e) => setCustomDraft(e.target.value)}
                  onBlur={commitCustomFont}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitCustomFont();
                  }}
                  placeholder={t("settings.terminal.fontCustomPlaceholder")}
                  className="w-full rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2.5 py-1.5 font-mono text-[13px] text-[var(--m-text)] outline-none focus:border-[var(--m-accent)]/50"
                />
                <p className="mt-1 text-[11px] text-[var(--m-text-faint)]">{t("settings.terminal.fontCustomHint")}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="terminal-size" className="w-28 shrink-0 text-[13px] text-[var(--m-text-muted)]">
            {t("settings.terminal.size")}
          </label>
          <input
            id="terminal-size"
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={settings.fontSize}
            onChange={(e) => setTerminalSettings({ fontSize: Number(e.target.value) })}
            className="flex-1 accent-[var(--m-accent)]"
          />
          <span className="w-12 text-end font-mono text-[12px] text-[var(--m-text)]">{settings.fontSize}px</span>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="terminal-line-height" className="w-28 shrink-0 text-[13px] text-[var(--m-text-muted)]">
            {t("settings.terminal.lineHeight")}
          </label>
          <input
            id="terminal-line-height"
            type="range"
            min={LINE_HEIGHT_MIN}
            max={LINE_HEIGHT_MAX}
            step={0.1}
            value={settings.lineHeight}
            onChange={(e) => setTerminalSettings({ lineHeight: Number(e.target.value) })}
            className="flex-1 accent-[var(--m-accent)]"
          />
          <span className="w-12 text-end font-mono text-[12px] text-[var(--m-text)]">{settings.lineHeight.toFixed(1)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="w-28 shrink-0 text-[13px] text-[var(--m-text-muted)]">{t("settings.terminal.cursor")}</span>
          <div role="radiogroup" aria-label={t("settings.terminal.cursor")} className="flex rounded-md border border-[var(--m-border)] p-0.5">
            {CURSOR_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={settings.cursorStyle === style}
                onClick={() => setTerminalSettings({ cursorStyle: style })}
                className={`rounded px-3 py-1 text-[12px] transition-colors ${
                  settings.cursorStyle === style
                    ? "bg-[var(--m-surface-3)] text-[var(--m-text)]"
                    : "text-[var(--m-text-muted)] hover:text-[var(--m-text)]"
                }`}
              >
                {t(CURSOR_LABEL_KEY[style])}
              </button>
            ))}
          </div>
          <label className="ms-2 flex items-center gap-2 text-[13px] text-[var(--m-text-muted)]">
            <input
              type="checkbox"
              checked={settings.cursorBlink}
              onChange={(e) => setTerminalSettings({ cursorBlink: e.target.checked })}
              className="accent-[var(--m-accent)]"
            />
            {t("settings.terminal.blink")}
          </label>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            resetTerminalSettings();
            setCustomOpen(false);
            setCustomDraft("");
          }}
          className="rounded-md border border-[var(--m-border)] px-3 py-1.5 text-[12px] text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
        >
          {t("settings.terminal.reset")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0. The component isn't rendered anywhere yet, so this only checks that it compiles.

- [ ] **Step 3: Commit**

```bash
git add app/components/marven/TerminalSettingsPage.tsx
git commit -m "Add the Terminal settings page component"
```

---

### Task 6: Wire the page into Settings and the command palette

**Files:**
- Modify: `lib/settingsNav.ts`
- Modify: `app/components/marven/SettingsModal.tsx`
- Modify: `app/components/marven/ChatLayout.tsx`

- [ ] **Step 1: Register the page id**

In `lib/settingsNav.ts`, in `SETTINGS_PAGES`, insert `"terminal",` directly after `"keyboard",`:

```ts
  "shortcuts",
  "keyboard",
  "terminal",
  "templates",
```

- [ ] **Step 2: Add the nav entry and render the page**

In `app/components/marven/SettingsModal.tsx`:

1. Add this import after the line `import type { VoiceState } from "@/hooks/useVoice";`:

```ts
import { TerminalSettingsPage } from "@/app/components/marven/TerminalSettingsPage";
```

2. In `SECTIONS`, change:

```ts
  { heading: "customization", items: ["shortcuts", "keyboard", "templates"] },
```

to:

```ts
  { heading: "customization", items: ["shortcuts", "keyboard", "terminal", "templates"] },
```

3. In `renderPageContent()`, insert directly above the comment `{/* ── Keyboard ── */}`:

```tsx
        {/* ── Terminal ── */}
        {activePage === "terminal" && <TerminalSettingsPage />}

```

- [ ] **Step 3: Add the palette command**

In `app/components/marven/ChatLayout.tsx`, in the general commands list, insert this object directly after the `keyboard-shortcuts` command (the one whose action is `() => openSettingsAt("keyboard")`):

```ts
      {
        id: "terminal-theme",
        group: general,
        label: t("palette.commands.terminalTheme"),
        action: () => openSettingsAt("terminal"),
      },
```

The existing "Go to Settings page…" command builds its list from `SETTINGS_PAGES`, so Terminal shows up there automatically.

- [ ] **Step 4: Typecheck and run the full test suite**

Run: `npm run typecheck && npm test`
Expected: typecheck exits 0 and every test passes, including the new `lib/terminal/*` tests and the i18n parity test.

- [ ] **Step 5: Commit**

```bash
git add lib/settingsNav.ts app/components/marven/SettingsModal.tsx app/components/marven/ChatLayout.tsx
git commit -m "Add Terminal to Settings and a palette command to open it"
```

---

### Task 7: Hands-on check in the running app

**Files:** none (verification only)

The dev server is the `marven-web` entry in `.claude/launch.json` (`npm run dev -- -p 3000`). In the browser preview there is no PTY, so the terminal prints "PTY not available". xterm still draws, which is enough to check colors, fonts and the cursor.

- [ ] **Step 1: Open a workspace and a terminal**

Start the `marven-web` preview. Switch to agent mode, open a project folder (the web build asks for a path), and open the Terminal from the top bar.

- [ ] **Step 2: Check the Settings page**

Open the command palette and run "Terminal: Change theme…". Confirm the Terminal page opens with the preview, 13 theme cards ("Match app theme" first and selected), and the font and cursor controls.

- [ ] **Step 3: Check live updates**

With the terminal visible:
- Click Dracula, then Solarized Light. The open terminal's background and text change each time without reopening it, and Solarized Light has no dark border around it.
- Move Size to 16 and Line height to 1.4. The terminal text grows and the grid still fills the panel with no clipped last row.
- Choose JetBrains Mono, or any font installed on the machine. The terminal changes font. Choose Custom… and type `NotARealFont`, then press Enter. The terminal falls back to the default font and doesn't break.
- Switch the cursor to Bar and untick Blink. The terminal cursor becomes a steady bar.

- [ ] **Step 4: Check "Match app theme"**

Click "Match app theme", then change the app theme in Settings → General to Midnight and then Aurora. The terminal follows: Midnight gives a `#21252b` background, Aurora a pink cursor.

- [ ] **Step 5: Check reset and Arabic**

Click Reset to defaults. Every control returns to match-app, the default font, 12px, 1.0 and a blinking block. Switch the app language to Arabic. The Terminal page labels are in Arabic, and the preview and theme cards still read left-to-right.

- [ ] **Step 6: Check that settings persist**

Reload the page. The terminal settings you last chose are still applied.
