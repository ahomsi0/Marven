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
  // App-internal secrets that shouldn't leak into user-visible shells either.
  // MARVEN_API_TOKEN is what gates the local API (middleware.ts): a script run
  // in the terminal or by an LSP/MCP server must not be able to read it.
  'MARVEN_HEALTH_TOKEN',
  'MARVEN_API_TOKEN',
];
// lib/agent/sanitizedEnv.ts keeps a mirror of this list for the Next server's
// child processes; lib/agent/sanitizedEnv.test.ts fails if the two drift.

/** Returns a copy of process.env with provider secrets removed, plus any extras. */
function sanitizedEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of SECRET_ENV_KEYS) delete env[key];
  return { ...env, ...extra };
}

/**
 * Environment for the interactive terminal: sanitized, plus the colour hints
 * other terminals give (COLORTERM, as VS Code's terminal sets). macOS/BSD `ls`
 * only colours its output when CLICOLOR is set, so turn that on unless the
 * user's environment already chose (CLICOLOR set either way, or NO_COLOR).
 * The shell's own startup files run afterwards and can still override these.
 */
function terminalEnv() {
  const env = sanitizedEnv({ TERM: 'xterm-256color', COLORTERM: 'truecolor' });
  if (env.CLICOLOR === undefined && env.NO_COLOR === undefined) env.CLICOLOR = '1';
  return env;
}

module.exports = { sanitizedEnv, terminalEnv, SECRET_ENV_KEYS };
