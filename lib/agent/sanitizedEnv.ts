const SECRET_ENV_KEYS = [
  "GROQ_API_KEY",
  "NIM_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
] as const;

/** Child processes must not inherit provider credentials from the Next server. */
export function sanitizedChildEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of SECRET_ENV_KEYS) delete env[key];
  return { ...env, ...extra };
}
