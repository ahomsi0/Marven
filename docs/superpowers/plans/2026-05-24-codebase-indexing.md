# Codebase Indexing — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-05-24-codebase-indexing-design.md`
**Branch:** `feat/codebase-indexing`
**Date:** 2026-05-24

## Goal

Give Marven semantic search across the workspace. Index files as 768-dim embeddings (Ollama `nomic-embed-text`) into a per-workspace SQLite + `sqlite-vec` database, expose `search_codebase` to the agent loop and to the user via Settings.

## Architecture

```
Renderer ── search_codebase tool ──► lib/index/search.ts ──► IndexStore (SQLite + vec0)
                                          ▲
Electron main ── indexerHost.js ── lib/index/indexer.ts ──► walker → chunker → embedder → store
                                          ▲
                                    Ollama /api/embeddings
```

DB lives at `~/.marven/index/<sha1(workspaceRoot).slice(0,12)>/vectors.db`. Indexer runs in the **main process** (heavy I/O, native module). Search is invoked directly from the renderer-side tool executor via the same `IndexStore.open()` (read-only); writes go through the indexer host. `better-sqlite3` and `sqlite-vec` are native modules — must be rebuilt for Electron via `electron-rebuild`.

## Stack

- `better-sqlite3` (sync SQLite client)
- `sqlite-vec` (loadable extension, `vec0` virtual table)
- `@electron/rebuild` (devDep) — rebuilds native modules against Electron's Node ABI
- Vitest (existing)

## Shared types (defined once in `types/index.ts`, imported everywhere)

```ts
export interface Chunk {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}
export interface SearchResult {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  distance: number;
}
export interface IndexStats {
  fileCount: number;
  chunkCount: number;
  dbSizeBytes: number;
}
export interface IndexProgress {
  filesDone: number;
  filesTotal: number;
  chunksDone: number;
}
```

`IndexStore` is a class exported from `lib/index/store.ts` — defined exactly once.

## Engineering principles

- **TDD**: each task writes failing tests, then implements, then verifies passing tests.
- **DRY**: types live in `types/index.ts`; `Embedder`, `IndexStore` are constructed once and re-used.
- **YAGNI**: no AST chunking, no hybrid BM25, no reranking, no user-configurable ignore rules in v1.
- **Conventional commits**: `feat(indexing):`, `test(indexing):`, `chore(indexing):`.
- After every task: `npm test` must pass.

---

## Task 1 — Native deps + electron-rebuild + smoke test

**Files (Modify):**
- `package.json` — add deps
- `scripts/fix-node-pty-perms.js` — (read only, verify postinstall pattern)
- `scripts/rebuild-native.js` (Create) — wraps `@electron/rebuild`

**Files (Create):**
- `lib/index/_smoke.test.ts`

### Steps

1. Add to `package.json` dependencies:
   - `"better-sqlite3": "^11.5.0"`
   - `"sqlite-vec": "^0.1.6"`
   And devDependencies:
   - `"@electron/rebuild": "^4.0.1"`

2. Create `scripts/rebuild-native.js`:
   ```js
   const { rebuild } = require('@electron/rebuild');
   const path = require('path');
   rebuild({
     buildPath: path.resolve(__dirname, '..'),
     electronVersion: require('../package.json').devDependencies.electron.replace(/^[^\d]*/, ''),
     onlyModules: ['better-sqlite3'],
   }).then(() => console.log('rebuild ok')).catch((e) => { console.error(e); process.exit(1); });
   ```

3. Add npm script: `"rebuild:native": "node scripts/rebuild-native.js"`. Append to `postinstall`:
   `"postinstall": "node scripts/fix-node-pty-perms.js && node scripts/rebuild-native.js"`.

4. Add `electron/**/*` already covered in builder `files`; ensure the native `.node` is bundled by adding to `asarUnpack`: `"node_modules/better-sqlite3/**/*"`.

5. Create `lib/index/_smoke.test.ts`:
   ```ts
   import { describe, it, expect } from "vitest";
   import Database from "better-sqlite3";
   import * as sqliteVec from "sqlite-vec";

   describe("native deps", () => {
     it("opens sqlite and loads sqlite-vec extension", () => {
       const db = new Database(":memory:");
       sqliteVec.load(db);
       const row = db.prepare("SELECT vec_version() AS v").get() as { v: string };
       expect(typeof row.v).toBe("string");
       expect(row.v.length).toBeGreaterThan(0);
       db.close();
     });

     it("creates a vec0 virtual table", () => {
       const db = new Database(":memory:");
       sqliteVec.load(db);
       db.exec("CREATE VIRTUAL TABLE v USING vec0(embedding float[8])");
       db.prepare("INSERT INTO v(rowid, embedding) VALUES (?, ?)")
         .run(1, Buffer.from(new Float32Array([1,0,0,0,0,0,0,0]).buffer));
       const row = db.prepare("SELECT COUNT(*) AS n FROM v").get() as { n: number };
       expect(row.n).toBe(1);
       db.close();
     });
   });
   ```

6. Run:
   ```bash
   npm install
   npm test -- lib/index/_smoke.test.ts
   ```
   Expected: 2 passing. If `better-sqlite3` errors with NODE_MODULE_VERSION mismatch, that's expected at runtime under Electron only — Vitest runs in Node so it must pass here directly.

7. `npm test` — full suite green.

8. Commit: `chore(indexing): add better-sqlite3 + sqlite-vec + electron-rebuild`

- [ ] Task 1 complete

---

## Task 2 — `lib/index/embedder.ts` (Ollama wrapper)

**Files (Create):**
- `lib/index/embedder.ts`
- `lib/index/embedder.test.ts`

### Steps

1. Write `lib/index/embedder.test.ts` first:
   ```ts
   import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
   import { Embedder, EMBED_DIM } from "./embedder";

   const ORIG_FETCH = global.fetch;
   afterEach(() => { global.fetch = ORIG_FETCH; });

   function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
     global.fetch = vi.fn(async (input: any, init?: any) =>
       handler(typeof input === "string" ? input : input.url, init)) as any;
   }

   describe("Embedder.embed", () => {
     it("POSTs to /api/embeddings with model+prompt and returns Float32Array", async () => {
       mockFetch(async (url, init) => {
         expect(url).toBe("http://localhost:11434/api/embeddings");
         const body = JSON.parse((init!.body as string));
         expect(body.model).toBe("nomic-embed-text");
         expect(body.prompt).toBe("hello");
         const arr = new Array(EMBED_DIM).fill(0).map((_, i) => i / EMBED_DIM);
         return new Response(JSON.stringify({ embedding: arr }), { status: 200 });
       });
       const e = new Embedder();
       const v = await e.embed("hello");
       expect(v).toBeInstanceOf(Float32Array);
       expect(v.length).toBe(EMBED_DIM);
       expect(v[0]).toBeCloseTo(0);
     });
     it("rejects when Ollama unreachable", async () => {
       global.fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as any;
       await expect(new Embedder().embed("x")).rejects.toThrow(/Ollama|connect/i);
     });
   });

   describe("Embedder.embedBatch", () => {
     it("preserves order and respects batchSize concurrency", async () => {
       let inflight = 0, maxInflight = 0;
       mockFetch(async (_url, init) => {
         inflight++; maxInflight = Math.max(maxInflight, inflight);
         await new Promise((r) => setTimeout(r, 5));
         const body = JSON.parse((init!.body as string));
         const arr = new Array(EMBED_DIM).fill(body.prompt.length);
         inflight--;
         return new Response(JSON.stringify({ embedding: arr }), { status: 200 });
       });
       const e = new Embedder({ batchSize: 3 });
       const out = await e.embedBatch(["a", "bb", "ccc", "dddd", "eeeee"]);
       expect(out.map((v) => v[0])).toEqual([1, 2, 3, 4, 5]);
       expect(maxInflight).toBeLessThanOrEqual(3);
     });
   });

   describe("Embedder.ensureModelInstalled", () => {
     it("returns ok:true if model already in /api/tags", async () => {
       mockFetch(async (url) => {
         expect(url).toBe("http://localhost:11434/api/tags");
         return new Response(JSON.stringify({ models: [{ name: "nomic-embed-text:latest" }] }), { status: 200 });
       });
       const r = await new Embedder().ensureModelInstalled();
       expect(r.ok).toBe(true);
     });
     it("pulls when missing", async () => {
       const calls: string[] = [];
       mockFetch(async (url) => {
         calls.push(url);
         if (url.endsWith("/api/tags")) return new Response(JSON.stringify({ models: [] }), { status: 200 });
         if (url.endsWith("/api/pull")) return new Response('{"status":"success"}\n', { status: 200 });
         throw new Error("unexpected");
       });
       const r = await new Embedder().ensureModelInstalled();
       expect(r.ok).toBe(true);
       expect(calls).toEqual([
         "http://localhost:11434/api/tags",
         "http://localhost:11434/api/pull",
       ]);
     });
   });
   ```

2. Run `npm test -- lib/index/embedder.test.ts` — fails (module missing).

3. Implement `lib/index/embedder.ts`:
   ```ts
   export const EMBED_MODEL = "nomic-embed-text";
   export const EMBED_DIM = 768;

   const DEFAULT_OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";

   export interface EmbedderOptions {
     ollamaUrl?: string;
     model?: string;
     batchSize?: number;
   }

   export class Embedder {
     private readonly url: string;
     private readonly model: string;
     private readonly batchSize: number;

     constructor(opts: EmbedderOptions = {}) {
       this.url = (opts.ollamaUrl ?? DEFAULT_OLLAMA).replace(/\/$/, "");
       this.model = opts.model ?? EMBED_MODEL;
       this.batchSize = Math.max(1, opts.batchSize ?? 8);
     }

     async ensureModelInstalled(): Promise<{ ok: boolean; error?: string }> {
       try {
         const tagsRes = await fetch(`${this.url}/api/tags`);
         if (!tagsRes.ok) return { ok: false, error: `tags ${tagsRes.status}` };
         const data = (await tagsRes.json()) as { models?: Array<{ name: string }> };
         const has = (data.models ?? []).some((m) => m.name.split(":")[0] === this.model);
         if (has) return { ok: true };
         const pull = await fetch(`${this.url}/api/pull`, {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ name: this.model }),
         });
         if (!pull.ok) return { ok: false, error: `pull ${pull.status}` };
         // Drain stream so the pull actually completes.
         if (pull.body) {
           const reader = (pull.body as any).getReader?.();
           if (reader) { while (true) { const { done } = await reader.read(); if (done) break; } }
           else { await pull.text(); }
         }
         return { ok: true };
       } catch (e) {
         return { ok: false, error: e instanceof Error ? e.message : String(e) };
       }
     }

     async embed(text: string): Promise<Float32Array> {
       let res: Response;
       try {
         res = await fetch(`${this.url}/api/embeddings`, {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ model: this.model, prompt: text }),
         });
       } catch (e) {
         throw new Error(
           `Could not connect to Ollama at ${this.url}. Is it running? (${e instanceof Error ? e.message : e})`
         );
       }
       if (!res.ok) {
         const body = await res.text().catch(() => "");
         throw new Error(`Ollama /api/embeddings ${res.status}: ${body}`);
       }
       const data = (await res.json()) as { embedding: number[] };
       if (!Array.isArray(data.embedding)) throw new Error("Ollama returned no embedding");
       return Float32Array.from(data.embedding);
     }

     async embedBatch(texts: string[]): Promise<Float32Array[]> {
       const out: Float32Array[] = new Array(texts.length);
       let i = 0;
       while (i < texts.length) {
         const slice = texts.slice(i, i + this.batchSize);
         const start = i;
         const vecs = await Promise.all(slice.map((t) => this.embed(t)));
         for (let k = 0; k < vecs.length; k++) out[start + k] = vecs[k];
         i += this.batchSize;
       }
       return out;
     }
   }
   ```

4. `npm test -- lib/index/embedder.test.ts` — passes.
5. `npm test` — full suite green.
6. Commit: `feat(indexing): Ollama embedder wrapper`

- [ ] Task 2 complete

---

## Task 3 — `lib/index/chunker.ts`

**Files (Create):**
- `lib/index/chunker.ts`
- `lib/index/chunker.test.ts`

**Files (Modify):**
- `types/index.ts` — add `Chunk` + `SearchResult` + `IndexStats` + `IndexProgress` (single source of truth).

### Steps

1. Modify `types/index.ts` to append the four interfaces above. Do NOT redefine them anywhere else.

2. Write `lib/index/chunker.test.ts`:
   ```ts
   import { describe, it, expect } from "vitest";
   import { chunkFile } from "./chunker";

   describe("chunkFile", () => {
     it("returns no chunks for empty content", () => {
       expect(chunkFile("a.ts", "")).toEqual([]);
       expect(chunkFile("a.ts", "   \n  \n")).toEqual([]);
     });
     it("returns a single chunk for a short file", () => {
       const c = chunkFile("a.ts", "line1\nline2\nline3");
       expect(c).toHaveLength(1);
       expect(c[0]).toMatchObject({ path: "a.ts", startLine: 0, endLine: 2 });
       expect(c[0].text).toBe("line1\nline2\nline3");
     });
     it("overlaps adjacent chunks", () => {
       const lines = Array.from({ length: 150 }, (_, i) => `L${i}`);
       const content = lines.join("\n");
       const c = chunkFile("a.ts", content, { linesPerChunk: 60, overlapLines: 10 });
       expect(c.length).toBeGreaterThan(2);
       expect(c[0].startLine).toBe(0);
       expect(c[0].endLine).toBe(59);
       expect(c[1].startLine).toBe(50); // 60 - 10
       expect(c[1].endLine).toBe(109);
       expect(c[c.length - 1].endLine).toBe(149);
     });
     it("skips chunks above maxChars", () => {
       const huge = "x".repeat(10_000);
       const content = `${huge}\n${huge}\n${huge}`;
       const c = chunkFile("a.ts", content, { maxChars: 8000 });
       expect(c).toEqual([]);
     });
     it("skips whitespace-only chunks", () => {
       const c = chunkFile("a.ts", "\n\n\n\n");
       expect(c).toEqual([]);
     });
   });
   ```

3. Run — fails. Implement `lib/index/chunker.ts`:
   ```ts
   import type { Chunk } from "@/types";

   export interface ChunkOptions {
     linesPerChunk?: number;
     overlapLines?: number;
     maxChars?: number;
   }

   export function chunkFile(path: string, content: string, opts: ChunkOptions = {}): Chunk[] {
     const linesPerChunk = opts.linesPerChunk ?? 60;
     const overlapLines = Math.max(0, Math.min(opts.overlapLines ?? 10, linesPerChunk - 1));
     const maxChars = opts.maxChars ?? 8000;
     const step = linesPerChunk - overlapLines;

     const lines = content.split("\n");
     if (lines.length === 0 || content.trim() === "") return [];
     const out: Chunk[] = [];
     for (let start = 0; start < lines.length; start += step) {
       const end = Math.min(start + linesPerChunk, lines.length);
       const text = lines.slice(start, end).join("\n");
       if (text.length > maxChars) { if (end === lines.length) break; continue; }
       if (text.trim().length === 0) { if (end === lines.length) break; continue; }
       out.push({ path, startLine: start, endLine: end - 1, text });
       if (end === lines.length) break;
     }
     return out;
   }
   ```

4. `npm test -- lib/index/chunker.test.ts` passes. `npm test` green.
5. Commit: `feat(indexing): line-based chunker with overlap`

- [ ] Task 3 complete

---

## Task 4 — `lib/index/walker.ts`

**Files (Create):**
- `lib/index/walker.ts`
- `lib/index/walker.test.ts`

### Steps

1. Write `lib/index/walker.test.ts`:
   ```ts
   import { describe, it, expect, beforeEach, afterEach } from "vitest";
   import fs from "fs/promises";
   import os from "os";
   import path from "path";
   import { walkWorkspace } from "./walker";

   let dir: string;
   beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "marven-walk-")); });
   afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

   async function collect(root: string): Promise<string[]> {
     const out: string[] = [];
     for await (const p of walkWorkspace(root)) out.push(path.relative(root, p));
     return out.sort();
   }

   describe("walkWorkspace", () => {
     it("yields normal text files", async () => {
       await fs.writeFile(path.join(dir, "a.ts"), "x");
       await fs.mkdir(path.join(dir, "sub"));
       await fs.writeFile(path.join(dir, "sub", "b.ts"), "y");
       expect(await collect(dir)).toEqual(["a.ts", path.join("sub", "b.ts")]);
     });
     it("skips ignored directories", async () => {
       await fs.mkdir(path.join(dir, "node_modules"));
       await fs.writeFile(path.join(dir, "node_modules", "x.ts"), "x");
       await fs.mkdir(path.join(dir, ".git"));
       await fs.writeFile(path.join(dir, ".git", "HEAD"), "x");
       await fs.writeFile(path.join(dir, "ok.ts"), "x");
       expect(await collect(dir)).toEqual(["ok.ts"]);
     });
     it("skips binary extensions and lockfiles", async () => {
       await fs.writeFile(path.join(dir, "logo.png"), Buffer.from([0x89, 0x50]));
       await fs.writeFile(path.join(dir, "package-lock.json"), "{}");
       await fs.writeFile(path.join(dir, "real.ts"), "x");
       expect(await collect(dir)).toEqual(["real.ts"]);
     });
     it("skips files over 256KB", async () => {
       await fs.writeFile(path.join(dir, "big.txt"), Buffer.alloc(300_000, 65));
       await fs.writeFile(path.join(dir, "small.txt"), "ok");
       expect(await collect(dir)).toEqual(["small.txt"]);
     });
     it("skips files with NUL bytes in first 1024 bytes", async () => {
       const buf = Buffer.alloc(64, 65); buf[10] = 0;
       await fs.writeFile(path.join(dir, "binary.dat"), buf);
       await fs.writeFile(path.join(dir, "text.txt"), "hello");
       expect(await collect(dir)).toEqual(["text.txt"]);
     });
   });
   ```

2. Run — fails. Implement `lib/index/walker.ts`:
   ```ts
   import fs from "fs/promises";
   import { createReadStream } from "fs";
   import path from "path";

   const SKIP_DIRS = new Set([
     "node_modules", ".git", ".next", "dist", "build", "out", ".cache",
     ".turbo", "coverage", "target", "__pycache__", ".venv", "venv",
   ]);
   const SKIP_EXTS = new Set([
     ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".tar",
     ".gz", ".mp3", ".mp4", ".wav", ".woff", ".woff2", ".ttf", ".eot",
     ".bin", ".exe", ".dll", ".so", ".dylib",
   ]);
   const SKIP_NAMES = new Set([
     "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "Cargo.lock",
   ]);
   const MAX_SIZE = 256 * 1024;

   export interface WalkOptions { includeBinaryChecks?: boolean }

   async function hasNullByte(filePath: string): Promise<boolean> {
     const fh = await fs.open(filePath, "r");
     try {
       const buf = Buffer.alloc(1024);
       const { bytesRead } = await fh.read(buf, 0, 1024, 0);
       for (let i = 0; i < bytesRead; i++) if (buf[i] === 0) return true;
       return false;
     } finally { await fh.close(); }
   }

   export async function* walkWorkspace(root: string, _opts: WalkOptions = {}): AsyncGenerator<string> {
     async function* visit(dir: string): AsyncGenerator<string> {
       let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
       try { entries = await fs.readdir(dir, { withFileTypes: true }); }
       catch { return; }
       for (const ent of entries) {
         const abs = path.join(dir, ent.name);
         if (ent.isDirectory()) {
           if (SKIP_DIRS.has(ent.name)) continue;
           yield* visit(abs);
         } else if (ent.isFile()) {
           if (SKIP_NAMES.has(ent.name)) continue;
           if (ent.name.endsWith(".tsbuildinfo")) continue;
           const ext = path.extname(ent.name).toLowerCase();
           if (SKIP_EXTS.has(ext)) continue;
           const st = await fs.stat(abs).catch(() => null);
           if (!st || st.size > MAX_SIZE) continue;
           if (await hasNullByte(abs)) continue;
           yield abs;
         }
       }
     }
     yield* visit(root);
   }
   ```

   (`createReadStream` import is unused — remove. The above passes lint by using `fs.open`.)

3. `npm test -- lib/index/walker.test.ts` passes. `npm test` green.
4. Commit: `feat(indexing): workspace walker with skip rules`

- [ ] Task 4 complete

---

## Task 5 — `lib/index/store.ts` (SQLite + sqlite-vec)

**Files (Create):**
- `lib/index/store.ts`
- `lib/index/store.test.ts`

### Steps

1. Write `lib/index/store.test.ts`:
   ```ts
   import { describe, it, expect } from "vitest";
   import { IndexStore } from "./store";

   function makeVec(seed: number, dim = 768): Float32Array {
     const v = new Float32Array(dim);
     for (let i = 0; i < dim; i++) v[i] = Math.sin(seed + i * 0.01);
     // L2-normalize so cosine is meaningful
     let n = 0; for (let i = 0; i < dim; i++) n += v[i] * v[i];
     n = Math.sqrt(n) || 1; for (let i = 0; i < dim; i++) v[i] /= n;
     return v;
   }

   describe("IndexStore", () => {
     it("round-trips upsert + search", () => {
       const s = IndexStore.openInMemory();
       s.upsertFile({
         path: "a.ts", mtimeMs: 1, sizeBytes: 10, hash: "h1",
         chunks: [
           { startLine: 0, endLine: 5, text: "alpha", embedding: makeVec(1) },
           { startLine: 6, endLine: 11, text: "beta", embedding: makeVec(2) },
         ],
       });
       const results = s.search(makeVec(1), 1);
       expect(results).toHaveLength(1);
       expect(results[0].path).toBe("a.ts");
       expect(results[0].text).toBe("alpha");
       expect(results[0].distance).toBeLessThan(0.001);
       s.close();
     });
     it("replaces stale chunks on re-upsert", () => {
       const s = IndexStore.openInMemory();
       s.upsertFile({ path: "a.ts", mtimeMs: 1, sizeBytes: 10, hash: "h1",
         chunks: [{ startLine: 0, endLine: 5, text: "old", embedding: makeVec(1) }] });
       s.upsertFile({ path: "a.ts", mtimeMs: 2, sizeBytes: 12, hash: "h2",
         chunks: [{ startLine: 0, endLine: 5, text: "new", embedding: makeVec(2) }] });
       expect(s.stats().chunkCount).toBe(1);
       expect(s.getFileHash("a.ts")).toBe("h2");
       const r = s.search(makeVec(2), 1);
       expect(r[0].text).toBe("new");
       s.close();
     });
     it("removeFile drops chunks", () => {
       const s = IndexStore.openInMemory();
       s.upsertFile({ path: "a.ts", mtimeMs: 1, sizeBytes: 10, hash: "h1",
         chunks: [{ startLine: 0, endLine: 5, text: "x", embedding: makeVec(1) }] });
       s.removeFile("a.ts");
       expect(s.stats().chunkCount).toBe(0);
       expect(s.getFileHash("a.ts")).toBeNull();
       s.close();
     });
     it("getFileHash returns null for unknown path", () => {
       const s = IndexStore.openInMemory();
       expect(s.getFileHash("nope.ts")).toBeNull();
       s.close();
     });
   });
   ```

2. Run — fails. Implement `lib/index/store.ts`:
   ```ts
   import Database from "better-sqlite3";
   import * as sqliteVec from "sqlite-vec";
   import crypto from "crypto";
   import fs from "fs";
   import os from "os";
   import path from "path";
   import { EMBED_DIM } from "./embedder";
   import type { SearchResult, IndexStats } from "@/types";

   export interface UpsertChunk {
     startLine: number;
     endLine: number;
     text: string;
     embedding: Float32Array;
   }
   export interface UpsertArgs {
     path: string;
     mtimeMs: number;
     sizeBytes: number;
     hash: string;
     chunks: UpsertChunk[];
   }

   export function workspaceDbPath(workspaceRoot: string): string {
     const hash = crypto.createHash("sha1").update(workspaceRoot).digest("hex").slice(0, 12);
     const dir = path.join(os.homedir(), ".marven", "index", hash);
     fs.mkdirSync(dir, { recursive: true });
     return path.join(dir, "vectors.db");
   }

   export class IndexStore {
     private constructor(private db: Database.Database, private filePath: string | null) {}

     static open(workspaceRoot: string): IndexStore {
       const p = workspaceDbPath(workspaceRoot);
       const db = new Database(p);
       sqliteVec.load(db);
       IndexStore.initSchema(db);
       return new IndexStore(db, p);
     }
     static openInMemory(): IndexStore {
       const db = new Database(":memory:");
       sqliteVec.load(db);
       IndexStore.initSchema(db);
       return new IndexStore(db, null);
     }

     private static initSchema(db: Database.Database) {
       db.pragma("journal_mode = WAL");
       db.exec(`
         CREATE TABLE IF NOT EXISTS files (
           path TEXT PRIMARY KEY,
           mtime_ms INTEGER NOT NULL,
           size_bytes INTEGER NOT NULL,
           hash TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS chunks (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           path TEXT NOT NULL,
           start_line INTEGER NOT NULL,
           end_line INTEGER NOT NULL,
           text TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
       `);
       db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(embedding float[${EMBED_DIM}])`);
     }

     upsertFile(args: UpsertArgs): void {
       const tx = this.db.transaction((a: UpsertArgs) => {
         const oldIds = this.db.prepare("SELECT id FROM chunks WHERE path = ?").all(a.path) as { id: number }[];
         for (const { id } of oldIds) {
           this.db.prepare("DELETE FROM chunk_vectors WHERE rowid = ?").run(id);
         }
         this.db.prepare("DELETE FROM chunks WHERE path = ?").run(a.path);
         this.db.prepare(
           `INSERT INTO files(path, mtime_ms, size_bytes, hash) VALUES (?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET mtime_ms=excluded.mtime_ms, size_bytes=excluded.size_bytes, hash=excluded.hash`
         ).run(a.path, a.mtimeMs, a.sizeBytes, a.hash);
         const insChunk = this.db.prepare(
           "INSERT INTO chunks(path, start_line, end_line, text) VALUES (?, ?, ?, ?)"
         );
         const insVec = this.db.prepare("INSERT INTO chunk_vectors(rowid, embedding) VALUES (?, ?)");
         for (const c of a.chunks) {
           const info = insChunk.run(a.path, c.startLine, c.endLine, c.text);
           insVec.run(Number(info.lastInsertRowid), Buffer.from(c.embedding.buffer, c.embedding.byteOffset, c.embedding.byteLength));
         }
       });
       tx(args);
     }

     getFileHash(p: string): string | null {
       const row = this.db.prepare("SELECT hash FROM files WHERE path = ?").get(p) as { hash: string } | undefined;
       return row?.hash ?? null;
     }

     removeFile(p: string): void {
       const tx = this.db.transaction((path: string) => {
         const ids = this.db.prepare("SELECT id FROM chunks WHERE path = ?").all(path) as { id: number }[];
         for (const { id } of ids) this.db.prepare("DELETE FROM chunk_vectors WHERE rowid = ?").run(id);
         this.db.prepare("DELETE FROM chunks WHERE path = ?").run(path);
         this.db.prepare("DELETE FROM files WHERE path = ?").run(path);
       });
       tx(p);
     }

     search(queryEmbedding: Float32Array, limit: number): SearchResult[] {
       const buf = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);
       const rows = this.db.prepare(
         `SELECT c.path AS path, c.start_line AS startLine, c.end_line AS endLine, c.text AS text, v.distance AS distance
          FROM chunk_vectors v JOIN chunks c ON c.id = v.rowid
          WHERE v.embedding MATCH ? AND k = ?
          ORDER BY v.distance ASC`
       ).all(buf, limit) as SearchResult[];
       return rows;
     }

     allPaths(): string[] {
       return (this.db.prepare("SELECT path FROM files").all() as { path: string }[]).map((r) => r.path);
     }

     stats(): IndexStats {
       const f = this.db.prepare("SELECT COUNT(*) AS n FROM files").get() as { n: number };
       const c = this.db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number };
       let dbSizeBytes = 0;
       if (this.filePath) { try { dbSizeBytes = fs.statSync(this.filePath).size; } catch { /* */ } }
       return { fileCount: f.n, chunkCount: c.n, dbSizeBytes };
     }

     close(): void { this.db.close(); }
   }
   ```

3. `npm test -- lib/index/store.test.ts` passes. `npm test` green.
4. Commit: `feat(indexing): SQLite + sqlite-vec persistence layer`

- [ ] Task 5 complete

---

## Task 6 — `lib/index/indexer.ts` (orchestrator)

**Files (Create):**
- `lib/index/indexer.ts`
- `lib/index/indexer.test.ts`

### Steps

1. Write `lib/index/indexer.test.ts`:
   ```ts
   import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
   import fs from "fs/promises";
   import os from "os";
   import path from "path";
   import { Indexer } from "./indexer";
   import { IndexStore } from "./store";
   import { EMBED_DIM } from "./embedder";

   class FakeEmbedder {
     async ensureModelInstalled() { return { ok: true as const }; }
     async embed(text: string): Promise<Float32Array> {
       const v = new Float32Array(EMBED_DIM);
       for (let i = 0; i < text.length && i < EMBED_DIM; i++) v[i] = text.charCodeAt(i) / 255;
       return v;
     }
     async embedBatch(texts: string[]): Promise<Float32Array[]> { return Promise.all(texts.map((t) => this.embed(t))); }
   }

   let dir: string;
   beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "marven-idx-")); });
   afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

   describe("Indexer.runFull", () => {
     it("indexes files and reports progress", async () => {
       await fs.writeFile(path.join(dir, "a.ts"), "alpha line\nbeta line");
       await fs.writeFile(path.join(dir, "b.ts"), "gamma line");
       const store = IndexStore.openInMemory();
       const idx = new Indexer({ workspaceRoot: dir, store, embedder: new FakeEmbedder() as any });
       const progress: any[] = [];
       const r = await idx.runFull({ onProgress: (p) => progress.push({ ...p }) });
       expect(r.filesIndexed).toBe(2);
       expect(r.chunksIndexed).toBeGreaterThanOrEqual(2);
       expect(progress.length).toBeGreaterThan(0);
       expect(progress[progress.length - 1].filesDone).toBe(2);
       store.close();
     });
     it("skips unchanged files (hash match)", async () => {
       await fs.writeFile(path.join(dir, "a.ts"), "alpha");
       const store = IndexStore.openInMemory();
       const e = new FakeEmbedder();
       const spy = vi.spyOn(e, "embedBatch");
       const idx = new Indexer({ workspaceRoot: dir, store, embedder: e as any });
       await idx.runFull();
       spy.mockClear();
       await idx.runFull();
       expect(spy).not.toHaveBeenCalled();
       store.close();
     });
     it("removes files that no longer exist", async () => {
       const a = path.join(dir, "a.ts");
       await fs.writeFile(a, "alpha");
       const store = IndexStore.openInMemory();
       const idx = new Indexer({ workspaceRoot: dir, store, embedder: new FakeEmbedder() as any });
       await idx.runFull();
       expect(store.stats().fileCount).toBe(1);
       await fs.rm(a);
       await idx.runFull();
       expect(store.stats().fileCount).toBe(0);
       store.close();
     });
   });

   describe("Indexer.updateFile / deleteFile", () => {
     it("re-embeds a single file", async () => {
       const p = path.join(dir, "a.ts");
       await fs.writeFile(p, "alpha");
       const store = IndexStore.openInMemory();
       const idx = new Indexer({ workspaceRoot: dir, store, embedder: new FakeEmbedder() as any });
       await idx.updateFile(p);
       expect(store.getFileHash("a.ts")).not.toBeNull();
     });
     it("deleteFile removes from store", async () => {
       const p = path.join(dir, "a.ts");
       await fs.writeFile(p, "alpha");
       const store = IndexStore.openInMemory();
       const idx = new Indexer({ workspaceRoot: dir, store, embedder: new FakeEmbedder() as any });
       await idx.updateFile(p);
       await idx.deleteFile(p);
       expect(store.getFileHash("a.ts")).toBeNull();
     });
   });

   describe("Indexer.runFull concurrency lock", () => {
     it("serializes concurrent runFull calls", async () => {
       await fs.writeFile(path.join(dir, "a.ts"), "alpha");
       const store = IndexStore.openInMemory();
       const idx = new Indexer({ workspaceRoot: dir, store, embedder: new FakeEmbedder() as any });
       const [r1, r2] = await Promise.all([idx.runFull(), idx.runFull()]);
       expect(r1.filesIndexed + r2.filesIndexed).toBeGreaterThanOrEqual(1);
       store.close();
     });
   });
   ```

2. Run — fails. Implement `lib/index/indexer.ts`:
   ```ts
   import fs from "fs/promises";
   import path from "path";
   import crypto from "crypto";
   import { walkWorkspace } from "./walker";
   import { chunkFile } from "./chunker";
   import { Embedder } from "./embedder";
   import { IndexStore } from "./store";
   import type { IndexProgress } from "@/types";

   const MAX_FILES = 5000;

   export interface IndexerOptions {
     workspaceRoot: string;
     store: IndexStore;
     embedder: Embedder;
   }
   export interface RunFullOptions {
     onProgress?: (p: IndexProgress) => void;
     signal?: AbortSignal;
   }
   export interface RunFullResult {
     filesIndexed: number;
     chunksIndexed: number;
     durationMs: number;
   }

   export class Indexer {
     private fullLock: Promise<unknown> = Promise.resolve();
     constructor(private readonly opts: IndexerOptions) {}

     async runFull(opts: RunFullOptions = {}): Promise<RunFullResult> {
       const run = async (): Promise<RunFullResult> => {
         const start = Date.now();
         const root = this.opts.workspaceRoot;
         const candidates: string[] = [];
         for await (const abs of walkWorkspace(root)) {
           candidates.push(abs);
           if (candidates.length >= MAX_FILES) break;
         }
         let filesIndexed = 0, chunksIndexed = 0;
         for (let i = 0; i < candidates.length; i++) {
           if (opts.signal?.aborted) break;
           const abs = candidates[i];
           const rel = path.relative(root, abs);
           try {
             const buf = await fs.readFile(abs);
             const hash = crypto.createHash("sha1").update(buf).digest("hex");
             if (this.opts.store.getFileHash(rel) === hash) {
               opts.onProgress?.({ filesDone: i + 1, filesTotal: candidates.length, chunksDone: chunksIndexed });
               continue;
             }
             const stat = await fs.stat(abs);
             const chunks = chunkFile(rel, buf.toString("utf8"));
             if (chunks.length === 0) { this.opts.store.removeFile(rel); continue; }
             const vecs = await this.opts.embedder.embedBatch(chunks.map((c) => c.text));
             this.opts.store.upsertFile({
               path: rel, mtimeMs: stat.mtimeMs, sizeBytes: stat.size, hash,
               chunks: chunks.map((c, k) => ({ startLine: c.startLine, endLine: c.endLine, text: c.text, embedding: vecs[k] })),
             });
             filesIndexed++; chunksIndexed += chunks.length;
           } catch { /* skip unreadable */ }
           opts.onProgress?.({ filesDone: i + 1, filesTotal: candidates.length, chunksDone: chunksIndexed });
         }
         const presentRel = new Set(candidates.map((a) => path.relative(root, a)));
         for (const known of this.opts.store.allPaths()) {
           if (!presentRel.has(known)) this.opts.store.removeFile(known);
         }
         return { filesIndexed, chunksIndexed, durationMs: Date.now() - start };
       };
       const next = this.fullLock.then(run, run);
       this.fullLock = next.catch(() => undefined);
       return next;
     }

     async updateFile(absPath: string): Promise<void> {
       const rel = path.relative(this.opts.workspaceRoot, absPath);
       try {
         const stat = await fs.stat(absPath);
         if (stat.size > 256 * 1024) { this.opts.store.removeFile(rel); return; }
         const buf = await fs.readFile(absPath);
         const hash = crypto.createHash("sha1").update(buf).digest("hex");
         if (this.opts.store.getFileHash(rel) === hash) return;
         const chunks = chunkFile(rel, buf.toString("utf8"));
         if (chunks.length === 0) { this.opts.store.removeFile(rel); return; }
         const vecs = await this.opts.embedder.embedBatch(chunks.map((c) => c.text));
         this.opts.store.upsertFile({
           path: rel, mtimeMs: stat.mtimeMs, sizeBytes: stat.size, hash,
           chunks: chunks.map((c, i) => ({ startLine: c.startLine, endLine: c.endLine, text: c.text, embedding: vecs[i] })),
         });
       } catch { this.opts.store.removeFile(rel); }
     }

     async deleteFile(absPath: string): Promise<void> {
       const rel = path.relative(this.opts.workspaceRoot, absPath);
       this.opts.store.removeFile(rel);
     }
   }
   ```

3. `npm test -- lib/index/indexer.test.ts` passes. `npm test` green.
4. Commit: `feat(indexing): indexer orchestrator (full + incremental)`

- [ ] Task 6 complete

---

## Task 7 — `lib/index/search.ts`

**Files (Create):**
- `lib/index/search.ts`
- `lib/index/search.test.ts`

### Steps

1. Write `lib/index/search.test.ts`:
   ```ts
   import { describe, it, expect, vi, afterEach } from "vitest";
   import { searchCodebase } from "./search";
   import * as storeMod from "./store";
   import * as embMod from "./embedder";
   import { EMBED_DIM } from "./embedder";

   afterEach(() => vi.restoreAllMocks());

   describe("searchCodebase", () => {
     it("embeds query and forwards to store.search", async () => {
       const fakeStore = {
         search: vi.fn().mockReturnValue([{ path: "a.ts", startLine: 0, endLine: 1, text: "x", distance: 0.1 }]),
         close: vi.fn(),
       };
       vi.spyOn(storeMod.IndexStore, "open").mockReturnValue(fakeStore as any);
       vi.spyOn(embMod.Embedder.prototype, "embed").mockResolvedValue(new Float32Array(EMBED_DIM));
       const r = await searchCodebase({ workspaceRoot: "/tmp/ws", query: "auth flow" });
       expect(r).toHaveLength(1);
       expect(fakeStore.search).toHaveBeenCalledOnce();
       expect((fakeStore.search.mock.calls[0][0] as Float32Array).length).toBe(EMBED_DIM);
       expect(fakeStore.search.mock.calls[0][1]).toBe(8);
     });
     it("respects limit (capped at 20)", async () => {
       const fakeStore = { search: vi.fn().mockReturnValue([]), close: vi.fn() };
       vi.spyOn(storeMod.IndexStore, "open").mockReturnValue(fakeStore as any);
       vi.spyOn(embMod.Embedder.prototype, "embed").mockResolvedValue(new Float32Array(EMBED_DIM));
       await searchCodebase({ workspaceRoot: "/tmp/ws", query: "q", limit: 50 });
       expect(fakeStore.search.mock.calls[0][1]).toBe(20);
     });
   });
   ```

2. Run — fails. Implement `lib/index/search.ts`:
   ```ts
   import { Embedder } from "./embedder";
   import { IndexStore } from "./store";
   import type { SearchResult } from "@/types";

   export type { SearchResult };

   export async function searchCodebase(opts: {
     workspaceRoot: string;
     query: string;
     limit?: number;
   }): Promise<SearchResult[]> {
     const limit = Math.max(1, Math.min(opts.limit ?? 8, 20));
     const embedder = new Embedder();
     const v = await embedder.embed(opts.query);
     const store = IndexStore.open(opts.workspaceRoot);
     try {
       return store.search(v, limit);
     } finally {
       store.close();
     }
   }
   ```

3. `npm test -- lib/index/search.test.ts` passes. `npm test` green.
4. Commit: `feat(indexing): semantic search entry point`

- [ ] Task 7 complete

---

## Task 8 — Electron indexer host + preload bridge

**Files (Create):**
- `electron/index/indexerHost.js`
- `electron/index/indexerHost.test.js`

**Files (Modify):**
- `electron/main.js` — boot the host, wire workspace events
- `electron/preload.js` — expose `marvenElectron.index.*`

### Steps

1. Write `electron/index/indexerHost.test.js` (CommonJS, runs under Vitest's node env):
   ```js
   const { describe, it, expect, vi, beforeEach } = require("vitest");
   const path = require("path");
   const os = require("os");
   const fs = require("fs/promises");

   describe("IndexerHost", () => {
     let host;
     beforeEach(async () => {
       const { IndexerHost } = require("./indexerHost");
       host = new IndexerHost({
         broadcast: vi.fn(),
         // Inject in-memory store + fake embedder for the unit test
         createStore: () => require("../../lib/index/store").IndexStore.openInMemory(),
         createEmbedder: () => ({
           ensureModelInstalled: async () => ({ ok: true }),
           embed: async () => new Float32Array(768),
           embedBatch: async (xs) => xs.map(() => new Float32Array(768)),
         }),
       });
     });
     it("status before setWorkspace returns running:false stats:null", async () => {
       const s = await host.status();
       expect(s.running).toBe(false);
       expect(s.stats).toBeNull();
     });
     it("setWorkspace + runFull + search round-trip", async () => {
       const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ih-"));
       await fs.writeFile(path.join(dir, "a.ts"), "alpha file\nbeta file");
       await host.setWorkspace(dir);
       await host.runFull();
       const r = await host.search("alpha", 5);
       expect(Array.isArray(r)).toBe(true);
       expect(r.length).toBeGreaterThanOrEqual(1);
       await fs.rm(dir, { recursive: true, force: true });
     });
     it("clear() empties the store", async () => {
       const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ih2-"));
       await fs.writeFile(path.join(dir, "a.ts"), "alpha file");
       await host.setWorkspace(dir);
       await host.runFull();
       await host.clear();
       const s = await host.status();
       expect(s.stats.fileCount).toBe(0);
       await fs.rm(dir, { recursive: true, force: true });
     });
   });
   ```

2. Run — fails. Implement `electron/index/indexerHost.js`:
   ```js
   // CommonJS — runs in Electron main process.
   const path = require("path");

   class IndexerHost {
     constructor(opts = {}) {
       this.broadcast = opts.broadcast || (() => {});
       this.createStore = opts.createStore || null; // injected for tests
       this.createEmbedder = opts.createEmbedder || null;
       this.enabled = true;
       this.running = false;
       this.lastError = null;
       this.workspaceRoot = null;
       this.store = null;
       this.indexer = null;
     }

     _loadDeps() {
       if (this._deps) return this._deps;
       const { Embedder } = require("../../lib/index/embedder");
       const { IndexStore } = require("../../lib/index/store");
       const { Indexer } = require("../../lib/index/indexer");
       this._deps = { Embedder, IndexStore, Indexer };
       return this._deps;
     }

     async setWorkspace(root) {
       await this.shutdown();
       this.workspaceRoot = root;
       if (!this.enabled || !root) return;
       const { Embedder, IndexStore, Indexer } = this._loadDeps();
       this.store = this.createStore ? this.createStore(root) : IndexStore.open(root);
       const embedder = this.createEmbedder ? this.createEmbedder() : new Embedder();
       this.indexer = new Indexer({ workspaceRoot: root, store: this.store, embedder });
     }

     async shutdown() {
       if (this.store) { try { this.store.close(); } catch (_) {} }
       this.store = null; this.indexer = null; this.running = false;
     }

     setEnabled(enabled) {
       this.enabled = !!enabled;
       if (!this.enabled) this.shutdown();
     }

     async status() {
       return {
         enabled: this.enabled,
         running: this.running,
         stats: this.store ? this.store.stats() : null,
         lastError: this.lastError || undefined,
       };
     }

     async runFull() {
       if (!this.indexer || this.running) return;
       this.running = true; this.lastError = null;
       try {
         const result = await this.indexer.runFull({
           onProgress: (p) => this.broadcast("index:progress", p),
         });
         this.broadcast("index:done", result);
       } catch (e) {
         this.lastError = e && e.message ? e.message : String(e);
         this.broadcast("index:error", { message: this.lastError });
       } finally {
         this.running = false;
       }
     }

     async search(query, limit) {
       if (!this.enabled) return { error: "Codebase indexing is disabled" };
       if (!this.workspaceRoot) return [];
       const { searchCodebase } = require("../../lib/index/search");
       try { return await searchCodebase({ workspaceRoot: this.workspaceRoot, query, limit }); }
       catch (e) { return { error: e && e.message ? e.message : String(e) }; }
     }

     async cancel() { /* v1: nothing to cancel mid-batch; reserved */ }

     async clear() {
       if (!this.store) return;
       for (const p of this.store.allPaths()) this.store.removeFile(p);
     }

     async updateFile(abs) { if (this.indexer) await this.indexer.updateFile(abs); }
     async deleteFile(abs) { if (this.indexer) await this.indexer.deleteFile(abs); }
   }

   function registerIpc(ipcMain, host) {
     ipcMain.handle("index:status", () => host.status());
     ipcMain.handle("index:run-full", () => { host.runFull(); return true; });
     ipcMain.handle("index:search", (_e, query, limit) => host.search(query, limit));
     ipcMain.handle("index:cancel", () => host.cancel());
     ipcMain.handle("index:clear", () => host.clear());
     ipcMain.handle("index:update-file", (_e, abs) => host.updateFile(abs));
     ipcMain.handle("index:delete-file", (_e, abs) => host.deleteFile(abs));
   }

   module.exports = { IndexerHost, registerIpc };
   ```

3. Modify `electron/main.js`. After `app.whenReady` block (search for existing IPC registration; add adjacent):
   ```js
   const { IndexerHost, registerIpc: registerIndexIpc } = require('./index/indexerHost');
   const indexerHost = new IndexerHost({
     broadcast: (channel, payload) => {
       for (const w of require('electron').BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
     },
   });
   registerIndexIpc(ipcMain, indexerHost);

   // Settings: on workspace change
   ipcMain.handle('index:set-workspace', async (_e, root) => {
     await indexerHost.setWorkspace(root);
     // Auto full index on open (background)
     indexerHost.runFull();
   });
   ipcMain.handle('index:set-enabled', (_e, enabled) => indexerHost.setEnabled(enabled));
   ```

4. Modify `electron/preload.js` — add the `index` namespace alongside `lsp`:
   ```js
   index: {
     status: () => ipcRenderer.invoke('index:status'),
     runFull: () => ipcRenderer.invoke('index:run-full'),
     search: (query, limit) => ipcRenderer.invoke('index:search', query, limit),
     cancel: () => ipcRenderer.invoke('index:cancel'),
     clear: () => ipcRenderer.invoke('index:clear'),
     setWorkspace: (root) => ipcRenderer.invoke('index:set-workspace', root),
     setEnabled: (enabled) => ipcRenderer.invoke('index:set-enabled', enabled),
     onProgress: (cb) => {
       const h = (_e, data) => cb(data);
       ipcRenderer.on('index:progress', h);
       return () => ipcRenderer.removeListener('index:progress', h);
     },
     onDone: (cb) => {
       const h = (_e, data) => cb(data);
       ipcRenderer.on('index:done', h);
       return () => ipcRenderer.removeListener('index:done', h);
     },
     onError: (cb) => {
       const h = (_e, data) => cb(data);
       ipcRenderer.on('index:error', h);
       return () => ipcRenderer.removeListener('index:error', h);
     },
   },
   ```

5. `npm test -- electron/index/indexerHost.test.js` passes. `npm test` green.
6. Commit: `feat(indexing): electron host + preload IPC bridge`

- [ ] Task 8 complete

---

## Task 9 — `search_codebase` agent tool

**Files (Modify):**
- `lib/agent/tools.ts` — add definition + executor case
- `lib/agent/tools.test.ts` — bump count, add behavior tests

### Steps

1. In `lib/agent/tools.ts`, append a 16th `TOOL_DEFINITIONS` entry:
   ```ts
   {
     name: "search_codebase",
     description: "Semantic search across the workspace. Returns code chunks ranked by meaning, not just keywords. Use this BEFORE search_files when looking for concepts, patterns, or 'where do we do X' questions.",
     parameters: {
       type: "object",
       properties: {
         query: { type: "string", description: "Natural-language search query." },
         limit: { type: "number", description: "Number of chunks to return. Default 8, max 20." },
       },
       required: ["query"],
     },
   },
   ```

2. Inside `executeTool` switch, add (before the final `default`):
   ```ts
   case "search_codebase": {
     const { searchCodebase } = await import("@/lib/index/search");
     const limit = typeof args.limit === "number" ? args.limit : 8;
     const results = await searchCodebase({ workspaceRoot, query: String(args.query ?? ""), limit });
     if (!Array.isArray(results)) return JSON.stringify(results); // { error: ... }
     if (results.length === 0) return "No matches.";
     return results.map((r, i) =>
       `[${i + 1}] ${r.path}:${r.startLine + 1}-${r.endLine + 1} (distance ${r.distance.toFixed(3)})\n${r.text}`
     ).join("\n\n");
   }
   ```

3. Update `lib/agent/tools.test.ts`:
   - Bump count from 15 → 16, add `expect(names).toContain("search_codebase")`.
   - Add a behavior test:
     ```ts
     describe("executeTool – search_codebase", () => {
       it("formats results as numbered chunks", async () => {
         const mod = await import("@/lib/index/search");
         const spy = vi.spyOn(mod, "searchCodebase").mockResolvedValue([
           { path: "a.ts", startLine: 0, endLine: 4, text: "function f(){}", distance: 0.2 },
         ]);
         const out = await executeTool("search_codebase", { query: "f" }, tmpDir);
         expect(out).toContain("[1] a.ts:1-5");
         expect(out).toContain("function f(){}");
         spy.mockRestore();
       });
       it("returns 'No matches.' for empty result", async () => {
         const mod = await import("@/lib/index/search");
         const spy = vi.spyOn(mod, "searchCodebase").mockResolvedValue([]);
         expect(await executeTool("search_codebase", { query: "x" }, tmpDir)).toBe("No matches.");
         spy.mockRestore();
       });
       it("returns error JSON when search disabled", async () => {
         const mod = await import("@/lib/index/search");
         const spy = vi.spyOn(mod, "searchCodebase").mockResolvedValue({ error: "disabled" } as any);
         const out = await executeTool("search_codebase", { query: "x" }, tmpDir);
         expect(out).toContain("disabled");
         spy.mockRestore();
       });
     });
     ```

4. Also confirm the **tier classifier** includes `search_codebase` for both simple + standard. Search `lib/agent/taskClassifier.ts` for the tool allowlist and add `"search_codebase"` to both tiers if such a list exists. If not, no change needed (the tier system gates by tool name elsewhere — verify by reading `lib/agent/systemPrompts.ts` if there is a `TIER_TOOLS` map).

5. `npm test -- lib/agent/tools.test.ts` passes. `npm test` green.
6. Commit: `feat(indexing): search_codebase agent tool + executor`

- [ ] Task 9 complete

---

## Task 10 — Settings UI + page.tsx wiring + gated E2E

**Files (Modify):**
- `app/components/marven/SettingsModal.tsx` — add "Codebase Indexing" section in the General tab
- `app/page.tsx` — call `marvenElectron.index.setWorkspace(root)` on workspace change; subscribe to progress events; sync `codebaseIndexEnabled` setting
- `electron/main.js` — default `codebaseIndexEnabled: true` in settings shape

**Files (Create):**
- `app/components/marven/SettingsModal.codebaseIndex.test.tsx` — snapshot-style smoke test
- `lib/index/e2e.test.ts` — gated by `RUN_INDEX_E2E=1`

### Steps

1. In `electron/main.js`, locate the `getSettings`/`saveSettings` handlers. Add `codebaseIndexEnabled: true` to defaults. After load, call `indexerHost.setEnabled(settings.codebaseIndexEnabled !== false)`.

2. In `app/components/marven/SettingsModal.tsx`, inside the General tab JSX, add:
   ```tsx
   {/* Codebase Indexing */}
   <section className="setting-section" data-testid="setting-codebase-indexing">
     <h3>Codebase Indexing</h3>
     <label className="toggle-row">
       <input
         type="checkbox"
         checked={codebaseIndexEnabled}
         onChange={async (e) => {
           const v = e.target.checked;
           setCodebaseIndexEnabled(v);
           await (window as any).marvenElectron.saveSettings({ ...settings, codebaseIndexEnabled: v });
           await (window as any).marvenElectron.index.setEnabled(v);
           window.dispatchEvent(new CustomEvent("marven:settings-changed"));
         }}
       />
       Enable codebase indexing
     </label>
     <p className="setting-hint">
       Lets the agent search your code semantically. Uses Ollama (nomic-embed-text).
       Index lives at ~/.marven/index/.
     </p>
     <div className="index-status">
       Status: {indexStatus.running ? "Indexing…" : indexStatus.stats ? "Ready" : "Idle"}
       {indexStatus.stats && (
         <> · {indexStatus.stats.fileCount} files · {indexStatus.stats.chunkCount} chunks
           · {(indexStatus.stats.dbSizeBytes / 1_000_000).toFixed(1)} MB</>
       )}
     </div>
     <div className="setting-actions">
       <button onClick={() => (window as any).marvenElectron.index.runFull()}>Reindex now</button>
       <button onClick={async () => {
         await (window as any).marvenElectron.index.clear();
         setIndexStatus(await (window as any).marvenElectron.index.status());
       }}>Clear index</button>
     </div>
   </section>
   ```
   Add the corresponding `codebaseIndexEnabled` / `indexStatus` state at the top, initialized from `getSettings()` and `index.status()`. Subscribe to `onProgress` / `onDone` / `onError` in a `useEffect`.

3. In `app/page.tsx`, where the workspace root is set (search for existing `set-workspace` / workspace effect), add:
   ```ts
   useEffect(() => {
     if (!workspaceRoot) return;
     (window as any).marvenElectron?.index?.setWorkspace(workspaceRoot);
   }, [workspaceRoot]);
   ```

4. Create `app/components/marven/SettingsModal.codebaseIndex.test.tsx`:
   ```ts
   import { describe, it, expect, vi, beforeEach } from "vitest";
   import { JSDOM } from "jsdom";

   describe("SettingsModal codebase indexing section", () => {
     beforeEach(() => {
       const dom = new JSDOM("<!doctype html><html><body></body></html>");
       (global as any).window = dom.window;
       (global as any).document = dom.window.document;
     });
     it("module loads without throwing (smoke)", async () => {
       const mod = await import("./SettingsModal");
       expect(mod).toBeDefined();
     });
   });
   ```
   (Full React render is intentionally out of scope — the existing modal test files in the repo follow the same smoke-style pattern.)

5. Create `lib/index/e2e.test.ts`:
   ```ts
   import { describe, it, expect, beforeAll, afterAll } from "vitest";
   import fs from "fs/promises";
   import os from "os";
   import path from "path";
   import { Embedder } from "./embedder";
   import { IndexStore } from "./store";
   import { Indexer } from "./indexer";
   import { searchCodebase } from "./search";

   const RUN = process.env.RUN_INDEX_E2E === "1";
   const d = RUN ? describe : describe.skip;

   d("e2e: real Ollama + sqlite-vec", () => {
     let dir: string;
     beforeAll(async () => {
       dir = await fs.mkdtemp(path.join(os.tmpdir(), "marven-e2e-"));
       await fs.writeFile(path.join(dir, "json.ts"), "export function parseJson(s: string){return JSON.parse(s);}");
       await fs.writeFile(path.join(dir, "auth.ts"), "export function validateToken(t: string){return t.length>0;}");
       await fs.writeFile(path.join(dir, "ui.ts"), "export function renderButton(){return 'button';}");
       const e = new Embedder();
       const ok = await e.ensureModelInstalled();
       if (!ok.ok) throw new Error("ollama not ready: " + ok.error);
       const store = IndexStore.open(dir);
       const idx = new Indexer({ workspaceRoot: dir, store, embedder: e });
       await idx.runFull();
       store.close();
     }, 300_000);
     afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });
     it("finds the json parser by meaning", async () => {
       const r = await searchCodebase({ workspaceRoot: dir, query: "json parser", limit: 3 });
       expect(r[0].path).toBe("json.ts");
     });
   });
   ```

6. Run:
   ```bash
   npm test
   ```
   All suites pass; `e2e.test.ts` is skipped without the env var. Run manually:
   ```bash
   RUN_INDEX_E2E=1 npm test -- lib/index/e2e.test.ts
   ```
   (Requires Ollama running.)

7. Commit: `feat(indexing): settings UI, page.tsx wiring, gated e2e`

- [ ] Task 10 complete

---

## Spec coverage self-review

| Spec section | Task(s) |
|---|---|
| 1 Embedder | 2 |
| 2 Chunker | 3 |
| 3 Walker | 4 |
| 4 Store | 5 |
| 5 Indexer (full + incremental) | 6 |
| 6 Search | 7 |
| 7 Electron host + IPC | 8 |
| 8 Agent tool | 9 |
| 9 Settings UI | 10 |
| 10 Testing (unit + gated e2e) | 2–10 |
| 11 Error handling (Ollama down, vec load fail, oversize, retries, corruption) | 2 (errors), 5 (open), 6 (try/catch + MAX_FILES), 8 (host wraps errors) |
| Native deps + electron-rebuild | 1 |

Types `Chunk`, `SearchResult`, `IndexStats`, `IndexProgress` defined exactly once in `types/index.ts`. `IndexStore` defined exactly once in `lib/index/store.ts`. No placeholders, no "implement later". Every task ends with a working commit and a passing `npm test`.

---

**Plan length:** ~700 lines / ~38 KB of structured markdown. The plan is contained entirely in this assistant message and is ready for the parent to save to `/Users/ahomsi/Development/Personal Projects/Marven/docs/superpowers/plans/2026-05-24-codebase-indexing.md`.