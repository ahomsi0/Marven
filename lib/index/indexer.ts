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
      let filesIndexed = 0,
        chunksIndexed = 0;
      for (let i = 0; i < candidates.length; i++) {
        if (opts.signal?.aborted) break;
        const abs = candidates[i];
        const rel = path.relative(root, abs);
        try {
          const buf = await fs.readFile(abs);
          const hash = crypto.createHash("sha1").update(buf).digest("hex");
          if (this.opts.store.getFileHash(rel) === hash) {
            opts.onProgress?.({
              filesDone: i + 1,
              filesTotal: candidates.length,
              chunksDone: chunksIndexed,
            });
            continue;
          }
          const stat = await fs.stat(abs);
          const chunks = chunkFile(rel, buf.toString("utf8"));
          if (chunks.length === 0) {
            this.opts.store.removeFile(rel);
            continue;
          }
          const vecs = await this.opts.embedder.embedBatch(chunks.map((c) => c.text));
          this.opts.store.upsertFile({
            path: rel,
            mtimeMs: stat.mtimeMs,
            sizeBytes: stat.size,
            hash,
            chunks: chunks.map((c, k) => ({
              startLine: c.startLine,
              endLine: c.endLine,
              text: c.text,
              embedding: vecs[k],
            })),
          });
          filesIndexed++;
          chunksIndexed += chunks.length;
        } catch {
          /* skip unreadable */
        }
        opts.onProgress?.({
          filesDone: i + 1,
          filesTotal: candidates.length,
          chunksDone: chunksIndexed,
        });
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
      if (stat.size > 256 * 1024) {
        this.opts.store.removeFile(rel);
        return;
      }
      const buf = await fs.readFile(absPath);
      const hash = crypto.createHash("sha1").update(buf).digest("hex");
      if (this.opts.store.getFileHash(rel) === hash) return;
      const chunks = chunkFile(rel, buf.toString("utf8"));
      if (chunks.length === 0) {
        this.opts.store.removeFile(rel);
        return;
      }
      const vecs = await this.opts.embedder.embedBatch(chunks.map((c) => c.text));
      this.opts.store.upsertFile({
        path: rel,
        mtimeMs: stat.mtimeMs,
        sizeBytes: stat.size,
        hash,
        chunks: chunks.map((c, i) => ({
          startLine: c.startLine,
          endLine: c.endLine,
          text: c.text,
          embedding: vecs[i],
        })),
      });
    } catch {
      this.opts.store.removeFile(rel);
    }
  }

  async deleteFile(absPath: string): Promise<void> {
    const rel = path.relative(this.opts.workspaceRoot, absPath);
    this.opts.store.removeFile(rel);
  }
}
