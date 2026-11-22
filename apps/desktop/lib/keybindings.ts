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

// ─── Matching key events against (possibly remapped) bindings ───────────────
// Defaults are written with "⌘" meaning the platform's main modifier (Cmd on
// macOS, Ctrl elsewhere). Overrides are recorded by Settings → Keyboard as the
// literal keys pressed: "⌃⌥⇧⌘P" on macOS, "Ctrl+Alt+Shift+Win+P" elsewhere.

export interface KeyCombo {
  key: string; // lower-cased
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

type ComboFlag = "meta" | "ctrl" | "alt" | "shift";

/** Parse a binding string. `isDefault` reads "⌘" as the platform modifier. */
export function parseCombo(combo: string, isMac: boolean, isDefault = false): KeyCombo | null {
  let rest = combo.trim();
  const out: KeyCombo = { key: "", meta: false, ctrl: false, alt: false, shift: false };
  const tokens: [string, ComboFlag | "mod"][] = [
    ["Ctrl+", "ctrl"], ["Control+", "ctrl"], ["Alt+", "alt"], ["Option+", "alt"],
    ["Shift+", "shift"], ["Win+", "meta"], ["Meta+", "meta"], ["Cmd+", "meta"],
    ["⌃", "ctrl"], ["⌥", "alt"], ["⇧", "shift"], ["⌘", isDefault ? "mod" : "meta"],
  ];
  for (;;) {
    const hit = tokens.find(([t]) => rest.length > t.length && rest.toLowerCase().startsWith(t.toLowerCase()));
    if (!hit) break;
    rest = rest.slice(hit[0].length);
    const flag: ComboFlag = hit[1] === "mod" ? (isMac ? "meta" : "ctrl") : hit[1];
    out[flag] = true;
  }
  // A trailing "+" on a longer token is an unfinished combo ("Ctrl+"), not the + key.
  if (!rest || (rest.length > 1 && rest.endsWith("+"))) return null;
  out.key = rest === "Space" ? " " : rest.toLowerCase();
  return out;
}

/** The combo in effect for binding `id` (override, else default), or null. */
export function getBindingCombo(id: string, isMac: boolean, overrides: Record<string, string> = {}): KeyCombo | null {
  const override = overrides[id];
  if (override) return parseCombo(override, isMac);
  const def = DEFAULT_KEYBINDINGS.find((kb) => kb.id === id);
  return def ? parseCombo(def.defaultKey, isMac, true) : null;
}

type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** True when the event presses exactly `combo` (same modifiers, same key). */
export function eventMatchesCombo(e: KeyEventLike, combo: KeyCombo): boolean {
  if (e.metaKey !== combo.meta || e.ctrlKey !== combo.ctrl || e.altKey !== combo.alt || e.shiftKey !== combo.shift) {
    return false;
  }
  if (e.key.toLowerCase() === combo.key) return true;
  // Option/Shift change e.key on macOS ("π", "P"); fall back to the physical key.
  if (/^[a-z]$/.test(combo.key)) return e.code === `Key${combo.key.toUpperCase()}`;
  if (/^[0-9]$/.test(combo.key)) return e.code === `Digit${combo.key}`;
  return false;
}

/** Human label for a combo in the platform's style: "⇧⌘P" or "Ctrl+Shift+P". */
export function formatCombo(combo: KeyCombo, isMac: boolean): string {
  const key =
    combo.key === " " ? "Space" : combo.key.length === 1 ? combo.key.toUpperCase() : combo.key[0].toUpperCase() + combo.key.slice(1);
  if (isMac) {
    return `${combo.ctrl ? "⌃" : ""}${combo.alt ? "⌥" : ""}${combo.shift ? "⇧" : ""}${combo.meta ? "⌘" : ""}${key}`;
  }
  return [combo.ctrl && "Ctrl", combo.alt && "Alt", combo.shift && "Shift", combo.meta && "Win", key].filter(Boolean).join("+");
}

/** The current label for binding `id`, honouring overrides; "" if unknown. */
export function formatBinding(id: string, isMac: boolean, overrides: Record<string, string> = {}): string {
  const combo = getBindingCombo(id, isMac, overrides);
  return combo ? formatCombo(combo, isMac) : "";
}

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");
}
