"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "marven-theme";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const v = localStorage.getItem(KEY);
  return v === "light" ? "light" : "dark";
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
