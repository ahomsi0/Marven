import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  ConversationStore,
  __resetConversationStoreForTests,
} from "./serverConversationStore";

describe("ConversationStore (SQLite)", () => {
  let dbPath: string;
  let store: ConversationStore;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "marven-convstore-"));
    dbPath = path.join(dir, "conversations.db");
    store = new ConversationStore(dbPath);
  });

  afterEach(async () => {
    __resetConversationStoreForTests();
    try {
      store.close();
    } catch {
      // already closed
    }
    await fs.rm(path.dirname(dbPath), { recursive: true, force: true });
  });

  const conv = (id: string, updatedAt = "2026-01-01T00:00:00Z", extra = {}) => ({
    id,
    updatedAt,
    name: `conv ${id}`,
    messages: [],
    ...extra,
  });

  it("round-trips conversations preserving array order", () => {
    store.replaceAll([conv("a"), conv("b"), conv("c")]);
    expect(store.listAll().map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(store.count()).toBe(3);
  });

  it("keeps an updated conversation's original position", () => {
    store.replaceAll([conv("a"), conv("b"), conv("c")]);
    store.replaceAll([conv("a"), conv("b", "2026-02-02T00:00:00Z", { name: "conv b v2" }), conv("c")]);
    const list = store.listAll();
    expect(list.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(list[1].name).toBe("conv b v2");
    expect(list[1].updatedAt).toBe("2026-02-02T00:00:00Z");
  });

  it("propagates deletions (ids absent from the payload are removed)", () => {
    store.replaceAll([conv("a"), conv("b")]);
    store.replaceAll([conv("b")]);
    expect(store.listAll().map((c) => c.id)).toEqual(["b"]);
    expect(store.count()).toBe(1);
  });

  it("appends newly seen conversations after existing ones", () => {
    store.replaceAll([conv("a")]);
    store.replaceAll([conv("a"), conv("new")]);
    expect(store.listAll().map((c) => c.id)).toEqual(["a", "new"]);
  });

  it("preserves heavy payloads like base64 attachments verbatim", () => {
    const bigAttachment = "data:image/png;base64," + "A".repeat(300_000); // far past localStorage quota
    store.replaceAll([
      conv("img", "2026-01-01T00:00:00Z", {
        messages: [{ id: "m1", role: "user", content: "pic", attachments: [{ base64: bigAttachment }] }],
      }),
    ]);
    const loaded = store.listAll()[0];
    expect((loaded.messages as Array<{ attachments: Array<{ base64: string }> }>)[0].attachments[0].base64)
      .toBe(bigAttachment);
  });

  it("skips corrupt rows instead of failing the listing", async () => {
    store.replaceAll([conv("good")]);
    // Corrupt the row directly through a second handle.
    const { default: Database } = await import("better-sqlite3");
    const raw = new Database(dbPath);
    raw.prepare("UPDATE conversations SET data = '{not json' WHERE id = 'good'").run();
    raw.close();

    const second = new ConversationStore(dbPath);
    expect(second.listAll()).toEqual([]);
    second.close();
  });

  it("ignores malformed docs in the incoming payload", () => {
    store.replaceAll([
      conv("ok"),
      null as unknown as { id: string },
      { nope: true } as unknown as { id: string },
      conv("fine"),
    ]);
    expect(store.listAll().map((c) => c.id)).toEqual(["ok", "fine"]);
  });
});
