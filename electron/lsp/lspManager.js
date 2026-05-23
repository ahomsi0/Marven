// electron/lsp/lspManager.js
const { spawn } = require("child_process");
const { EventEmitter } = require("events");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { LSP_SERVERS } = require("./lspServers");

const DEFAULT_INSTALL_ROOT = path.join(os.homedir(), ".marven", "lsp");

class LspManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.installRoot = opts.installRoot || DEFAULT_INSTALL_ROOT;
    this._isInstalledOverride = opts.isInstalled || null;
    this._runInstall = opts.runInstall || null; // injected for tests; set in Task 4.
    this._spawnFn = opts.spawnFn || spawn; // injectable for tests
    this._servers = new Map();   // languageId -> { child, buf, pending, nextId, sessions }
    this._sessions = new Map();  // sessionId -> { languageId, filePath, version }
    this._installing = new Map(); // languageId -> Promise<EnsureResult>
  }

  _binPath(languageId) {
    const spec = LSP_SERVERS[languageId];
    return path.join(this.installRoot, languageId, "node_modules", ".bin", spec.command);
  }

  _isInstalled(languageId) {
    if (this._isInstalledOverride) return this._isInstalledOverride(languageId);
    try {
      return fs.existsSync(this._binPath(languageId));
    } catch {
      return false;
    }
  }

  async ensure(languageId) {
    const spec = LSP_SERVERS[languageId];
    if (!spec) return { status: "failed", error: `unknown languageId: ${languageId}` };
    if (this._servers.has(languageId)) return { status: "ready" };

    if (!this._isInstalled(languageId)) {
      // Install path is wired in Task 4. For now, fail clearly.
      if (!this._runInstall) {
        return { status: "failed", error: "not installed and no installer configured" };
      }
      const installRes = await this._install(languageId);
      if (installRes.status !== "ready") return installRes;
    }

    this._spawn(languageId);
    return { status: "ready" };
  }

  _spawn(languageId) {
    const spec = LSP_SERVERS[languageId];
    const child = this._spawnFn(this._binPath(languageId), spec.args, {
      stdio: "pipe",
      env: process.env,
    });
    const state = {
      child,
      buf: Buffer.alloc(0),
      pending: new Map(), // id -> { resolve, reject }
      nextId: 1,
      sessions: new Set(),
      initialized: false,
    };
    this._servers.set(languageId, state);

    child.stdout.on("data", (chunk) => this._onData(languageId, chunk));
    child.stderr.on("data", (chunk) => this.emit("stderr", { languageId, text: chunk.toString("utf8") }));
    child.on("exit", (code, signal) => this._onExit(languageId, code, signal));
  }

  _onData(languageId, chunk) {
    const state = this._servers.get(languageId);
    if (!state) return;
    state.buf = Buffer.concat([state.buf, chunk]);
    while (true) {
      const sep = state.buf.indexOf("\r\n\r\n");
      if (sep < 0) return;
      const header = state.buf.slice(0, sep).toString("utf8");
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if (!m) {
        // Bad frame; drop a byte to attempt resync.
        state.buf = state.buf.slice(sep + 4);
        continue;
      }
      const len = parseInt(m[1], 10);
      const start = sep + 4;
      if (state.buf.length < start + len) return; // need more bytes
      const body = state.buf.slice(start, start + len).toString("utf8");
      state.buf = state.buf.slice(start + len);
      let msg;
      try { msg = JSON.parse(body); } catch { continue; }
      this._dispatch(languageId, msg);
    }
  }

  _dispatch(languageId, msg) {
    const state = this._servers.get(languageId);
    if (!state) return;
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = state.pending.get(msg.id);
      if (!p) return;
      state.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || "LSP error"));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method) {
      this.emit("notification", { languageId, method: msg.method, params: msg.params });
    }
  }

  _onExit(languageId, code, signal) {
    const state = this._servers.get(languageId);
    if (!state) return;
    for (const { reject } of state.pending.values()) {
      reject(new Error(`LSP server for ${languageId} exited (code=${code})`));
    }
    state.pending.clear();
    this._servers.delete(languageId);
    this.emit("server-exit", { languageId, code, signal });
  }

  _writeFrame(languageId, obj) {
    const state = this._servers.get(languageId);
    if (!state) throw new Error(`no server for ${languageId}`);
    const body = Buffer.from(JSON.stringify(obj), "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
    state.child.stdin.write(Buffer.concat([header, body]));
  }

  _sendRequest(languageId, method, params) {
    const state = this._servers.get(languageId);
    if (!state) return Promise.reject(new Error(`no server for ${languageId}`));
    const id = state.nextId++;
    const p = new Promise((resolve, reject) => state.pending.set(id, { resolve, reject }));
    this._writeFrame(languageId, { jsonrpc: "2.0", id, method, params });
    return p;
  }

  _sendNotification(languageId, method, params) {
    this._writeFrame(languageId, { jsonrpc: "2.0", method, params });
  }
}

module.exports = { LspManager };
