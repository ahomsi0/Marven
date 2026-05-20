"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { AIProvider, OllamaModel } from "@/types";

export function shortModelName(name: string): string {
  const base = name.includes("/") ? name.split("/").pop()! : name;
  return base.replace(/-instruct.*$/, "").replace(/-\d{4}$/, "");
}

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  groq: "Groq",
  ollama: "Ollama",
  nim: "NIM",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  lmstudio: "LM Studio",
  llamaserver: "Llama Server",
};

const PROVIDERS: AIProvider[] = ["groq", "ollama", "nim", "openrouter", "openai", "anthropic", "lmstudio", "llamaserver"];

type AllModels = Record<AIProvider, OllamaModel[]>;
type AllLoading = Record<AIProvider, boolean>;
type AllErrors = Record<AIProvider, string | null>;

interface GroupedModelDropdownProps {
  provider: AIProvider;
  selectedModel: string;
  /** Where the dropdown opens relative to the trigger */
  direction?: "up" | "down";
  onProviderChange: (p: AIProvider) => void;
  onModelChange: (m: string) => void;
}

export function GroupedModelDropdown({
  provider,
  selectedModel,
  direction = "up",
  onProviderChange,
  onModelChange,
}: GroupedModelDropdownProps) {
  const [open, setOpen] = useState(false);
  const [allModels, setAllModels] = useState<AllModels>({ groq: [], ollama: [], nim: [], openrouter: [], openai: [], anthropic: [], lmstudio: [], llamaserver: [] });
  const [loading, setLoading] = useState<AllLoading>({ groq: true, ollama: true, nim: true, openrouter: true, openai: true, anthropic: true, lmstudio: true, llamaserver: true });
  const [errors, setErrors] = useState<AllErrors>({ groq: null, ollama: null, nim: null, openrouter: null, openai: null, anthropic: null, lmstudio: null, llamaserver: null });
  const [hoveredProvider, setHoveredProvider] = useState<AIProvider>(provider);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    PROVIDERS.forEach(async (p) => {
      try {
        const res = await fetch(`/api/models?provider=${p}`);
        const data = await res.json();
        if (data.error) {
          setErrors((prev) => ({ ...prev, [p]: data.error }));
          setAllModels((prev) => ({ ...prev, [p]: [] }));
        } else {
          setAllModels((prev) => ({ ...prev, [p]: data.models ?? [] }));
        }
      } catch {
        setErrors((prev) => ({ ...prev, [p]: "Unavailable" }));
      } finally {
        setLoading((prev) => ({ ...prev, [p]: false }));
      }
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, close]);

  useEffect(() => { if (open) setHoveredProvider(provider); }, [open, provider]);

  const activeModel = allModels[provider].find((m) => m.name === selectedModel);
  const isLoading = loading[provider];
  const panelModels = allModels[hoveredProvider];
  const isPanelLoading = loading[hoveredProvider];
  const panelError = errors[hoveredProvider];

  const popoverPos = direction === "up"
    ? "absolute bottom-full left-0 mb-1"
    : "absolute top-full left-0 mt-1";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-all hover:bg-[#2e2e2e]"
      >
        <span className="text-[#d19a66]">{PROVIDER_LABELS[provider]}</span>
        <span className="text-[#383838]">·</span>
        <span className="max-w-[120px] truncate text-[#666]">
          {isLoading ? "…" : activeModel ? shortModelName(activeModel.name) : selectedModel ? shortModelName(selectedModel) : "Select"}
        </span>
        <svg className="h-2.5 w-2.5 text-[#333]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className={`${popoverPos} z-50 flex overflow-hidden rounded-lg border border-[#252525] bg-[#161616] shadow-xl`} style={{ height: 156 }}>
          {/* Left — Style B: darker bg, gold left-bar on hover */}
          <div className="flex w-[108px] shrink-0 flex-col border-r border-[#1e1e1e] bg-[#131313] py-1">
            {PROVIDERS.map((p) => {
              const isActive = p === provider;
              const isHovered = p === hoveredProvider;
              const hasError = !!errors[p];
              return (
                <button
                  key={p}
                  type="button"
                  onMouseEnter={() => setHoveredProvider(p)}
                  onClick={() => {
                    if (!hasError) {
                      const first = allModels[p][0];
                      if (first) { onProviderChange(p); onModelChange(first.name); }
                      else { onProviderChange(p); }
                      close();
                    }
                  }}
                  className={`relative flex items-center px-3 py-[7px] text-left text-[11px] transition-colors ${
                    isHovered && !hasError ? "bg-[#1c1c1c]" : ""
                  } ${isActive ? "text-[#d19a66]" : hasError ? "text-[#2e2e2e]" : "text-[#555] hover:text-[#aaa]"}`}
                >
                  {isHovered && !hasError && (
                    <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-[#d19a66] opacity-50" />
                  )}
                  {PROVIDER_LABELS[p]}
                </button>
              );
            })}
          </div>

          {/* Right — Style A: flat rows with dot indicators */}
          <div className="w-[148px] overflow-y-auto py-1">
            {isPanelLoading ? (
              <div className="px-3 py-2 text-[10px] text-[#444]">Loading…</div>
            ) : panelError ? (
              <div className="px-3 py-3">
                <div className="mb-1 text-[11px] text-[#555]">{PROVIDER_LABELS[hoveredProvider]} unavailable</div>
                <div className="text-[10px] leading-relaxed text-[#383838]">{panelError}</div>
              </div>
            ) : panelModels.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-[#383838]">No models found</div>
            ) : (
              panelModels.map((m) => {
                const isActive = m.name === selectedModel && hoveredProvider === provider;
                return (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => { onProviderChange(hoveredProvider); onModelChange(m.name); close(); }}
                    className={`flex w-full items-center gap-2 px-3 py-[6px] text-left transition-colors hover:bg-[#1c1c1c] ${isActive ? "bg-[#1c1c1c]" : ""}`}
                  >
                    <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${isActive ? "bg-[#d19a66]" : "bg-[#2e2e2e]"}`} />
                    <span className={`truncate text-[11px] ${isActive ? "text-[#d19a66]" : "text-[#777]"}`}>
                      {shortModelName(m.name)}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
