# Codebase Indexing — Design Spec

**Date:** 2026-05-24
**Status:** Approved (Phase 2 of 4 in the Cursor-parity roadmap)

---

## Goal

Give Marven semantic awareness of the entire workspace. The agent (and humans, via UI) can ask natural-language questions like "where do we handle JWT validation?" and get the most relevant code chunks back — even when no exact keyword match exists.

## Problem

Marven's agent currently navigates code by calling `list_files`, `search_files` (text grep), and `read_file`. Three issues:

1. **Many tool calls per question** — finding the right file often takes 5–10 round trips.
2. **No semantic matching** — searching "auth flow" misses files named `oauth-callback.ts` or `session.ts` that handle auth without using the word "auth".
3. **Weak local models burn context** exploring the filesystem instead of reasoning about code.

Cursor's `@codebase` solves this with embeddings — index every file's chunks into vectors, retrieve top-K by cosine similarity. We do the same, fully local.

---

## Scope

This spec covers:
- **Embedder** — wraps Ollama's `/api/embeddings` endpoint with `nomic-embed-text` model
- **Chunker** — splits files into ~60-line overlapping chunks
- **Vector store** — SQLite with the `sqlite-vec` extension (single-file DB)
- **Indexer** — orchestrates: walk workspace → chunk → embed → store
- **File watcher** — incremental reindex on save (debounced)
- **Agent tool** — `search_codebase(query, limit)` exposed to the agent loop
- **Settings** — toggle to enable/disable, button to trigger full reindex

Out of scope (deferred):
- AST-aware chunking (tree-sitter)
- Non-text indexing (PDF, images)
- Multi-workspace federation
- Cross-encoder reranking
- Hybrid BM25 + vector search

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Agent Loop (existing)                                         │
│  ─ search_codebase tool call ──────────────────────────────►   │
│                                                                │
│                                                                ▼
│                                                  ┌───────────────────────┐
│                                                  │ lib/index/search.ts   │
│                                                  │  - embed(query)       │
│                                                  │  - sql vec0 query     │
│                                                  │  - return chunks      │
│                                                  └──────────┬────────────┘
│                                                             │
│                                                             ▼
│                                                  ┌───────────────────────┐
│                                                  │ ~/.marven/index/      │
│                                                  │  <ws-hash>/vectors.db │
│                                                  │  (SQLite + vec0)      │
│                                                  └──────────┬────────────┘
│                                                             ▲
│                                                             │
│  ┌──────────────────────────────────────────────────────────┴──────────┐
│  │  Indexer (electron main, runs on workspace open + file save)        │
│  │  - lib/index/walker.ts  →  list candidate files                     │
│  │  - lib/index/chunker.ts →  split into chunks                        │
│  │  - lib/index/embedder.ts → ollama /api/embeddings (nomic-embed-text)│
│  │  - lib/index/store.ts   →  upsert chunks + vectors into SQLite      │
│  └─────────────────────────────────────────────────────────────────────┘
└────────────────────────────────────────────────────────────────┘
```

### Files

| File | Change |
|------|--------|
| `lib/index/embedder.ts` | New — Ollama embeddings client |
| `lib/index/chunker.ts` | New — line-based chunking with overlap |
| `lib/index/walker.ts` | New — workspace walker with ignore patterns |
| `lib/index/store.ts` | New — SQLite + sqlite-vec persistence |
| `lib/index/indexer.ts` | New — orchestrator (full + incremental) |
| `lib/index/search.ts` | New — top-K query |
| `lib/index/*.test.ts` | New — vitest suites for each module |
| `electron/index/indexerHost.js` | New — hosts the indexer in main process, exposes IPC |
| `electron/main.js` | Modify — start indexerHost on workspace open |
| `electron/preload.js` | Modify — expose `marvenElectron.index.*` IPC |
| `lib/agent/tools.ts` (or equivalent) | Modify — add `search_codebase` tool definition |
| `lib/agent/toolExecutor.ts` (or equivalent) | Modify — route `search_codebase` to `lib/index/search.ts` |
| `app/components/marven/SettingsModal.tsx` | Modify — add "Codebase Indexing" section in General tab |
| `electron/main.js` | Modify — `codebaseIndexEnabled` setting (default: true) |
| `package.json` | Modify — add `better-sqlite3` and `sqlite-vec` |
| `types/index.ts` | Modify — add index-related types |

---

## Section 1: Embedder

**File:** `lib/index/embedder.ts`

Wraps Ollama's `/api/embeddings` endpoint:

```ts
export const EMBED_MODEL = "nomic-embed-text";       // 768-dim, ~150MB
export const EMBED_DIM = 768;

export interface EmbedderOptions {
  ollamaUrl?: string;       // defaults to OLLAMA_URL env or http://localhost:11434
  model?: string;           // defaults to EMBED_MODEL
  batchSize?: number;       // defaults to 8 — embed concurrently
}

export class Embedder {
  constructor(opts?: EmbedderOptions);
  ensureModelInstalled(): Promise<{ ok: boolean; error?: string }>;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
}
```

`ensureModelInstalled()`:
1. GET `/api/tags` — check if `nomic-embed-text` is listed.
2. If not, POST `/api/pull` with `{ name: "nomic-embed-text" }` and stream until done.
3. Return `{ ok: true }` once installed.

`embed(text)` returns a `Float32Array(768)`.

`embedBatch(texts)` resolves `batchSize` in parallel chunks to avoid hammering Ollama.

Errors (Ollama unreachable, model pull failure) reject with a tagged error — caller decides whether to disable indexing.

---

## Section 2: Chunker

**File:** `lib/index/chunker.ts`

```ts
export interface Chunk {
  /** File path relative to workspace root. */
  path: string;
  /** 0-indexed start line (inclusive). */
  startLine: number;
  /** 0-indexed end line (inclusive). */
  endLine: number;
  /** The chunk's text. */
  text: string;
}

export interface ChunkOptions {
  /** Default 60 lines. */
  linesPerChunk?: number;
  /** Default 10 lines — overlap between adjacent chunks for context continuity. */
  overlapLines?: number;
  /** Default 8000 chars — reject chunks larger than this (binary-ish files). */
  maxChars?: number;
}

export function chunkFile(path: string, content: string, opts?: ChunkOptions): Chunk[];
```

Algorithm:

```
lines = content.split("\n")
chunks = []
for start in 0 to lines.length step (linesPerChunk - overlapLines):
  end = min(start + linesPerChunk, lines.length)
  chunkText = lines.slice(start, end).join("\n")
  if chunkText.length > maxChars: skip (will be re-flagged as binary at walker level)
  if chunkText.trim().length === 0: skip
  chunks.push({ path, startLine: start, endLine: end - 1, text: chunkText })
  if end === lines.length: break
return chunks
```

---

## Section 3: Walker

**File:** `lib/index/walker.ts`

Walks a directory and yields candidate file paths. Skips by hard-coded rules; user can NOT customize in v1 (YAGNI).

```ts
export interface WalkOptions {
  /** Default false. When true, returns binary-test results too (for testing). */
  includeBinaryChecks?: boolean;
}

export async function* walkWorkspace(root: string, opts?: WalkOptions): AsyncGenerator<string>;
```

Skip rules:
- Directories: `node_modules`, `.git`, `.next`, `dist`, `build`, `out`, `.cache`, `.turbo`, `coverage`, `target`, `__pycache__`, `.venv`, `venv`
- File extensions (binary): `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.ico`, `.pdf`, `.zip`, `.tar`, `.gz`, `.mp3`, `.mp4`, `.wav`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.bin`, `.exe`, `.dll`, `.so`, `.dylib`
- File names: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `*.tsbuildinfo`
- File size: skip if >256KB (likely generated/minified)
- Content check on first 1024 bytes: if contains a null byte, skip as binary

---

## Section 4: Store

**File:** `lib/index/store.ts`

Wraps `better-sqlite3` + the `sqlite-vec` extension. One DB per workspace, stored at `~/.marven/index/<ws-hash>/vectors.db` where `ws-hash = sha1(workspaceRoot).slice(0,12)`.

### Schema

```sql
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  mtime_ms INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  hash TEXT NOT NULL                 -- sha1 of content
);

CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE INDEX idx_chunks_path ON chunks(path);

-- vec0 virtual table holds the 768-dim embeddings
CREATE VIRTUAL TABLE chunk_vectors USING vec0(
  embedding float[768]
);
-- chunk_vectors.rowid is kept in sync with chunks.id
```

### API

```ts
export class IndexStore {
  static open(workspaceRoot: string): IndexStore;

  /** Whole-file replace: deletes existing chunks/vectors for path, inserts new ones. Transactional. */
  upsertFile(args: {
    path: string;
    mtimeMs: number;
    sizeBytes: number;
    hash: string;
    chunks: Array<{ startLine: number; endLine: number; text: string; embedding: Float32Array }>;
  }): void;

  /** Returns the stored hash for a path, or null if not indexed. */
  getFileHash(path: string): string | null;

  /** Remove a file (and its chunks/vectors) from the index. */
  removeFile(path: string): void;

  /** Returns top-K chunks by cosine similarity to the query embedding. */
  search(queryEmbedding: Float32Array, limit: number): Array<{
    path: string;
    startLine: number;
    endLine: number;
    text: string;
    distance: number;
  }>;

  /** For maintenance / settings UI. */
  stats(): { fileCount: number; chunkCount: number; dbSizeBytes: number };

  close(): void;
}
```

vec0's cosine similarity:

```sql
SELECT c.path, c.start_line, c.end_line, c.text, v.distance
FROM chunk_vectors v
JOIN chunks c ON c.id = v.rowid
WHERE v.embedding MATCH ?
ORDER BY v.distance ASC
LIMIT ?
```

---

## Section 5: Indexer

**File:** `lib/index/indexer.ts`

Orchestrates walker → chunker → embedder → store. Two modes:

### Full index

Triggered on workspace open if hash mismatches what's in `~/.marven/index/<ws-hash>/last-state.json`.

```ts
indexer.runFull({
  onProgress?: (p: { filesDone: number; filesTotal: number; chunksDone: number }) => void,
  signal?: AbortSignal,
}): Promise<{ filesIndexed: number; chunksIndexed: number; durationMs: number }>;
```

Logic:
```
1. Walk workspace, collect candidate paths (cap 5000 files in v1 to bound memory)
2. For each path:
   a. Read content, compute sha1
   b. If store.getFileHash(path) === currentHash → skip (unchanged since last run)
   c. Chunk → embed batch → store.upsertFile(...)
   d. onProgress (every file)
3. For any path in store but NOT in walker result → store.removeFile(path)
4. Write last-state.json with overall workspace hash + timestamp
```

### Incremental update

Triggered on file save (via existing IPC `marven:file-saved` or new watcher).

```ts
indexer.updateFile(path: string): Promise<void>;
indexer.deleteFile(path: string): Promise<void>;
```

`updateFile`:
- Re-reads, re-chunks, re-embeds, `store.upsertFile(...)`.
- If size > 256KB or now binary → `store.removeFile(path)`.

`deleteFile`:
- `store.removeFile(path)`.

### Concurrency

- Only one full-index run at a time (queued promise lock).
- Incremental updates run during full-index — they're tiny and serialize on the store's `BEGIN IMMEDIATE` transactions.

---

## Section 6: Search

**File:** `lib/index/search.ts`

```ts
export interface SearchResult {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  /** Lower is more similar. vec0 returns cosine distance ∈ [0, 2]. */
  distance: number;
}

export async function searchCodebase(opts: {
  workspaceRoot: string;
  query: string;
  limit?: number;     // default 8
}): Promise<SearchResult[]>;
```

Implementation:
1. `const e = new Embedder(); const v = await e.embed(query);`
2. `const store = IndexStore.open(workspaceRoot); return store.search(v, limit);`

---

## Section 7: Electron Indexer Host

**File:** `electron/index/indexerHost.js`

Runs the indexer in the **main process** so it can do heavy I/O without blocking the renderer.

IPC surface (exposed via `marvenElectron.index.*`):

```js
index.status(): Promise<{ enabled: boolean; running: boolean; stats: { fileCount, chunkCount, dbSizeBytes } | null; lastError?: string }>
index.runFull(): Promise<void>       // fire-and-forget; progress comes via "index:progress" event
index.search(query, limit): Promise<SearchResult[]>
index.cancel(): Promise<void>
index.clear(): Promise<void>          // wipe DB for current workspace
```

Events broadcast to all renderers via `webContents.send`:
- `index:progress` `{ filesDone, filesTotal, chunksDone }`
- `index:done` `{ filesIndexed, chunksIndexed, durationMs }`
- `index:error` `{ message }`

Trigger order on workspace open:
1. Renderer changes workspace → IPC `marven:set-workspace`
2. Main calls `indexerHost.setWorkspace(root)` — opens store, checks last-state.json
3. If hash differs (or no last-state.json), main fires `indexerHost.runFull()` in background
4. Renderer sees progress events; shows toast at start, dismisses at done

---

## Section 8: Agent Tool

**Files:** `lib/agent/tools.ts` (or wherever `TOOL_DEFINITIONS` lives — discovered during plan), `lib/agent/toolExecutor.ts`

Add `search_codebase` to `TOOL_DEFINITIONS`:

```ts
{
  name: "search_codebase",
  description: "Semantic search across the workspace. Returns code chunks ranked by meaning, not just keywords. Use this BEFORE search_files when looking for concepts, patterns, or 'where do we do X' questions.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Natural-language search query." },
      limit: { type: "number", description: "Number of chunks to return. Default 8, max 20." }
    },
    required: ["query"]
  }
}
```

Executor wires to `searchCodebase(...)` and formats output as:

```
[1] src/auth/jwt.ts:42-89 (distance 0.21)
function validateToken(token: string): User | null { ... }

[2] middleware/auth.ts:10-55 (distance 0.28)
export const authMiddleware = ...
```

Add to the **standard tier** tool set. Add to the **simple tier** as well — it dramatically reduces the number of tool calls needed.

---

## Section 9: Settings UI

**File:** `app/components/marven/SettingsModal.tsx`

New section "Codebase Indexing" under General:

```
Codebase Indexing
─────────────────
[Toggle] Enable codebase indexing                          ON
         Lets the agent search your code semantically. Uses Ollama
         (nomic-embed-text). Index lives at ~/.marven/index/.

Status: ●  Ready · 142 files · 1,038 chunks · 8.2 MB

[Reindex now]   [Clear index]
```

Reads/writes `codebaseIndexEnabled: boolean` via existing settings helper. Default `true`.

When toggled off:
- `indexerHost.cancel()` if running
- No new search calls — `search_codebase` tool returns `{ error: "Codebase indexing is disabled" }`

---

## Section 10: Testing

### Unit

- `embedder.test.ts` — mock `fetch`, assert correct request shape; `ensureModelInstalled` pulls when missing.
- `chunker.test.ts` — overlap correctness, empty file → no chunks, large char file → skipped.
- `walker.test.ts` — fixture dir with `node_modules`, binary file, large file, normal files → only normal files yielded.
- `store.test.ts` — in-memory SQLite. Upsert + search round-trip. Stale chunks deleted on upsert.
- `indexer.test.ts` — uses temp dir, mocked Embedder (deterministic vectors), runs full + incremental.
- `search.test.ts` — sanity check that query is embedded and forwarded to store.

### E2E (gated by `RUN_INDEX_E2E=1`)

- Spawn Ollama if available; pull `nomic-embed-text`; index 3 small synthetic files; assert that searching "json parser" returns the file containing `JSON.parse`.

### Manual

- Open Marven on this repo. Wait for first index (≤2 min for ~500 files).
- Ask agent: "where do we handle MCP server settings?" — agent calls `search_codebase`, returns chunks pointing at the right files.

---

## Section 11: Error Handling

- **Ollama not running**: `embedder.embed` rejects. Indexer marks state errored, status badge red. Agent's `search_codebase` returns `{ error: "Embedding service unavailable. Is Ollama running?" }`.
- **`sqlite-vec` extension fails to load** (older SQLite, ARM mismatch): on store open, surface clear error in StatusBar; disable feature gracefully.
- **Workspace too large** (>5000 files): truncate, log warning, continue with the first 5000 by mtime descending.
- **Embedding rate-limit** (Ollama overloaded): exponential backoff up to 3 retries per chunk; after that, skip the chunk and log.
- **Corrupted DB**: detect via SQLite integrity check; delete and reindex.

---

## What Does Not Change

- The agent loop, system prompts, and tier classifier — all untouched. We add one new tool definition.
- Existing tools (`list_files`, `read_file`, `search_files`, etc.) keep working. `search_codebase` is additive.
- The CodeMirror editor — untouched. (The `@codebase` chat UI is Phase 4.)
- LSP — untouched.

---

## Performance Budget

- **First-time index** (500 files, ~3000 chunks): ≤120s on M1, ≤300s on intel laptop. Mostly bounded by Ollama embedding throughput.
- **Incremental update on save**: <500ms per file (typical: <100ms).
- **Search query**: <100ms (embed query: ~30ms + vec0 lookup: ~10ms).
- **DB size**: ~3KB per chunk → ~10MB for a 3000-chunk repo.

If we exceed these, profile before optimizing.

---

## Future (Phase 2.5)

- AST-aware chunking (tree-sitter) — better chunk boundaries at function/class level
- Hybrid scoring (BM25 + vector) — improves keyword-heavy queries
- Reranking with a cross-encoder model (e.g. `bge-reranker-base`) — top-K → top-3
- Workspace-relative index sharing across machines via export/import
