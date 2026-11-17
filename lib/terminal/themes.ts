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
