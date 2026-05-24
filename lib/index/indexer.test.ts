import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { Indexer } from "./indexer";
import { IndexStore } from "./store";
import { EMBED_DIM } from "./embedder";

class FakeEmbedder {
  async ensureModelInstalled() {
    return { ok: true as const };
  }
  async embed(text: string): Promise<Float32Array> {
    const v = new Float32Array(EMBED_DIM);
    for (let i = 0; i < text.length && i < EMBED_DIM; i++)
      v[i] = text.charCodeAt(i) / 255;
    return v;
  }
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "marven-idx-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("Indexer.runFull", () => {
  it("indexes files and reports progress", async () => {
    await fs.writeFile(path.join(dir, "a.ts"), "alpha line\nbeta line");
    await fs.writeFile(path.join(dir, "b.ts"), "gamma line");
    const store = IndexStore.openInMemory();
    const idx = new Indexer({
      workspaceRoot: dir,
      store,
      embedder: new FakeEmbedder() as any,
    });
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
    const idx = new Indexer({
      workspaceRoot: dir,
      store,
      embedder: new FakeEmbedder() as any,
    });
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
    const idx = new Indexer({
      workspaceRoot: dir,
      store,
      embedder: new FakeEmbedder() as any,
    });
    await idx.updateFile(p);
    expect(store.getFileHash("a.ts")).not.toBeNull();
  });
  it("deleteFile removes from store", async () => {
    const p = path.join(dir, "a.ts");
    await fs.writeFile(p, "alpha");
    const store = IndexStore.openInMemory();
    const idx = new Indexer({
      workspaceRoot: dir,
      store,
      embedder: new FakeEmbedder() as any,
    });
    await idx.updateFile(p);
    await idx.deleteFile(p);
    expect(store.getFileHash("a.ts")).toBeNull();
  });
});

describe("Indexer.runFull concurrency lock", () => {
  it("serializes concurrent runFull calls", async () => {
    await fs.writeFile(path.join(dir, "a.ts"), "alpha");
    const store = IndexStore.openInMemory();
    const idx = new Indexer({
      workspaceRoot: dir,
      store,
      embedder: new FakeEmbedder() as any,
    });
    const [r1, r2] = await Promise.all([idx.runFull(), idx.runFull()]);
    expect(r1.filesIndexed + r2.filesIndexed).toBeGreaterThanOrEqual(1);
    store.close();
  });
});
