// Mirror of SECRET_ENV_KEYS in electron/envSanitize.js (the Electron main
// process's sanitizer for the terminal and LSP servers). The Next bundle can't
// import that CommonJS module, so the list is duplicated here and
// lib/agent/sanitizedEnv.test.ts checks the two stay identical.
export const SECRET_ENV_KEYS = [
  "GROQ_API_KEY",
  "NIM_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  // App-internal secrets: MARVEN_API_TOKEN gates the local API (middleware.ts),
  // so agent commands, dev servers, git and MCP servers must not inherit it.
  "MARVEN_HEALTH_TOKEN",
  "MARVEN_API_TOKEN",
] as const;

/** Child processes must not inherit provider credentials or app tokens from the Next server. */
export function sanitizedChildEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of SECRET_ENV_KEYS) delete env[key];
  return { ...env, ...extra };
}
