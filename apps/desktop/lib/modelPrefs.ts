"use client";

import type { AIProvider } from "@/types";

// Persist the user's model and provider picks per mode so they survive
// Marven restarts. Without this each app start re-seeds both modes with the
// same default — which is what made "agent and chat are using the same
// model" feel like a still-open bug even after the state was split.

const CHAT_PROVIDER_KEY = "marven_chat_provider";
const AGENT_PROVIDER_KEY = "marven_agent_provider";
const CHAT_MODELS_KEY = "marven_chat_model_by_provider";
const AGENT_MODELS_KEY = "marven_agent_model_by_provider";

const VALID_PROVIDERS: ReadonlyArray<AIProvider> = [
  "groq",
  "ollama",
  "nim",
  "openrouter",
  "openai",
  "anthropic",
  "lmstudio",
  "llamaserver",
];

function isProvider(v: unknown): v is AIProvider {
  return typeof v === "string" && (VALID_PROVIDERS as readonly string[]).includes(v);
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota errors are non-fatal */
  }
}

export function loadChatProvider(): AIProvider | null {
  const v = readJson<unknown>(CHAT_PROVIDER_KEY);
  return isProvider(v) ? v : null;
}
export function loadAgentProvider(): AIProvider | null {
  const v = readJson<unknown>(AGENT_PROVIDER_KEY);
  return isProvider(v) ? v : null;
}
export function saveChatProvider(p: AIProvider): void {
  writeJson(CHAT_PROVIDER_KEY, p);
}
export function saveAgentProvider(p: AIProvider): void {
  writeJson(AGENT_PROVIDER_KEY, p);
}

export function loadChatModelMap(): Record<AIProvider, string> | null {
  return sanitizeModelMap(readJson<unknown>(CHAT_MODELS_KEY));
}
export function loadAgentModelMap(): Record<AIProvider, string> | null {
  return sanitizeModelMap(readJson<unknown>(AGENT_MODELS_KEY));
}
export function saveChatModelMap(m: Record<AIProvider, string>): void {
  writeJson(CHAT_MODELS_KEY, m);
}
export function saveAgentModelMap(m: Record<AIProvider, string>): void {
  writeJson(AGENT_MODELS_KEY, m);
}

function sanitizeModelMap(v: unknown): Record<AIProvider, string> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Partial<Record<AIProvider, string>> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (isProvider(k) && typeof val === "string") out[k] = val;
  }
  // Fill missing keys with empty strings so the type-level shape matches.
  return {
    groq: out.groq ?? "",
    ollama: out.ollama ?? "",
    nim: out.nim ?? "",
    openrouter: out.openrouter ?? "",
    openai: out.openai ?? "",
    anthropic: out.anthropic ?? "",
    lmstudio: out.lmstudio ?? "",
    llamaserver: out.llamaserver ?? "",
  };
}
