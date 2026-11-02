"use client";

import { useEffect, useState } from "react";
import type { AIProvider } from "@/types";
import { isLikelyVisionModel, isLocalProvider } from "@/lib/visionModels";

// Answers per provider + model for the session (the server caches Ollama's too).
const cache = new Map<string, boolean>();

/**
 * Whether the selected local model can see images: true / false, or null
 * while unknown, when `enabled` is false, or for cloud providers (whose image
 * handling is unchanged and needs no notice).
 */
export function useVisionSupport(provider: AIProvider, model: string, enabled: boolean): boolean | null {
  const key = `${provider}\n${model}`;
  const applies = enabled && !!model && isLocalProvider(provider);
  const [answer, setAnswer] = useState<{ key: string; vision: boolean } | null>(null);

  useEffect(() => {
    if (!applies || cache.has(key)) return;
    let live = true;
    const params = new URLSearchParams({ provider, model });
    fetch(`/api/models/capabilities?${params}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: { vision?: unknown }) => {
        const vision = data.vision === true;
        cache.set(key, vision);
        if (live) setAnswer({ key, vision });
      })
      .catch(() => {
        if (live) setAnswer({ key, vision: isLikelyVisionModel(provider, model) });
      });
    return () => {
      live = false;
    };
  }, [applies, key, provider, model]);

  if (!applies) return null;
  if (cache.has(key)) return cache.get(key)!;
  return answer?.key === key ? answer.vision : null;
}
