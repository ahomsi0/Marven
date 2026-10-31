"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { CheckIcon } from "./Icons";
import { APP_LANGUAGES, setAppLanguage, useT } from "@/lib/i18n";

interface LanguageModalProps {
  onClose: () => void;
}

/**
 * App-language picker, styled like the Settings overlay. Choosing a language
 * applies it immediately — the dialog itself re-renders in that language.
 * Rendered into <body> so it isn't positioned or clipped by the sidebar.
 */
export function LanguageModal({ onClose }: LanguageModalProps) {
  const { t, i18n } = useT();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="language-modal-title"
        className="relative z-10 m-auto flex w-[min(520px,94vw)] flex-col overflow-hidden rounded-xl border border-[var(--m-border-subtle)] bg-[var(--m-bg)] shadow-[0_0_60px_rgba(0,0,0,0.9)]"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--m-border-subtle)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            aria-label={t("account.close")}
            className="text-[var(--m-text-muted)] transition-colors hover:text-[var(--m-text)]"
          >
            <svg className="h-4 w-4 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 id="language-modal-title" className="text-[15px] font-semibold text-[var(--m-text)]">
            {t("account.appLanguage")}
          </h1>
        </div>

        <div className="px-6 py-5">
          <p className="mb-4 text-[12px] leading-relaxed text-[var(--m-text-muted)]">{t("account.languageHint")}</p>
          <div role="radiogroup" aria-label={t("account.appLanguage")} className="grid grid-cols-2 gap-3">
            {APP_LANGUAGES.map((l) => {
              const selected = i18n.language === l.code;
              return (
                <button
                  key={l.code}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAppLanguage(l.code)}
                  className={`relative flex flex-col items-start gap-1 rounded-xl border px-4 py-3.5 text-start transition-colors ${
                    selected
                      ? "border-[var(--m-accent)] bg-[var(--m-accent-soft)]"
                      : "border-[var(--m-border)] hover:border-[var(--m-text-faint)] hover:bg-[var(--m-surface-2)]"
                  }`}
                >
                  <span lang={l.code} dir={l.dir} className="text-[22px] font-semibold leading-tight text-[var(--m-text)]">
                    {t(`account.languageSample_${l.code}`)}
                  </span>
                  <span lang={l.code} className="text-[14px] font-medium text-[var(--m-text)]">
                    {l.label}
                  </span>
                  <span className="text-[11px] text-[var(--m-text-muted)]">
                    {l.dir === "rtl" ? t("account.dirRtl") : t("account.dirLtr")}
                  </span>
                  {selected && (
                    <span className="absolute end-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--m-accent)] text-[var(--m-bg)]">
                      <CheckIcon className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
