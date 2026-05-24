#!/usr/bin/env node
/**
 * Bug-hardening harness: run a full codebase index against a large repo and
 * report any crashes, slow files, or anomalies. Catches the kind of bugs that
 * only show up at 5k+ files (sqlite-vec edge cases, embedder backpressure,
 * gitignore parser bugs, OOMs in the chunker, etc.).
 *
 * Usage:
 *   node scripts/stress-index.mjs <workspace-path>
 *
 * Example:
 *   node scripts/stress-index.mjs ~/code/marven           # ~1k files
 *   node scripts/stress-index.mjs ~/code/typescript       # 30k files
 *
 * Requires Ollama running locally with `nomic-embed-text` pulled.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspaceArg = process.argv[2];
if (!workspaceArg) {
  console.error("usage: node scripts/stress-index.mjs <workspace-path>");
  process.exit(1);
}

const workspaceRoot = path.resolve(workspaceArg);
try {
  await fs.access(workspaceRoot);
} catch {
  console.error(`workspace does not exist: ${workspaceRoot}`);
  process.exit(1);
}

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Dynamic-import the TS sources via tsx loader. Run with:
//   npx tsx scripts/stress-index.mjs <workspace-path>
const { Embedder } = await import(pathToFileURL(path.join(repoRoot, "lib/index/embedder.ts")).href);
const { Indexer } = await import(pathToFileURL(path.join(repoRoot, "lib/index/indexer.ts")).href);
const { IndexStore } = await import(pathToFileURL(path.join(repoRoot, "lib/index/store.ts")).href);

console.log(`[stress] target workspace: ${workspaceRoot}`);
console.log(`[stress] verifying Ollama + nomic-embed-text…`);
const embedder = new Embedder();
const pull = await embedder.ensureModelInstalled();
if (!pull.ok) {
  console.error(`[stress] embedder not ready: ${pull.error}`);
  console.error(`[stress] make sure Ollama is running (https://ollama.com) and try again.`);
  process.exit(1);
}
console.log(`[stress] embedder ready.`);

const store = IndexStore.open(workspaceRoot);
const indexer = new Indexer({ workspaceRoot, store, embedder });

const startedAt = Date.now();
let lastLog = startedAt;
let lastFiles = 0;

console.log(`[stress] starting full index…`);

try {
  const result = await indexer.runFull({
    onProgress: (p) => {
      const now = Date.now();
      if (now - lastLog > 2000) {
        const elapsed = ((now - startedAt) / 1000).toFixed(1);
        const rate = ((p.filesDone - lastFiles) / ((now - lastLog) / 1000)).toFixed(1);
        const pct = p.filesTotal > 0 ? ((p.filesDone / p.filesTotal) * 100).toFixed(1) : "?";
        console.log(`[stress] ${elapsed}s — ${p.filesDone}/${p.filesTotal} files (${pct}%) — ${p.chunksDone} chunks — ${rate} files/sec`);
        lastLog = now;
        lastFiles = p.filesDone;
      }
    },
  });
  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n[stress] OK in ${totalSec}s`);
  console.log(`[stress]   files indexed: ${result.filesIndexed}`);
  console.log(`[stress]   chunks indexed: ${result.chunksIndexed}`);
  console.log(`[stress]   avg chunks/file: ${(result.chunksIndexed / Math.max(1, result.filesIndexed)).toFixed(1)}`);

  // Sanity probe: try a search to make sure the store is queryable.
  console.log(`\n[stress] running probe search ("function")…`);
  const probeVec = await embedder.embed("function");
  const hits = store.search(probeVec, 5);
  console.log(`[stress]   ${hits.length} results returned. Top match: ${hits[0]?.path ?? "(none)"}`);

  console.log(`\n[stress] success.`);
  process.exit(0);
} catch (err) {
  console.error(`\n[stress] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(2);
}
