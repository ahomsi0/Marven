"use client";

// Which providers are enabled (Settings → Backends) and the models each one
// offers (/api/models). Shared by the model picker, the command palette's
// "Switch model" list and a reply's "Retry with…" menu so they all show the
// same thing.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AIProvider } from "@/types";

export const CLOUD_PROVIDERS: AIProvider[] = ["groq", "openai", "anthropic", "nim", "openrouter"];
export const LOCAL_PROVIDERS: AIProvider[] = ["ollama", "lmstudio", "llamaserver"];

export const DEFAULT_ENABLED: Record<AIProvider, boolean> = {
  groq: true, openai: true, ollama: true,
  anthropic: false, nim: false, openrouter: false,
  lmstudio: false, llamaserver: false,
};

const emptyModels = (): Record<AIProvider, string[]> => ({
  groq: [], ollama: [], nim: [], openrouter: [], openai: [],
  anthropic: [], lmstudio: [], llamaserver: [],
});

const emptyErrors = (): Record<AIProvider, string | null> => ({
  groq: null, ollama: null, nim: null, openrouter: null, openai: null,
  anthropic: null, lmstudio: null, llamaserver: null,
});

export function useProviderModels() {
  const [enabledProviders, setEnabledProviders] = useState<Record<AIProvider, boolean>>(DEFAULT_ENABLED);
  const [models, setModels] = useState<Record<AIProvider, string[]>>(emptyModels);
  // Providers whose model list is being fetched right now.
  const [loading, setLoading] = useState<ReadonlySet<AIProvider>>(() => new Set());
  const [errors, setErrors] = useState<Record<AIProvider, string | null>>(emptyErrors);
  const loadedRef = useRef<Set<AIProvider>>(new Set());
  const inflightRef = useRef<Set<AIProvider>>(new Set());

  // Load enabledProviders from Electron settings
  const refreshEnabled = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  const loadModels = useCallback(async (p: AIProvider) => {
    if (loadedRef.current.has(p) || inflightRef.current.has(p)) return;
    inflightRef.current.add(p);
    setLoading((prev) => new Set(prev).add(p));
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
      inflightRef.current.delete(p);
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(p);
        return next;
      });
    }
  }, []);

  /** Enabled providers, cloud first then local, in the picker's order. */
  const enabledList = [...CLOUD_PROVIDERS, ...LOCAL_PROVIDERS].filter((p) => enabledProviders[p]);

  return { enabledProviders, enabledList, models, loading, errors, refreshEnabled, loadModels };
}
