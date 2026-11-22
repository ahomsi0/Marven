// Which local models can look at images. Pure: safe in the browser and on the
// server. Ollama's own `/api/show` answer wins when it has one (see
// lib/modelCapabilities.ts); this name heuristic covers everything else.

import type { AIProvider } from "@/types";

/** Providers that run on this machine and get their vision support from the model. */
export const LOCAL_VISION_PROVIDERS: ReadonlySet<AIProvider> = new Set<AIProvider>([
  "ollama",
  "lmstudio",
  "llamaserver",
]);

export function isLocalProvider(provider: string): boolean {
  return LOCAL_VISION_PROVIDERS.has(provider as AIProvider);
}

// Matched against the lower-cased model name / id. Names come in many shapes:
// Ollama tags ("llava:13b", "qwen2.5vl:7b"), LM Studio ids
// ("qwen/qwen2.5-vl-7b-instruct", "google/gemma-3-12b") and llama-server GGUF
// file names ("gemma-3-4b-it-Q4_K_M.gguf").
const VISION_PATTERNS: RegExp[] = [
  /llava/, // llava, bakllava, llava-phi3, llava-llama3
  /vision/, // llama3.2-vision, granite3.2-vision, "…-vision-…"
  /llama-?4/, // llama4, llama-4-scout
  /qwen[\d.]*-?vl/, // qwen2.5vl, qwen2.5-vl, qwen2-vl, qwen-vl, qwen3-vl
  /-vl(?![a-z])/, // generic "-vl" suffix/infix (internvl-…-vl, …-vl-7b)
  /minicpm-?v/, // minicpm-v
  /moondream/,
  /mistral-small-?3\.[12]/, // mistral-small3.1, mistral-small-3.2
  /pixtral/,
];

// Gemma 3 sees images from 4B up; the 1B and 270M builds (and Gemma 3n) are text-only.
const GEMMA3 = /gemma-?3(?!n)/;
const GEMMA3_TEXT_ONLY = /(?:^|[^a-z0-9.])(?:1b|270m)(?![a-z0-9])/;

/** Whether a model's name suggests it accepts images. */
export function isLikelyVisionModel(provider: string, model: string): boolean {
  void provider; // the heuristic is the same for every local provider today
  const name = (model ?? "").trim().toLowerCase();
  if (!name) return false;
  if (GEMMA3.test(name)) return !GEMMA3_TEXT_ONLY.test(name);
  return VISION_PATTERNS.some((re) => re.test(name));
}
