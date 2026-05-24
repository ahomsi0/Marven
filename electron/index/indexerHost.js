// CommonJS — runs in Electron main process.
// Requires lib/index/* TypeScript modules at runtime via a CJS-friendly dynamic
// import in tests (Vitest transpiles via esbuild). In production Electron, the
// TS sources will have been compiled to JS as part of the Next.js build, OR
// loaded directly via ts-node/electron-reload. For v1 we keep the require()
// paths and rely on the existing build pipeline.

class IndexerHost {
  constructor(opts = {}) {
    this.broadcast = opts.broadcast || (() => {});
    this.createStore = opts.createStore || null;
    this.createEmbedder = opts.createEmbedder || null;
    this.createIndexer = opts.createIndexer || null;
    this.enabled = true;
    this.running = false;
    this.lastError = null;
    this.workspaceRoot = null;
    this.store = null;
    this.indexer = null;
  }

  async _loadDeps() {
    if (this._deps) return this._deps;
    const [embMod, storeMod, idxMod] = await Promise.all([
      import("../../lib/index/embedder"),
      import("../../lib/index/store"),
      import("../../lib/index/indexer"),
    ]);
    this._deps = {
      Embedder: embMod.Embedder,
      IndexStore: storeMod.IndexStore,
      Indexer: idxMod.Indexer,
    };
    return this._deps;
  }

  async setWorkspace(root) {
    await this.shutdown();
    this.workspaceRoot = root;
    if (!this.enabled || !root) return;
    if (this.createStore && this.createEmbedder && this.createIndexer) {
      // Fully injected (tests).
      this.store = this.createStore(root);
      const embedder = this.createEmbedder();
      this.indexer = this.createIndexer({
        workspaceRoot: root,
        store: this.store,
        embedder,
      });
      return;
    }
    const { Embedder, IndexStore, Indexer } = await this._loadDeps();
    this.store = IndexStore.open(root);
    const embedder = new Embedder();
    this.indexer = new Indexer({ workspaceRoot: root, store: this.store, embedder });
  }

  async shutdown() {
    if (this.store) {
      try {
        this.store.close();
      } catch (_) {
        /* ignore */
      }
    }
    this.store = null;
    this.indexer = null;
    this.running = false;
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
    this.running = true;
    this.lastError = null;
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
    if (!this.workspaceRoot || !this.store) return [];
    const cap = Math.max(1, Math.min(limit ?? 8, 20));
    try {
      let embedder;
      if (this.createEmbedder) {
        embedder = this.createEmbedder();
      } else {
        const { Embedder } = await this._loadDeps();
        embedder = new Embedder();
      }
      const v = await embedder.embed(String(query ?? ""));
      return this.store.search(v, cap);
    } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    }
  }

  async cancel() {
    /* v1: reserved */
  }

  async clear() {
    if (!this.store) return;
    for (const p of this.store.allPaths()) this.store.removeFile(p);
  }

  async updateFile(abs) {
    if (this.indexer) await this.indexer.updateFile(abs);
  }
  async deleteFile(abs) {
    if (this.indexer) await this.indexer.deleteFile(abs);
  }
}

function registerIpc(ipcMain, host) {
  ipcMain.handle("index:status", () => host.status());
  ipcMain.handle("index:run-full", () => {
    host.runFull();
    return true;
  });
  ipcMain.handle("index:search", (_e, query, limit) => host.search(query, limit));
  ipcMain.handle("index:cancel", () => host.cancel());
  ipcMain.handle("index:clear", () => host.clear());
  ipcMain.handle("index:update-file", (_e, abs) => host.updateFile(abs));
  ipcMain.handle("index:delete-file", (_e, abs) => host.deleteFile(abs));
  ipcMain.handle("index:set-workspace", async (_e, root) => {
    await host.setWorkspace(root);
    host.runFull();
    return true;
  });
  ipcMain.handle("index:set-enabled", (_e, enabled) => {
    host.setEnabled(enabled);
    return true;
  });
}

module.exports = { IndexerHost, registerIpc };
