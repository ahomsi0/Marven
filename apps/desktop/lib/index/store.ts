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
  private constructor(
    private db: Database.Database,
    private filePath: string | null,
  ) {}

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
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(embedding float[${EMBED_DIM}])`,
    );
  }

  upsertFile(args: UpsertArgs): void {
    const tx = this.db.transaction((a: UpsertArgs) => {
      const oldIds = this.db
        .prepare("SELECT id FROM chunks WHERE path = ?")
        .all(a.path) as { id: number }[];
      const delVec = this.db.prepare("DELETE FROM chunk_vectors WHERE rowid = ?");
      for (const { id } of oldIds) delVec.run(BigInt(id));
      this.db.prepare("DELETE FROM chunks WHERE path = ?").run(a.path);
      this.db
        .prepare(
          `INSERT INTO files(path, mtime_ms, size_bytes, hash) VALUES (?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET mtime_ms=excluded.mtime_ms, size_bytes=excluded.size_bytes, hash=excluded.hash`,
        )
        .run(a.path, a.mtimeMs, a.sizeBytes, a.hash);
      const insChunk = this.db.prepare(
        "INSERT INTO chunks(path, start_line, end_line, text) VALUES (?, ?, ?, ?)",
      );
      const insVec = this.db.prepare(
        "INSERT INTO chunk_vectors(rowid, embedding) VALUES (?, ?)",
      );
      for (const c of a.chunks) {
        const info = insChunk.run(a.path, c.startLine, c.endLine, c.text);
        insVec.run(
          BigInt(info.lastInsertRowid as number | bigint),
          Buffer.from(c.embedding.buffer, c.embedding.byteOffset, c.embedding.byteLength),
        );
      }
    });
    tx(args);
  }

  getFileHash(p: string): string | null {
    const row = this.db.prepare("SELECT hash FROM files WHERE path = ?").get(p) as
      | { hash: string }
      | undefined;
    return row?.hash ?? null;
  }

  removeFile(p: string): void {
    const tx = this.db.transaction((pp: string) => {
      const ids = this.db.prepare("SELECT id FROM chunks WHERE path = ?").all(pp) as {
        id: number;
      }[];
      const delVec = this.db.prepare("DELETE FROM chunk_vectors WHERE rowid = ?");
      for (const { id } of ids) delVec.run(BigInt(id));
      this.db.prepare("DELETE FROM chunks WHERE path = ?").run(pp);
      this.db.prepare("DELETE FROM files WHERE path = ?").run(pp);
    });
    tx(p);
  }

  search(queryEmbedding: Float32Array, limit: number): SearchResult[] {
    const buf = Buffer.from(
      queryEmbedding.buffer,
      queryEmbedding.byteOffset,
      queryEmbedding.byteLength,
    );
    const rows = this.db
      .prepare(
        `SELECT c.path AS path, c.start_line AS startLine, c.end_line AS endLine, c.text AS text, v.distance AS distance
         FROM chunk_vectors v JOIN chunks c ON c.id = v.rowid
         WHERE v.embedding MATCH ? AND k = ?
         ORDER BY v.distance ASC`,
      )
      .all(buf, limit) as SearchResult[];
    return rows;
  }

  allPaths(): string[] {
    return (this.db.prepare("SELECT path FROM files").all() as { path: string }[]).map(
      (r) => r.path,
    );
  }

  stats(): IndexStats {
    const f = this.db.prepare("SELECT COUNT(*) AS n FROM files").get() as { n: number };
    const c = this.db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number };
    let dbSizeBytes = 0;
    if (this.filePath) {
      try {
        dbSizeBytes = fs.statSync(this.filePath).size;
      } catch {
        /* */
      }
    }
    return { fileCount: f.n, chunkCount: c.n, dbSizeBytes };
  }

  close(): void {
    this.db.close();
  }
}
