// The renderer can drive the interactive terminal (and the app spawns LSP
// servers), and both inherit the main process's env — which applySettings()
// populates with the user's AI-provider secrets so the in-process Next server
// can read them. Those secrets don't belong in child processes, so strip them
// from any spawned command's environment. The Next server reads process.env
// directly and is unaffected.

const SECRET_ENV_KEYS = [
  'GROQ_API_KEY',
  'NIM_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ELEVENLABS_API_KEY',
];

/** Returns a copy of process.env with provider secrets removed, plus any extras. */
function sanitizedEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of SECRET_ENV_KEYS) delete env[key];
  return { ...env, ...extra };
}

module.exports = { sanitizedEnv, SECRET_ENV_KEYS };
