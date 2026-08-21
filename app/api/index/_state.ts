// Shared singleton state for the codebase indexer, scoped to the Next.js
// server process. Module-level state survives across requests within a single
// server instance, the same pattern the agent stream route uses for pending
// approvals (see lib/agent/approvals.ts).
//
// We attach to globalThis so HMR / multiple route bundles share one instance.

import { Embedder } from "@/lib/index/embedder";
import { IndexStore } from "@/lib/index/store";
import { Indexer } from "@/lib/index/indexer";
import type { IndexProgress, IndexStats } from "@/types";

export interface IndexRunHandle {
  workspaceRoot: string;
  abort: AbortController;
  progress: IndexProgress;
  // List of subscribers receiving progress / done / error events.
  listeners: Set<IndexEventListener>;
  // Resolves once the run finishes (success or failure). Lets new subscribers
  // know whether to expect any further events.
  donePromise: Promise<void>;
  startedAt: number;
  lastError: string | null;
}

export type IndexEvent =
  | { type: "progress"; data: IndexProgress }
  | { type: "done"; data: { filesIndexed: number; chunksIndexed: number; durationMs: number } }
  | { type: "error"; data: { message: string } }
  /**
   * Fired before indexing starts when the embedding model has to be downloaded
   * via Ollama. UI can show "Downloading nomic-embed-text (274 MB)…" so first-
   * time users aren't staring at a silent screen for a minute.
   */
  | { type: "embedding-model-pulling"; data: { model: string } }
  | { type: "embedding-model-ready"; data: { model: string } };

export type IndexEventListener = (e: IndexEvent) => void;

interface IndexState {
  // The currently active run (if any). Only one full reindex at a time per
  // workspace; a new run for the same root supersedes a stale handle.
  currentRuns: Map<string, IndexRunHandle>;
  // Persistent store handle, keyed by workspaceRoot. Reused across requests so
  // we don't pay sqlite open cost on every search / update.
  stores: Map<string, IndexStore>;
  // Cached indexer per workspace root.
  indexers: Map<string, Indexer>;
  // Cached embedder per workspace root — kept in parallel so startRun() can
  // call ensureModelInstalled() without reaching into the Indexer internals.
  embedders: Map<string, Embedder>;
  // Whether indexing is enabled (mirrors the codebaseIndexEnabled setting).
  // For now we trust the renderer not to call the routes when disabled, but
  // the search route also returns [] when disabled.
  enabled: boolean;
  excludePatterns: string[];
}

const g = globalThis as typeof globalThis & { __marvenIndexState?: IndexState };
if (!g.__marvenIndexState) {
  g.__marvenIndexState = {
    currentRuns: new Map(),
    stores: new Map(),
    indexers: new Map(),
    embedders: new Map(),
    enabled: true,
    excludePatterns: [],
  };
} else if (!g.__marvenIndexState.currentRuns) {
  // HMR migration from the pre-2.12 single-workspace run state.
  g.__marvenIndexState.currentRuns = new Map();
}
const state = g.__marvenIndexState;

export function isEnabled(): boolean {
  return state.enabled;
}
export function setEnabled(v: boolean): void {
  state.enabled = !!v;
}

export function getExcludePatterns(): string[] {
  return [...state.excludePatterns];
}

export function setExcludePatterns(patterns: string[]): void {
  state.excludePatterns = [...new Set(patterns.map((p) => p.trim()).filter(Boolean))];
  // Recreate indexers so future runs use the new policy while retaining the
  // existing SQLite stores for fast incremental updates.
  state.indexers.clear();
  state.embedders.clear();
}

export function getStore(workspaceRoot: string): IndexStore {
  let s = state.stores.get(workspaceRoot);
  if (!s) {
    s = IndexStore.open(workspaceRoot);
    state.stores.set(workspaceRoot, s);
  }
  return s;
}

export function getIndexer(workspaceRoot: string): Indexer {
  let idx = state.indexers.get(workspaceRoot);
  if (!idx) {
    const store = getStore(workspaceRoot);
    const embedder = new Embedder();
    state.embedders.set(workspaceRoot, embedder);
    idx = new Indexer({ workspaceRoot, store, embedder, excludePatterns: state.excludePatterns });
    state.indexers.set(workspaceRoot, idx);
  }
  return idx;
}

export function getEmbedder(workspaceRoot: string): Embedder {
  // Make sure the indexer (and therefore the embedder) is initialised.
  getIndexer(workspaceRoot);
  return state.embedders.get(workspaceRoot)!;
}

export function getStats(workspaceRoot: string | null): IndexStats | null {
  if (!workspaceRoot) return null;
  try {
    return getStore(workspaceRoot).stats();
  } catch {
    return null;
  }
}

export function getCurrentRun(workspaceRoot?: string | null): IndexRunHandle | null {
  if (workspaceRoot) return state.currentRuns.get(workspaceRoot) ?? null;
  return state.currentRuns.values().next().value ?? null;
}

function emit(handle: IndexRunHandle, e: IndexEvent) {
  for (const l of handle.listeners) {
    try {
      l(e);
    } catch {
      /* ignore listener errors */
    }
  }
}

export interface StartRunResult {
  handle: IndexRunHandle;
  // true when this call kicked off a fresh run, false when it reused an
  // already-running one for the same workspace.
  started: boolean;
}

export function startRun(workspaceRoot: string): StartRunResult {
  const existing = state.currentRuns.get(workspaceRoot);
  if (existing) {
    return { handle: existing, started: false };
  }
  const indexer = getIndexer(workspaceRoot);
  const embedder = getEmbedder(workspaceRoot);
  const abort = new AbortController();
  const handle: IndexRunHandle = {
    workspaceRoot,
    abort,
    progress: { filesDone: 0, filesTotal: 0, chunksDone: 0 },
    listeners: new Set(),
    donePromise: Promise.resolve(),
    startedAt: Date.now(),
    lastError: null,
  };
  state.currentRuns.set(workspaceRoot, handle);

  handle.donePromise = (async () => {
    // First-time setup: pull the embedding model via Ollama if it's missing.
    // We do this through ensureModelInstalled() which handles tag-lookup, pull,
    // and stream-drain internally. To surface progress to the UI we peek the
    // /api/tags response first so we can emit "pulling" *before* the (long)
    // pull starts. Any network error from the tags probe is treated as
    // "Ollama unreachable" and surfaced with a friendly message.
    if (/^https?:\/\/localhost|^https?:\/\/127\.0\.0\.1/.test(embedder.url)) {
      // Only run the preflight for real local Ollama URLs. Test embedders
      // (url: http://test-embedder) skip this and rely on their stubbed
      // ensureModelInstalled.
      let modelMissing = false;
      try {
        const tags = await fetch(`${embedder.url}/api/tags`);
        if (tags.ok) {
          const data = (await tags.json()) as { models?: Array<{ name: string }> };
          modelMissing = !(data.models ?? []).some(
            (m) => m.name.split(":")[0] === embedder.model,
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/fetch|ECONN|connect/i.test(msg)) {
          throw new Error(
            `Cannot reach Ollama at ${embedder.url}. Install from https://ollama.com and make sure it's running, then retry indexing.`,
          );
        }
        throw e;
      }
      if (modelMissing) {
        emit(handle, { type: "embedding-model-pulling", data: { model: embedder.model } });
      }
    }

    const pullRes = await embedder.ensureModelInstalled();
    if (!pullRes.ok) {
      throw new Error(
        `Embedding model "${embedder.model}" could not be downloaded: ${pullRes.error}. ` +
          `Is Ollama running? Install from https://ollama.com and try again.`,
      );
    }
    emit(handle, { type: "embedding-model-ready", data: { model: embedder.model } });

    return indexer.runFull({
      signal: abort.signal,
      onProgress: (p) => {
        handle.progress = p;
        emit(handle, { type: "progress", data: p });
      },
    });
  })()
    .then(
      (result) => {
        // Surface per-file failures (embedder outage, sqlite errors) that the
        // indexer used to swallow — "done" with 0 files and no error left the
        // user believing semantic search worked when it never indexed.
        if (result.lastError) {
          handle.lastError = result.lastError;
          emit(handle, { type: "error", data: { message: result.lastError } });
        }
        emit(handle, { type: "done", data: result });
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        handle.lastError = message;
        emit(handle, { type: "error", data: { message } });
      },
    )
    .finally(() => {
      if (state.currentRuns.get(workspaceRoot) === handle) {
        state.currentRuns.delete(workspaceRoot);
      }
    });

  return { handle, started: true };
}

export function cancelRun(workspaceRoot?: string | null): boolean {
  const handle = getCurrentRun(workspaceRoot);
  if (!handle) return false;
  handle.abort.abort();
  return true;
}

export function subscribe(handle: IndexRunHandle, l: IndexEventListener): () => void {
  handle.listeners.add(l);
  return () => handle.listeners.delete(l);
}

export async function clearWorkspace(workspaceRoot: string): Promise<void> {
  const run = state.currentRuns.get(workspaceRoot);
  if (run) {
    run.abort.abort();
    state.currentRuns.delete(workspaceRoot);
  }
  const store = getStore(workspaceRoot);
  for (const p of store.allPaths()) store.removeFile(p);
}

// Test-only: tear down all cached state. The route handler unit tests use
// this to avoid leaking sqlite handles between cases.
export function __resetForTests(): void {
  for (const run of state.currentRuns.values()) run.abort.abort();
  state.currentRuns.clear();
  for (const s of state.stores.values()) {
    try {
      s.close();
    } catch {
      /* ignore */
    }
  }
  state.stores.clear();
  state.indexers.clear();
  state.embedders.clear();
  state.enabled = true;
  state.excludePatterns = [];
}

// Test-only: inject custom store/indexer factories so unit tests can use the
// in-memory store + a mocked Embedder without touching ~/.marven/.
export interface TestInjection {
  store: IndexStore;
  indexer: Indexer;
  /**
   * Optional embedder injection. When provided, startRun() will use it for the
   * "ensure model installed" preflight instead of constructing a real Embedder
   * that talks to localhost:11434 — which would hang in tests.
   */
  embedder?: Embedder;
}
export function __injectForTests(workspaceRoot: string, inj: TestInjection): void {
  state.stores.set(workspaceRoot, inj.store);
  state.indexers.set(workspaceRoot, inj.indexer);
  if (inj.embedder) {
    state.embedders.set(workspaceRoot, inj.embedder);
  } else {
    // Default to a no-op embedder for tests that don't bring their own.
    const noop = {
      url: "http://test-embedder",
      model: "test-model",
      ensureModelInstalled: async () => ({ ok: true }),
      embed: async () => new Float32Array(0),
      embedBatch: async () => [],
    } as unknown as Embedder;
    state.embedders.set(workspaceRoot, noop);
  }
}
