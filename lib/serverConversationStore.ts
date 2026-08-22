// Server-side conversation persistence backed by SQLite (better-sqlite3).
//
// Conversations used to live exclusively in localStorage, which has a ~5MB
// quota — large threads with image attachments hit it and triggered
// data-loss-avoidance trimming. The desktop app already ships better-sqlite3
// for the semantic index, so conversations get a real database:
//
//   - Electron production: $MARVEN_USER_DATA/conversations.db (userData dir)
//   - Plain dev/server:    ~/.marven/conversations.db
//
// Documents are stored as JSON keyed by conversation id with an explicit seq
// column so the client's array order survives round-trips (INSERT OR REPLACE
// would otherwise reshuffle rowids). The connection is globalThis-backed so
// HMR / route-bundle splitting can't open duplicate handles on the same file.

import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

export interface ConversationDoc {
  id: string;
  [key: string]: unknown;
}

export function conversationDbPath(): string {
  const base = process.env.MARVEN_USER_DATA
    ? process.env.MARVEN_USER_DATA
    : path.join(os.homedir(), ".marven");
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, "conversations.db");
}

export class ConversationStore {
  private db: Database.Database;
  private nextSeqStmt: Database.Statement;
  private seqOfStmt: Database.Statement;
  private upsertStmt: Database.Statement;
  private removeStmt: Database.Statement;
  private listStmt: Database.Statement;
  private countStmt: Database.Statement;
  private allIdsStmt: Database.Statement;

  constructor(dbPath = conversationDbPath()) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_seq ON conversations(seq);
    `);
    this.nextSeqStmt = this.db.prepare(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM conversations",
    );
    this.seqOfStmt = this.db.prepare("SELECT seq FROM conversations WHERE id = ?");
    this.upsertStmt = this.db.prepare(
      `INSERT INTO conversations (id, seq, updated_at, data)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data`,
    );
    this.removeStmt = this.db.prepare("DELETE FROM conversations WHERE id = ?");
    this.listStmt = this.db.prepare("SELECT data FROM conversations ORDER BY seq ASC");
    this.countStmt = this.db.prepare("SELECT COUNT(*) AS c FROM conversations");
    this.allIdsStmt = this.db.prepare("SELECT id FROM conversations");
  }

  listAll(): ConversationDoc[] {
    const rows = this.listStmt.all() as Array<{ data: string }>;
    return rows.flatMap(({ data }) => {
      try {
        const parsed = JSON.parse(data) as ConversationDoc;
        return parsed && typeof parsed === "object" && typeof parsed.id === "string"
          ? [parsed]
          : [];
      } catch {
        // Skip corrupt rows rather than failing the whole listing.
        return [];
      }
    });
  }

  /**
   * Full sync: upsert every conversation (first-seen order preserved via the
   * seq column; updates keep their original position), then remove rows whose
   * ids are absent from the payload so deletions propagate.
   */
  replaceAll(convs: ConversationDoc[]): void {
    const tx = this.db.transaction((docs: ConversationDoc[]) => {
      for (const doc of docs) {
        if (!doc || typeof doc.id !== "string" || !doc.id) continue;
        const updatedAt =
          typeof doc.updatedAt === "string" && doc.updatedAt
            ? doc.updatedAt
            : new Date().toISOString();
        const existing = this.seqOfStmt.get(doc.id) as { seq: number } | undefined;
        const seq = existing?.seq ?? (this.nextSeqStmt.get() as { s: number }).s;
        this.upsertStmt.run(doc.id, seq, updatedAt, JSON.stringify(doc));
      }
      // Deletion sync: anything not in the incoming payload is gone.
      const keep = new Set(
        docs.map((d) => d?.id).filter((id): id is string => typeof id === "string"),
      );
      for (const row of this.allIdsStmt.all() as Array<{ id: string }>) {
        if (!keep.has(row.id)) this.removeStmt.run(row.id);
      }
    });
    tx(convs);
  }

  count(): number {
    return (this.countStmt.get() as { c: number }).c;
  }

  close(): void {
    this.db.close();
  }
}

/** Get (or lazily create) the process-wide store instance. */
export function getConversationStore(): ConversationStore {
  const g = globalThis as typeof globalThis & { __marvenConversationStore?: ConversationStore };
  if (!g.__marvenConversationStore) {
    g.__marvenConversationStore = new ConversationStore();
  }
  return g.__marvenConversationStore;
}

/** Test-only: close and forget the singleton. */
export function __resetConversationStoreForTests(): void {
  const g = globalThis as typeof globalThis & { __marvenConversationStore?: ConversationStore };
  try {
    g.__marvenConversationStore?.close();
  } catch {
    // ignore
  }
  g.__marvenConversationStore = undefined;
}
