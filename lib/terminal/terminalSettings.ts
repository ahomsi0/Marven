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
