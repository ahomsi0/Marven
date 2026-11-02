"use client";

// "Retry with…" dropdown on an assistant reply: the current chat model plus the
// models of every enabled provider (the same lists as the model picker).
// Picking one regenerates that reply only; the selected chat model is unchanged.

import { useEffect, useMemo, useState } from "react";
import type { AIProvider } from "@/types";
import { useT } from "@/lib/i18n";
import { fuzzyRank } from "@/lib/fuzzy";
import { useProviderModels } from "@/hooks/useProviderModels";
import { PROVIDER_LABELS, shortModelName } from "./ModelSelector";

interface RetryModelMenuProps {
  currentProvider?: AIProvider;
  currentModel?: string;
  onPick: (provider: AIProvider, model: string) => void;
}

interface Option {
  provider: AIProvider;
  model: string;
}

export function RetryModelMenu({ currentProvider, currentModel, onPick }: RetryModelMenuProps) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const { enabledList, models, loading, loadModels } = useProviderModels();
  const enabledKey = enabledList.join(",");

  useEffect(() => {
    for (const p of enabledList) void loadModels(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, loadModels]);

  const options: Option[] = useMemo(
    () =>
      enabledList.flatMap((p) =>
        models[p].filter((m) => !(p === currentProvider && m === currentModel)).map((m) => ({ provider: p, model: m })),
      ),
    [enabledList, models, currentProvider, currentModel],
  );

  const filtered = useMemo(
    () => fuzzyRank(query, options, (o) => shortModelName(o.model), (o) => [o.model, PROVIDER_LABELS[o.provider]]),
    [query, options],
  );

  const current = currentProvider && currentModel ? { provider: currentProvider, model: currentModel } : null;
  const showCurrent =
    !!current && fuzzyRank(query, [current], (o) => shortModelName(o.model), (o) => [o.model]).length > 0;
  const isLoading = enabledList.some((p) => loading.has(p));

  // Group the (already ranked) options by provider, keeping first-seen order.
  const groups = useMemo(() => {
    const byProvider = new Map<AIProvider, Option[]>();
    for (const { item } of filtered) {
      const list = byProvider.get(item.provider) ?? [];
      list.push(item);
      byProvider.set(item.provider, list);
    }
    return [...byProvider.entries()];
  }, [filtered]);

  function item(o: Option) {
    return (
      <button
        key={`${o.provider}:${o.model}`}
        type="button"
        role="menuitem"
        onClick={() => onPick(o.provider, o.model)}
        title={o.model}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-start text-[12px] text-[var(--m-text)] transition-colors hover:bg-[var(--m-surface-3)]"
      >
        <span dir="ltr" className="min-w-0 flex-1 truncate text-start">{shortModelName(o.model)}</span>
      </button>
    );
  }

  return (
    <div
      role="menu"
      aria-label={t("versions.retryWith")}
      className="flex max-h-[320px] w-[260px] flex-col overflow-hidden rounded-xl border border-[var(--m-border)] bg-[var(--m-surface-2)] shadow-2xl"
    >
      <div className="shrink-0 border-b border-[var(--m-border-subtle)] px-3 pb-2 pt-2.5">
        <p className="mb-1.5 text-[11px] font-semibold text-[var(--m-text-muted)]">{t("versions.retryWith")}</p>
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // The first row shown: the current model when it's listed.
              const first = showCurrent ? current : filtered[0]?.item;
              if (first) onPick(first.provider, first.model);
            }
          }}
          placeholder={t("versions.filterModels")}
          dir="auto"
          className="w-full rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] px-2 py-1 text-[12px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-text-faint)]"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {showCurrent && current && (
          <div className="mb-1">
            <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--m-text-faint)]">
              {t("versions.currentModel")} · {PROVIDER_LABELS[current.provider]}
            </p>
            {item(current)}
          </div>
        )}
        {groups.map(([p, list]) => (
          <div key={p} className="mb-1 last:mb-0">
            <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--m-text-faint)]">
              {PROVIDER_LABELS[p]}
            </p>
            {list.map(item)}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="px-2 py-3 text-center text-[11px] text-[var(--m-text-faint)]">
            {isLoading ? t("versions.loadingModels") : t("versions.noModels")}
          </p>
        )}
        {groups.length > 0 && isLoading && (
          <p className="px-2 py-1 text-[11px] text-[var(--m-text-faint)]">{t("versions.loadingModels")}</p>
        )}
      </div>
    </div>
  );
}
