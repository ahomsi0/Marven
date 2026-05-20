"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light" | "midnight" | "aurora";

const KEY = "marven-theme";

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
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    const t = getStoredTheme();
    setThemeState(t);
    document.documentElement.setAttribute("data-theme", t);
  }, []);
  const setTheme = (t: Theme) => {
    setStoredTheme(t);
    setThemeState(t);
  };
  return { theme, setTheme };
}
