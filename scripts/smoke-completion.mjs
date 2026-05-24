#!/usr/bin/env node
/**
 * Inline-completion smoke harness — exercises completeOnce() against any
 * configured AI provider with a realistic FIM (fill-in-middle) prompt so we
 * can verify end-to-end behavior before a release.
 *
 * What it checks:
 *   - the provider returns non-empty text within a reasonable deadline
 *   - the text doesn't include garbage (raw role tags, leftover stop tokens)
 *   - AbortSignal works (a follow-up call is canceled mid-flight)
 *
 * Usage:
 *   node scripts/smoke-completion.mjs <provider> <model>
 *   e.g. node scripts/smoke-completion.mjs ollama qwen2.5-coder:7b
 *        node scripts/smoke-completion.mjs groq  llama-3.1-8b-instant
 *        node scripts/smoke-completion.mjs openai gpt-4o-mini
 *
 * Requires the relevant provider to be reachable (and API key set in env for
 * cloud providers — same env vars as the main app: GROQ_API_KEY, etc.).
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [, , providerArg, modelArg] = process.argv;
if (!providerArg || !modelArg) {
  console.error("usage: node scripts/smoke-completion.mjs <provider> <model>");
  process.exit(1);
}

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { completeOnce } = await import(
  pathToFileURL(path.join(repoRoot, "lib/completion/providers.ts")).href
);
const { buildFimPrompt } = await import(
  pathToFileURL(path.join(repoRoot, "lib/completion/fimPrompt.ts")).href
);

// Real ContextWindow shape (matches lib/completion/contextWindow.ts) so
// buildFimPrompt() produces the correct provider-specific prompt format.
const CTX = {
  prefix:
    "function fibonacci(n) {\n" +
    "  if (n < 2) return n;\n" +
    "  ",
  suffix: "\n}\n",
  filename: "fib.js",
  languageId: "javascript",
  cursorLine: 2,
};
const FIM_PROMPT = buildFimPrompt(CTX, modelArg);

async function probe(label, requestOpts) {
  const start = Date.now();
  try {
    const result = await completeOnce(requestOpts);
    const ms = Date.now() - start;
    console.log(`[${label}] ${ms}ms — ${JSON.stringify(result.slice(0, 120))}`);
    if (!result.trim()) {
      console.warn(`[${label}] WARN: empty completion`);
      return { ok: false, reason: "empty" };
    }
    // Sanity: leftover chat tags or stop tokens?
    if (/<\|im_start\||<\|im_end\||<\/?role>/.test(result)) {
      console.warn(`[${label}] WARN: leaked role tags`);
      return { ok: false, reason: "role-tags" };
    }
    return { ok: true, ms };
  } catch (e) {
    console.error(`[${label}] error after ${Date.now() - start}ms: ${e instanceof Error ? e.message : e}`);
    return { ok: false, reason: "error", error: e };
  }
}

const baseReq = {
  provider: providerArg,
  model: modelArg,
  prompt: FIM_PROMPT,
};

console.log(`\n[smoke] provider=${providerArg} model=${modelArg}`);

// 1. Happy-path probe.
const fresh = new AbortController();
setTimeout(() => fresh.abort(), 15_000);
const r1 = await probe("happy", { ...baseReq, signal: fresh.signal });

// 2. Abort probe — cancel after 50ms.
const cancel = new AbortController();
const cancelPromise = probe("abort", { ...baseReq, signal: cancel.signal });
setTimeout(() => cancel.abort(), 50);
const r2 = await cancelPromise;
if (r2.ok) {
  console.warn("[abort] WARN: completion returned despite abort — provider may ignore AbortSignal");
}

// Exit codes:
//   0 → happy path worked
//   1 → empty / garbage
//   2 → hard error
if (r1.ok) {
  console.log(`\n[smoke] OK`);
  process.exit(0);
}
process.exit(r1.reason === "error" ? 2 : 1);
