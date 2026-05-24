"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { AIProvider } from "@/types";
import { CloudIcon, HexagonIcon } from "./Icons";

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
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"cloud" | "local">(
    LOCAL_PROVIDERS.includes(provider) ? "local" : "cloud"
  );
  const [hoveredProvider, setHoveredProvider] = useState<AIProvider>(provider);
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

  // On open: refresh settings, sync tab to current provider, load its models
  useEffect(() => {
    if (!open) return;
    refreshEnabled();
    const newTab = LOCAL_PROVIDERS.includes(provider) ? "local" : "cloud";
    setTab(newTab);
    setHoveredProvider(provider);
    loadModels(provider);
  }, [open, provider, loadModels, refreshEnabled]);

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

  const tabProviders = (tab === "cloud" ? CLOUD_PROVIDERS : LOCAL_PROVIDERS).filter(
    (p) => enabledProviders[p]
  );

  const popoverPos =
    direction === "up"
      ? "absolute bottom-full left-0 mb-1"
      : "absolute top-full left-0 mt-1";

  return (
    <div ref={ref} className="relative">
      {/* Trigger pill — fixed width so the input bar never shifts */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-[172px] items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-all hover:bg-[#2e2e2e]"
      >
        <span className="w-[52px] shrink-0 truncate text-[#d19a66]">{PROVIDER_LABELS[provider]}</span>
        <span className="shrink-0 text-[#383838]">·</span>
        <span className="min-w-0 flex-1 truncate text-[#666]">
          {selectedModel ? shortModelName(selectedModel) : "—"}
        </span>
        <svg className="ml-auto h-2.5 w-2.5 shrink-0 text-[#333]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div
          className={`${popoverPos} z-50 flex h-[234px] w-[280px] flex-col overflow-hidden rounded-lg border border-[#252525] bg-[#161616] shadow-xl`}
        >
          {/* Tab bar */}
          <div className="flex border-b border-[#1e1e1e] bg-[#131313]">
            {(["cloud", "local"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  const first = (t === "cloud" ? CLOUD_PROVIDERS : LOCAL_PROVIDERS).find(
                    (p) => enabledProviders[p]
                  );
                  if (first) {
                    setHoveredProvider(first);
                    loadModels(first);
                  }
                }}
                className={`flex-1 py-2 text-[11px] font-medium border-b-2 transition-colors ${
                  tab === t
                    ? "border-[#d19a66] text-[#d19a66]"
                    : "border-transparent text-[#555] hover:text-[#888]"
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  {t === "cloud" ? <CloudIcon /> : <HexagonIcon />}
                  {t === "cloud" ? "Cloud" : "Local"}
                </span>
              </button>
            ))}
          </div>

          {tabProviders.length === 0 ? (
            <div className="flex flex-1 items-center justify-center px-3 text-[11px] text-[#555]">
              Enable backends in Settings → AI Backends
            </div>
          ) : (
            <>
              {/* Provider chips — single row, scrolls horizontally if many chips */}
              <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-[#1e1e1e] px-2.5 py-2 scrollbar-none">
                {tabProviders.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onMouseEnter={() => {
                      setHoveredProvider(p);
                      loadModels(p);
                    }}
                    onClick={() => {
                      setHoveredProvider(p);
                      loadModels(p);
                    }}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                      hoveredProvider === p
                        ? "border-[rgba(209,154,102,0.4)] bg-[rgba(209,154,102,0.12)] text-[#d19a66]"
                        : "border-[#2d2d2d] bg-[#222] text-[#888] hover:text-[#ccc]"
                    }`}
                  >
                    {PROVIDER_LABELS[p]}
                  </button>
                ))}
              </div>

              {/* Model list — fills remaining space */}
              <div className="flex-1 overflow-y-auto py-1">
                {loadingProvider === hoveredProvider ? (
                  <div className="flex h-full items-center justify-center text-[10px] text-[#444]">Loading…</div>
                ) : errors[hoveredProvider] ? (
                  <div className="flex h-full flex-col items-start justify-center px-3">
                    <div className="text-[11px] text-[#555]">
                      {PROVIDER_LABELS[hoveredProvider]} unavailable
                    </div>
                    <div className="mt-0.5 text-[10px] text-[#383838]">
                      {errors[hoveredProvider]}
                    </div>
                  </div>
                ) : models[hoveredProvider].length === 0 ? (
                  <div className="flex h-full items-center justify-center text-[10px] text-[#383838]">No models found</div>
                ) : (
                  models[hoveredProvider].map((m) => {
                    const isActive = m === selectedModel && hoveredProvider === provider;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          onProviderChange(hoveredProvider);
                          onModelChange(m);
                          localStorage.setItem("marven_last_provider", hoveredProvider);
                          localStorage.setItem("marven_last_model", m);
                          close();
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-[6px] text-left transition-colors hover:bg-[#1c1c1c] ${
                          isActive ? "bg-[#1c1c1c]" : ""
                        }`}
                      >
                        <span
                          className={`h-[5px] w-[5px] shrink-0 rounded-full ${
                            isActive ? "bg-[#d19a66]" : "bg-[#2e2e2e]"
                          }`}
                        />
                        <span
                          className={`truncate text-[11px] ${
                            isActive ? "text-[#d19a66]" : "text-[#777]"
                          }`}
                        >
                          {shortModelName(m)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
