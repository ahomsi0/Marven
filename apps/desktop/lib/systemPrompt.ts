"use client";

// ── System prompt ─────────────────────────────────────────────────────────────
// Extra instructions added to every chat (Settings → General). Replaces the
// old per-conversation prompt; stored locally like the other settings.

const KEY = "marven-system-prompt";

export function getSystemPrompt(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function setSystemPrompt(value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value.trim()) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    // Ignore storage errors — the prompt just won't persist.
  }
}
