"use client";

export interface Keybinding {
  id: string;
  label: string;
  defaultKey: string;
  defaultMod: boolean;
  defaultShift: boolean;
  defaultAlt: boolean;
  defaultCtrl: boolean;
  defaultKey_code: string;
}

export const DEFAULT_KEYBINDINGS: Keybinding[] = [
  {
    id: "save-file",
    label: "Save File",
    defaultKey: "⌘S",
    defaultMod: true,
    defaultShift: false,
    defaultAlt: false,
    defaultCtrl: false,
    defaultKey_code: "s",
  },
  {
    id: "close-tab",
    label: "Close Tab",
    defaultKey: "⌘W",
    defaultMod: true,
    defaultShift: false,
    defaultAlt: false,
    defaultCtrl: false,
    defaultKey_code: "w",
  },
  {
    id: "toggle-sidebar",
    label: "Toggle Sidebar",
    defaultKey: "⌘B",
    defaultMod: true,
    defaultShift: false,
    defaultAlt: false,
    defaultCtrl: false,
    defaultKey_code: "b",
  },
  {
    id: "toggle-terminal",
    label: "Toggle Terminal",
    defaultKey: "Ctrl+`",
    defaultMod: false,
    defaultShift: false,
    defaultAlt: false,
    defaultCtrl: true,
    defaultKey_code: "`",
  },
  {
    id: "toggle-chat",
    label: "Toggle Chat",
    defaultKey: "⌃⌘I",
    defaultMod: true,
    defaultShift: false,
    defaultAlt: false,
    defaultCtrl: true,
    defaultKey_code: "i",
  },
  {
    id: "quick-open",
    label: "Quick Open",
    defaultKey: "⌘P",
    defaultMod: true,
    defaultShift: false,
    defaultAlt: false,
    defaultCtrl: false,
    defaultKey_code: "p",
  },
  {
    id: "command-palette",
    label: "Command Palette",
    defaultKey: "⌘⇧P",
    defaultMod: true,
    defaultShift: true,
    defaultAlt: false,
    defaultCtrl: false,
    defaultKey_code: "p",
  },
  {
    id: "open-settings",
    label: "Open Settings",
    defaultKey: "⌘,",
    defaultMod: true,
    defaultShift: false,
    defaultAlt: false,
    defaultCtrl: false,
    defaultKey_code: ",",
  },
  {
    id: "find",
    label: "Find",
    defaultKey: "⌘F",
    defaultMod: true,
    defaultShift: false,
    defaultAlt: false,
    defaultCtrl: false,
    defaultKey_code: "f",
  },
  {
    id: "find-replace",
    label: "Find & Replace",
    defaultKey: "⌘⌥F",
    defaultMod: true,
    defaultShift: false,
    defaultAlt: true,
    defaultCtrl: false,
    defaultKey_code: "f",
  },
  {
    id: "next-match",
    label: "Next Match",
    defaultKey: "⌘G",
    defaultMod: true,
    defaultShift: false,
    defaultAlt: false,
    defaultCtrl: false,
    defaultKey_code: "g",
  },
  {
    id: "prev-match",
    label: "Prev Match",
    defaultKey: "⌘⇧G",
    defaultMod: true,
    defaultShift: true,
    defaultAlt: false,
    defaultCtrl: false,
    defaultKey_code: "g",
  },
  {
    id: "global-search",
    label: "Global Search",
    defaultKey: "⌘⇧F",
    defaultMod: true,
    defaultShift: true,
    defaultAlt: false,
    defaultCtrl: false,
    defaultKey_code: "f",
  },
  {
    id: "inline-ai-edit",
    label: "Inline AI Edit",
    defaultKey: "⌘K",
    defaultMod: true,
    defaultShift: false,
    defaultAlt: false,
    defaultCtrl: false,
    defaultKey_code: "k",
  },
  {
    id: "git-panel",
    label: "Git Panel",
    defaultKey: "⌥G",
    defaultMod: false,
    defaultShift: false,
    defaultAlt: true,
    defaultCtrl: false,
    defaultKey_code: "g",
  },
];

const STORAGE_KEY = "marven-keybindings";

/** Returns only overridden bindings (empty object = all defaults). */
export function loadKeybindings(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Persists only the overrides to localStorage. */
export function saveKeybindings(overrides: Record<string, string>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

/** Clears all overrides, restoring defaults. */
export function resetKeybindings(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
