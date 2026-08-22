// Server-side access to the settings file the Electron main process persists
// (userData/settings.json). The Next.js API server runs inside that process
// (production), so it can read the same source of truth the renderer's
// Settings UI writes via IPC — no wire-trust required.
//
// Reads are cached briefly: settings change rarely, but agent runs hit this
// per request. MARVEN_USER_DATA is unset under plain `next dev` — readers
// then return their fallback so dev keeps working without Electron.

import fs from "fs";
import path from "path";
import type { AIProvider } from "@/types";

const CACHE_TTL_MS = 2_000;

interface CacheEntry {
  data: Record<string, unknown> | null;
  readAt: number;
}

const g = globalThis as typeof globalThis & { __marvenSettingsCache?: CacheEntry };

function readSettingsUncached(): Record<string, unknown> | null {
  const userData = process.env.MARVEN_USER_DATA;
  if (!userData) return null;
  try {
    const raw = fs.readFileSync(path.join(userData, "settings.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Cached view of the persisted settings, or null when unavailable (dev). */
export function readPersistedSettings(): Record<string, unknown> | null {
  const cached = g.__marvenSettingsCache;
  if (cached && Date.now() - cached.readAt < CACHE_TTL_MS) return cached.data;
  const data = readSettingsUncached();
  g.__marvenSettingsCache = { data, readAt: Date.now() };
  return data;
}

/** Test-only: drop the cache so injected env/files take effect immediately. */
export function __resetSettingsCacheForTests(): void {
  g.__marvenSettingsCache = undefined;
}

// ─── Model failover chain ─────────────────────────────────────────────────────

export interface FallbackTarget {
  provider: AIProvider;
  model: string;
}

const KNOWN_PROVIDERS = new Set<string>([
  "groq", "openai", "anthropic", "openrouter", "nim", "ollama",
]);

/**
 * Parse the user-configured fallback chain from settings.
 * Accepted setting shape: `agentModelFallbacks: string[]` with entries like
 * "groq:llama-3.3-70b-versatile". Invalid entries are skipped silently.
 */
export function readPersistedFallbackChain(): FallbackTarget[] {
  const settings = readPersistedSettings();
  const raw = settings?.agentModelFallbacks;
  if (!Array.isArray(raw)) return [];
  const out: FallbackTarget[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const idx = entry.indexOf(":");
    if (idx <= 0) continue;
    const provider = entry.slice(0, idx).trim().toLowerCase();
    const model = entry.slice(idx + 1).trim();
    if (!model || !KNOWN_PROVIDERS.has(provider)) continue;
    out.push({ provider: provider as AIProvider, model });
  }
  return out;
}
