"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { AIProvider } from "@/types";
import { CheckIcon, CloudIcon, HexagonIcon } from "./Icons";
import { useT } from "@/lib/i18n";

// Re-export so InputBar can keep the same import path for shortModelName
export function shortModelName(name: string): string {
  const base = name.includes("/") ? name.split("/").pop()! : name;
  return base.replace(/-instruct.*$/, "").replace(/-\d{4}$/, "");
}

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  groq:        "Groq",
  ollama:      "Ollama",
  nim:         "NIM",
  openrouter:  "OpenRouter",
  openai:      "OpenAI",
  anthropic:   "Anthropic",
  lmstudio:    "LM Studio",
  llamaserver: "llama-server",
};

const CLOUD_PROVIDERS: AIProvider[] = ["groq", "openai", "anthropic", "nim", "openrouter"];
const LOCAL_PROVIDERS: AIProvider[] = ["ollama", "lmstudio", "llamaserver"];

// Cloud vs local get their own colours everywhere they appear.
const KIND_TEXT = { cloud: "text-[var(--m-cloud)]", local: "text-[var(--m-local)]" } as const;
const KIND_TAG = {
  cloud: "bg-[var(--m-cloud-soft)] text-[var(--m-cloud)]",
  local: "bg-[var(--m-local-soft)] text-[var(--m-local)]",
} as const;
const providerKind = (p: AIProvider) => (LOCAL_PROVIDERS.includes(p) ? "local" : "cloud");

const DEFAULT_ENABLED: Record<AIProvider, boolean> = {
  groq: true, openai: true, ollama: true,
  anthropic: false, nim: false, openrouter: false,
  lmstudio: false, llamaserver: false,
};

interface ModelSelectorProps {
  provider: AIProvider;
  selectedModel: string;
  direction?: "up" | "down";
  onProviderChange: (p: AIProvider) => void;
  onModelChange: (m: string) => void;
}

export function ModelSelector({
  provider,
  selectedModel,
  direction = "up",
  onProviderChange,
  onModelChange,
}: ModelSelectorProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  // The provider whose models the right pane shows — changes only on click.
  const [viewedProvider, setViewedProvider] = useState<AIProvider>(provider);
  const [enabledProviders, setEnabledProviders] = useState<Record<AIProvider, boolean>>(DEFAULT_ENABLED);
  const [models, setModels] = useState<Record<AIProvider, string[]>>({
    groq: [], ollama: [], nim: [], openrouter: [], openai: [],
    anthropic: [], lmstudio: [], llamaserver: [],
  });
  const [loadingProvider, setLoadingProvider] = useState<AIProvider | null>(null);
  const [errors, setErrors] = useState<Record<AIProvider, string | null>>({
    groq: null, ollama: null, nim: null, openrouter: null, openai: null,
    anthropic: null, lmstudio: null, llamaserver: null,
  });
  const loadedRef = useRef<Set<AIProvider>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  // Load enabledProviders from Electron settings — on mount and every time the dropdown opens
  const refreshEnabled = useCallback(() => {
    const el = (window as any).marvenElectron;
    el?.getSettings?.().then((s: Record<string, unknown>) => {
      if (s.enabledProviders && typeof s.enabledProviders === "object") {
        setEnabledProviders({
          ...DEFAULT_ENABLED,
          ...(s.enabledProviders as Record<AIProvider, boolean>),
        });
      }
    });
  }, []);

  useEffect(() => {
    refreshEnabled();
  }, [refreshEnabled]);

  // Restore last-used provider and model from localStorage on mount
  useEffect(() => {
    const savedProvider = localStorage.getItem("marven_last_provider") as AIProvider | null;
    const savedModel = localStorage.getItem("marven_last_model");
    if (savedProvider && savedModel) {
      onProviderChange(savedProvider);
      onModelChange(savedModel);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount only

  const loadModels = useCallback(async (p: AIProvider) => {
    if (loadedRef.current.has(p)) return;
    setLoadingProvider(p);
    try {
      const res = await fetch(`/api/models?provider=${p}`);
      const data = await res.json();
      if (data.error) {
        setErrors((prev) => ({ ...prev, [p]: data.error }));
      } else {
        setModels((prev) => ({
          ...prev,
          [p]: (data.models ?? []).map((m: { name: string }) => m.name),
        }));
        loadedRef.current.add(p);
      }
    } catch {
      setErrors((prev) => ({ ...prev, [p]: "Unavailable" }));
    } finally {
      setLoadingProvider(null);
    }
  }, []);

  // On open: refresh settings and show the provider in use
  useEffect(() => {
    if (!open) return;
    refreshEnabled();
    setViewedProvider(provider);
    loadModels(provider);
  }, [open, provider, loadModels, refreshEnabled]);

  function viewProvider(p: AIProvider) {
    setViewedProvider(p);
    loadModels(p);
  }

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function onMouse(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const groups = [
    { id: "cloud" as const, label: t("input.cloud"), Icon: CloudIcon, providers: CLOUD_PROVIDERS.filter((p) => enabledProviders[p]) },
    { id: "local" as const, label: t("input.local"), Icon: HexagonIcon, providers: LOCAL_PROVIDERS.filter((p) => enabledProviders[p]) },
  ].filter((g) => g.providers.length > 0);

  const popoverPos =
    direction === "up"
      ? "absolute bottom-full start-0 mb-1.5"
      : "absolute top-full start-0 mt-1.5";

  return (
    <div ref={ref} className="relative">
      {/* Trigger pill — fixed width so the input bar never shifts */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("input.modelPicker")}
        className="flex w-[172px] items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-all hover:bg-[var(--m-surface-2)]"
      >
        <span className={`w-[52px] shrink-0 truncate text-start font-medium ${KIND_TEXT[providerKind(provider)]}`}>{PROVIDER_LABELS[provider]}</span>
        <span className="shrink-0 text-[var(--m-text-faint)]">·</span>
        <span className="min-w-0 flex-1 truncate text-start text-[var(--m-text-muted)]">
          {selectedModel ? shortModelName(selectedModel) : "—"}
        </span>
        <svg className={`ms-auto h-2.5 w-2.5 shrink-0 text-[var(--m-text-faint)] transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("input.modelPicker")}
          className={`${popoverPos} z-50 flex h-[280px] w-[420px] overflow-hidden rounded-xl border border-[var(--m-border)] bg-[var(--m-surface-2)] shadow-2xl`}
        >
          {groups.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-4 text-center text-[12px] text-[var(--m-text-muted)]">
              {t("input.enableBackends")}
            </div>
          ) : (
            <>
              {/* Providers — click to see their models */}
              <div className="w-[140px] shrink-0 overflow-y-auto border-e border-[var(--m-border-subtle)] p-1.5">
                {groups.map(({ id, label, Icon, providers }) => (
                  <div key={id} className="mb-1.5 last:mb-0">
                    <p className={`mx-1 mb-1 mt-1 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${KIND_TAG[id]}`}>
                      <Icon className="h-3 w-3" />
                      {label}
                    </p>
                    {providers.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => viewProvider(p)}
                        aria-pressed={viewedProvider === p}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[12px] transition-colors ${
                          viewedProvider === p
                            ? "bg-[var(--m-surface-3)] text-[var(--m-text)]"
                            : "text-[var(--m-text-muted)] hover:bg-[var(--m-surface-3)]/60 hover:text-[var(--m-text)]"
                        }`}
                      >
                        <span className="flex-1 truncate">{PROVIDER_LABELS[p]}</span>
                        {p === provider && (
                          <span title={t("input.inUse")} className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--m-accent)]" />
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              {/* Models of the selected provider */}
              <div className="flex min-w-0 flex-1 flex-col">
                <p className={`shrink-0 px-3 pb-1 pt-2.5 text-[11px] font-semibold ${KIND_TEXT[providerKind(viewedProvider)]}`}>
                  {PROVIDER_LABELS[viewedProvider]}
                </p>
                <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
                  {loadingProvider === viewedProvider ? (
                    <div className="flex h-full items-center justify-center text-[11px] text-[var(--m-text-faint)]">{t("input.loadingModels")}</div>
                  ) : errors[viewedProvider] ? (
                    <div className="flex h-full flex-col justify-center px-2">
                      <div className="text-[12px] text-[var(--m-text-muted)]">
                        {t("input.providerUnavailable", { provider: PROVIDER_LABELS[viewedProvider] })}
                      </div>
                      <div className="mt-1 break-words text-[11px] text-[var(--m-text-faint)]">{errors[viewedProvider]}</div>
                    </div>
                  ) : models[viewedProvider].length === 0 ? (
                    <div className="flex h-full items-center justify-center text-[11px] text-[var(--m-text-faint)]">{t("input.noModels")}</div>
                  ) : (
                    models[viewedProvider].map((m) => {
                      const isActive = m === selectedModel && viewedProvider === provider;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            onProviderChange(viewedProvider);
                            onModelChange(m);
                            localStorage.setItem("marven_last_provider", viewedProvider);
                            localStorage.setItem("marven_last_model", m);
                            close();
                          }}
                          title={m}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start transition-colors hover:bg-[var(--m-surface-3)] ${
                            isActive ? "bg-[var(--m-surface-3)]" : ""
                          }`}
                        >
                          <span dir="ltr" className={`flex-1 truncate text-[12px] ${isActive ? "text-[var(--m-accent)]" : "text-[var(--m-text)]"}`}>
                            {shortModelName(m)}
                          </span>
                          {isActive && <CheckIcon className="h-3 w-3 text-[var(--m-accent)]" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
