// lib/completion/settingsClient.ts — read inline-completion settings from
// the Electron preload bridge with sensible defaults.

import type { AIProvider } from "@/types";

export interface InlineCompletionSettings {
  enabled: boolean;
  provider: AIProvider;
  model: string;
  debounceMs: number;
}

export const DEFAULT_INLINE_COMPLETION_SETTINGS: InlineCompletionSettings = {
  enabled: false,
  provider: "ollama",
  model: "",
  debounceMs: 350,
};

interface MarvenSettings {
  inlineCompletionsEnabled?: unknown;
  inlineCompletionProvider?: unknown;
  inlineCompletionModel?: unknown;
  inlineCompletionDebounceMs?: unknown;
}

const VALID_PROVIDERS: AIProvider[] = [
  "groq",
  "ollama",
  "nim",
  "openrouter",
  "openai",
  "anthropic",
  "lmstudio",
  "llamaserver",
];

export async function readInlineCompletionSettings(): Promise<InlineCompletionSettings> {
  const w = typeof window === "undefined" ? undefined : (window as unknown as {
    marvenElectron?: { getSettings?: () => Promise<MarvenSettings> };
  });
  const getSettings = w?.marvenElectron?.getSettings;
  if (!getSettings) return { ...DEFAULT_INLINE_COMPLETION_SETTINGS };

  let s: MarvenSettings | undefined;
  try {
    s = await getSettings();
  } catch {
    return { ...DEFAULT_INLINE_COMPLETION_SETTINGS };
  }
  if (!s || typeof s !== "object") {
    return { ...DEFAULT_INLINE_COMPLETION_SETTINGS };
  }

  return {
    enabled:
      typeof s.inlineCompletionsEnabled === "boolean"
        ? s.inlineCompletionsEnabled
        : DEFAULT_INLINE_COMPLETION_SETTINGS.enabled,
    provider:
      typeof s.inlineCompletionProvider === "string" &&
      VALID_PROVIDERS.includes(s.inlineCompletionProvider as AIProvider)
        ? (s.inlineCompletionProvider as AIProvider)
        : DEFAULT_INLINE_COMPLETION_SETTINGS.provider,
    model:
      typeof s.inlineCompletionModel === "string"
        ? s.inlineCompletionModel
        : DEFAULT_INLINE_COMPLETION_SETTINGS.model,
    debounceMs:
      typeof s.inlineCompletionDebounceMs === "number" &&
      Number.isFinite(s.inlineCompletionDebounceMs)
        ? Math.min(1500, Math.max(100, s.inlineCompletionDebounceMs))
        : DEFAULT_INLINE_COMPLETION_SETTINGS.debounceMs,
  };
}
