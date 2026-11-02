"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES, type SearchEngineId } from "@/lib/inAppBrowser";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const electron = (): any => (typeof window !== "undefined" ? (window as any).marvenElectron : null);

/**
 * Radio list of search engines for the in-app browser. Reads and saves the
 * `browserSearchEngine` setting itself; used in onboarding and Settings → Browser.
 */
export function SearchEnginePicker() {
  const { t } = useT();
  const [selected, setSelected] = useState<SearchEngineId>(DEFAULT_SEARCH_ENGINE.id);

  useEffect(() => {
    const el = electron();
    if (!el) return;
    let live = true;
    void el.getSettings().then((s: { browserSearchEngine?: string }) => {
      const saved = SEARCH_ENGINES.find((e) => e.id === s.browserSearchEngine);
      if (live && saved) setSelected(saved.id);
    });
    return () => {
      live = false;
    };
  }, []);

  function choose(id: SearchEngineId) {
    setSelected(id);
    void electron()?.saveSettings({ browserSearchEngine: id }).catch(() => {});
  }

  return (
    <div role="radiogroup" aria-label={t("searchEngines.label")} className="flex flex-col gap-2">
      {SEARCH_ENGINES.map((engine) => {
        const active = selected === engine.id;
        return (
          <button
            key={engine.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => choose(engine.id)}
            className={`flex w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-start transition-colors ${
              active
                ? "border-[#d19a66]/50 bg-[#d19a66]/[0.08]"
                : "border-[var(--m-border-subtle)] bg-[var(--m-surface)] hover:border-[var(--m-border)] hover:bg-[var(--m-surface-2)]"
            }`}
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                active ? "border-[#d19a66] bg-[#d19a66]/20" : "border-[var(--m-border)]"
              }`}
            >
              {active && <span className="h-2 w-2 rounded-full bg-[#d19a66]" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-[var(--m-text)]">
                {engine.name}
                {engine.id === DEFAULT_SEARCH_ENGINE.id && (
                  <span className="ms-2 text-[11px] text-[var(--m-text-faint)]">{t("searchEngines.default")}</span>
                )}
              </span>
              <span className="mt-0.5 block text-[11px] text-[var(--m-text-faint)]">{t(`searchEngines.${engine.id}`)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
