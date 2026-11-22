"use client";

import { useEffect } from "react";
import i18n, { getStoredLanguage } from "@/lib/i18n";

/** Switches i18next to the saved language once the page has hydrated. */
export function LanguageBoot() {
  useEffect(() => {
    const saved = getStoredLanguage();
    if (saved !== i18n.language) void i18n.changeLanguage(saved);
  }, []);
  return null;
}
