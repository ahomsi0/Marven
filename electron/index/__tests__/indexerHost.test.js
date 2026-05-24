import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

describe("IndexerHost", () => {
  let host;
  beforeEach(async () => {
    const { IndexerHost } = require("../indexerHost");
    const { IndexStore } = await import("../../../lib/index/store");
    const { Indexer } = await import("../../../lib/index/indexer");
    host = new IndexerHost({
      broadcast: vi.fn(),
      createStore: () => IndexStore.openInMemory(),
      createEmbedder: () => ({
        ensureModelInstalled: async () => ({ ok: true }),
        embed: async () => {
          const v = new Float32Array(768);
          v[0] = 1;
          return v;
        },
        embedBatch: async (xs) =>
          xs.map((t) => {
            const v = new Float32Array(768);
            for (let i = 0; i < t.length && i < 768; i++) v[i] = t.charCodeAt(i) / 255;
            return v;
          }),
      }),
      createIndexer: (opts) => new Indexer(opts),
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
