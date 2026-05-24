// electron/lsp/lspManager.js
const { spawn } = require("child_process");
const { EventEmitter } = require("events");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { LSP_SERVERS } = require("./lspServers");

const DEFAULT_INSTALL_ROOT = path.join(os.homedir(), ".marven", "lsp");

function defaultRunNpmInstall(languageId, { installDir, npmPackages }) {
  return new Promise((resolve) => {
    const args = ["install", ...npmPackages, "--prefix", installDir, "--no-audit", "--no-fund"];
    const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stderr = "";
    child.stderr.on("data", (b) => { stderr += b.toString("utf8"); });
    child.on("exit", (code) => resolve({ code: code ?? 1, stderr }));
    child.on("error", (err) => {
      // ENOENT here means `npm` itself isn't on PATH — surface a clear,
      // actionable message instead of the cryptic spawn error.
      const raw = String((err && err.message) || err);
      const friendly = /ENOENT/.test(raw)
        ? `npm not found on PATH. Marven uses npm to install language servers (typescript-language-server, etc.) into ~/.marven/lsp/. Install Node.js from https://nodejs.org and restart Marven. Original error: ${raw}`
        : raw;
      resolve({ code: 1, stderr: friendly });
    });
  });
}

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

  _filePathToUri(filePath) {
    // Convert absolute path to file:// URI with percent-encoding.
    const norm = filePath.replace(/\\/g, "/");
    const withSlash = norm.startsWith("/") ? norm : "/" + norm;
    return "file://" + withSlash.split("/").map(encodeURIComponent).join("/").replace(/%2F/g, "/");
  }

  _languageIdToLspId(languageId) {
    // LSP "languageId" for didOpen — for our TS server we send "typescript".
    return languageId;
  }

  async openSession({ languageId, filePath, workspaceRoot, text = "" }) {
    // Fast path: server already running — send initialize synchronously (no awaits) so
    // tests and callers can observe the framed bytes before awaiting the returned promise.
    if (!this._servers.has(languageId)) {
      const r = await this.ensure(languageId);
      if (r.status !== "ready") throw new Error(`LSP not ready: ${r.error || r.status}`);
    }
    const state = this._servers.get(languageId);

    let initPromise = null;
    if (!state.initialized) {
      const rootUri = this._filePathToUri(workspaceRoot);
      initPromise = this._sendRequest(languageId, "initialize", {
        processId: process.pid,
        rootUri,
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: true },
            hover: { contentFormat: ["markdown", "plaintext"] },
            completion: { completionItem: { snippetSupport: false } },
            definition: {},
            rename: {},
            publishDiagnostics: { relatedInformation: true },
          },
          workspace: { workspaceEdit: { documentChanges: true } },
        },
        initializationOptions: LSP_SERVERS[languageId].initializationOptions || {},
        workspaceFolders: [{ uri: rootUri, name: path.basename(workspaceRoot) }],
      });
      state.initialized = true;
    }
    if (initPromise) {
      await initPromise;
      this._sendNotification(languageId, "initialized", {});
    }

    const sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session = { sessionId, languageId, filePath, version: 1, text };
    this._sessions.set(sessionId, session);
    state.sessions.add(sessionId);

    this._sendNotification(languageId, "textDocument/didOpen", {
      textDocument: {
        uri: this._filePathToUri(filePath),
        languageId: this._languageIdToLspId(languageId),
        version: 1,
        text,
      },
    });

    return { sessionId };
  }

  didChange(sessionId, { version, text }) {
    const s = this._sessions.get(sessionId);
    if (!s) return;
    s.version = version;
    s.text = text;
    this._sendNotification(s.languageId, "textDocument/didChange", {
      textDocument: { uri: this._filePathToUri(s.filePath), version },
      contentChanges: [{ text }],
    });
  }

  async closeSession(sessionId) {
    const s = this._sessions.get(sessionId);
    if (!s) return;
    this._sendNotification(s.languageId, "textDocument/didClose", {
      textDocument: { uri: this._filePathToUri(s.filePath) },
    });
    this._sessions.delete(sessionId);
    const state = this._servers.get(s.languageId);
    if (state) {
      state.sessions.delete(sessionId);
      if (state.sessions.size === 0) {
        try { state.child.kill(); } catch {}
      }
    }
  }

  async request(sessionId, method, params) {
    const s = this._sessions.get(sessionId);
    if (!s) throw new Error(`unknown sessionId ${sessionId}`);
    const merged = {
      ...params,
      textDocument: { uri: this._filePathToUri(s.filePath), ...(params && params.textDocument) },
    };
    return this._sendRequest(s.languageId, method, merged);
  }

  async restart(languageId) {
    const state = this._servers.get(languageId);
    if (state) {
      try { state.child.kill(); } catch {}
      // _onExit removes the state.
    }
    return this.ensure(languageId);
  }

  listSessions() {
    return Array.from(this._sessions.values()).map((s) => ({ ...s }));
  }

  async _install(languageId) {
    if (this._installing.has(languageId)) return this._installing.get(languageId);
    const spec = LSP_SERVERS[languageId];
    if (!spec) return { status: "failed", error: `unknown languageId: ${languageId}` };

    const p = (async () => {
      this.emit("install-status", { languageId, state: "installing" });
      const installDir = path.join(this.installRoot, languageId);
      try { fs.mkdirSync(installDir, { recursive: true }); } catch {}
      const runner = this._runInstall || defaultRunNpmInstall;
      const { code, stderr } = await runner(languageId, { installDir, npmPackages: spec.npmPackages });
      if (code === 0 && this._isInstalled(languageId)) {
        this.emit("install-status", { languageId, state: "installed" });
        return { status: "ready" };
      }
      this.emit("install-status", { languageId, state: "install-failed", error: stderr });
      return { status: "failed", error: stderr || `npm install exited with code ${code}` };
    })();

    this._installing.set(languageId, p);
    try {
      return await p;
    } finally {
      this._installing.delete(languageId);
    }
  }
}

module.exports = { LspManager };
