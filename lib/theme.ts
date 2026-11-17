"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light" | "midnight" | "aurora";

const KEY = "marven-theme";

export const THEME_CHANGE_EVENT = "marven:theme-change";

const DARK_THEMES: Theme[] = ["dark", "midnight", "aurora"];

/** Returns true if the theme renders dark UI (terminal stays dark). */
export function isDarkTheme(t: Theme): boolean {
  return DARK_THEMES.includes(t);
}

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const v = localStorage.getItem(KEY);
  if (v === "light" || v === "midnight" || v === "aurora") return v;
  return "dark";
}

export function setStoredTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, theme);
  document.documentElement.setAttribute("data-theme", theme);
  window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: theme }));
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    const t = getStoredTheme();
    setThemeState(t);
    document.documentElement.setAttribute("data-theme", t);

    const onThemeChange = (e: Event) => setThemeState((e as CustomEvent<Theme>).detail);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) setThemeState(getStoredTheme());
    };
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const setTheme = (t: Theme) => {
    setStoredTheme(t);
    setThemeState(t);
  };
  return { theme, setTheme };
}
