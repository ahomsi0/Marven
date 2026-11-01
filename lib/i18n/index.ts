"use client";

// ── App language (i18next) ────────────────────────────────────────────────────
// English and Arabic UI strings. The server always renders English; on the
// client, <LanguageBoot> switches to the saved language right after hydration
// (so the two renders match). The layout's inline script sets <html lang/dir>
// before first paint so Arabic doesn't flip from LTR to RTL on load.

import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import en from "./en";
import ar from "./ar";
import { LANGUAGE_STORAGE_KEY as STORAGE_KEY } from "./boot";

export const APP_LANGUAGES = [
  { code: "en", label: "English", dir: "ltr" },
  { code: "ar", label: "العربية", dir: "rtl" },
] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number]["code"];

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
  }
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, ar: { translation: ar } },
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false }, // React already escapes
    returnNull: false,
  });
} else {
  // Hot reload re-runs this module but i18next is a singleton that's already
  // initialised — push the edited dictionaries into it and re-render, or new
  // keys show up raw ("account.languageHint") until a full page reload.
  i18n.addResourceBundle("en", "translation", en, true, true);
  i18n.addResourceBundle("ar", "translation", ar, true, true);
  void i18n.changeLanguage(i18n.language);
}

export function isAppLanguage(v: unknown): v is AppLanguage {
  return APP_LANGUAGES.some((l) => l.code === v);
}

export function languageDir(code: AppLanguage): "ltr" | "rtl" {
  return APP_LANGUAGES.find((l) => l.code === code)!.dir;
}

export function getStoredLanguage(): AppLanguage {
  if (typeof window === "undefined") return "en";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isAppLanguage(v) ? v : "en";
  } catch {
    return "en";
  }
}

/** Switch the UI language, update <html lang/dir>, and remember the choice. */
export function setAppLanguage(code: AppLanguage): void {
  void i18n.changeLanguage(code);
  if (typeof document !== "undefined") {
    document.documentElement.lang = code;
    document.documentElement.dir = languageDir(code);
  }
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Ignore storage errors — the choice just won't persist.
  }
}

export const useT = useTranslation;
export default i18n;
