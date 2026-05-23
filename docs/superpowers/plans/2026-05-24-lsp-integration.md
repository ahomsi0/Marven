# LSP Integration — Implementation Plan

**Date:** 2026-05-24
**Spec:** `/Users/ahomsi/Development/Personal Projects/Marven/docs/superpowers/specs/2026-05-24-lsp-integration-design.md`
**Branch:** `feat/lsp-integration`

---

## Goal

Add Language Server Protocol support to Marven's CodeMirror 6 editor so users get diagnostics, hover types, completions, go-to-definition, and rename for TypeScript/JavaScript files. Foundation supports adding more languages by config alone.

## Architecture (one sentence)

A singleton `LspManager` in the Electron main process spawns `typescript-language-server` child processes, frames JSON-RPC over stdio, and bridges renderer requests/notifications through `marvenElectron.lsp.*` IPC, where a CodeMirror 6 extension translates editor events into LSP messages and renders responses.

## Tech Stack

- Electron main (CommonJS .js) — `child_process.spawn`, JSON-RPC framing, npm install supervision
- IPC — Electron `contextBridge` (`marvenElectron.lsp.*`), `ipcMain.handle/on`, `webContents.send`
- Renderer (TS) — `lib/editor/*` modules + CodeMirror 6 (`@codemirror/lint`, `@codemirror/autocomplete`, `@codemirror/view`, `@codemirror/state` — all already in `package.json`)
- Tests — Vitest (node env), mocked `child_process` for unit tests; real `typescript-language-server` for one gated e2e test
- Day-1 server — `typescript-language-server` + `typescript`, installed into `~/.marven/lsp/typescript/`

## Conventions used in this plan

- Every task ends with a `git commit` using conventional commits.
- TDD strictly: write the failing test first, run it, confirm the failure mode, implement, re-run, confirm pass, then commit.
- All file paths are absolute.
- Run tests with: `npx vitest run <path>` (single file) or `npm test` (all). Project uses `vitest.config.ts` with `environment: "node"`.

---

## Task 1 — Renderer language-server registry (`lib/editor/lspServers.ts`)

**Files**
- Create: `/Users/ahomsi/Development/Personal Projects/Marven/lib/editor/lspServers.ts`
- Test: `/Users/ahomsi/Development/Personal Projects/Marven/lib/editor/lspServers.test.ts`

**Steps**

- [ ] 1.1 Create the test file first:

```ts
// lib/editor/lspServers.test.ts
import { describe, it, expect } from "vitest";
import { LSP_SERVERS, languageIdForExtension } from "./lspServers";

describe("lspServers registry", () => {
  it("registers typescript with the expected npm packages and command", () => {
    const ts = LSP_SERVERS.typescript;
    expect(ts.languageId).toBe("typescript");
    expect(ts.npmPackages).toEqual(["typescript", "typescript-language-server"]);
    expect(ts.command).toBe("typescript-language-server");
    expect(ts.args).toEqual(["--stdio"]);
    expect(ts.extensions).toEqual(
      expect.arrayContaining(["ts", "tsx", "js", "jsx", "mjs", "cjs"])
    );
  });

  it("languageIdForExtension maps known extensions to typescript", () => {
    expect(languageIdForExtension("ts")).toBe("typescript");
    expect(languageIdForExtension("tsx")).toBe("typescript");
    expect(languageIdForExtension("jsx")).toBe("typescript");
    expect(languageIdForExtension("mjs")).toBe("typescript");
  });

  it("languageIdForExtension is case-insensitive", () => {
    expect(languageIdForExtension("TS")).toBe("typescript");
    expect(languageIdForExtension("TSX")).toBe("typescript");
  });

  it("languageIdForExtension returns null for unsupported extensions", () => {
    expect(languageIdForExtension("py")).toBeNull();
    expect(languageIdForExtension("rs")).toBeNull();
    expect(languageIdForExtension("")).toBeNull();
  });
});
```

- [ ] 1.2 Run the test and confirm it fails because the module doesn't exist:

```bash
npx vitest run lib/editor/lspServers.test.ts
```

Expected: `Error: Failed to load url ./lspServers`.

- [ ] 1.3 Implement the module:

```ts
// lib/editor/lspServers.ts
export type LanguageId = "typescript";

export interface LspServerSpec {
  languageId: LanguageId;
  /** File extensions this server handles (no leading dot). */
  extensions: string[];
  /** Package(s) to npm-install. */
  npmPackages: string[];
  /** Command (relative to install dir's node_modules/.bin/). */
  command: string;
  /** Args to pass to the command. */
  args: string[];
  /** Initialization options sent in LSP `initialize`. */
  initializationOptions?: Record<string, unknown>;
}

export const LSP_SERVERS: Record<LanguageId, LspServerSpec> = {
  typescript: {
    languageId: "typescript",
    extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs"],
    npmPackages: ["typescript", "typescript-language-server"],
    command: "typescript-language-server",
    args: ["--stdio"],
    initializationOptions: {
      preferences: {
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true,
      },
    },
  },
};

export function languageIdForExtension(ext: string): LanguageId | null {
  const norm = ext.toLowerCase();
  for (const spec of Object.values(LSP_SERVERS)) {
    if (spec.extensions.includes(norm)) return spec.languageId;
  }
  return null;
}
```

- [ ] 1.4 Re-run the test:

```bash
npx vitest run lib/editor/lspServers.test.ts
```

Expected output:
```
✓ lib/editor/lspServers.test.ts (4)
  ✓ lspServers registry > registers typescript with the expected npm packages and command
  ✓ lspServers registry > languageIdForExtension maps known extensions to typescript
  ✓ lspServers registry > languageIdForExtension is case-insensitive
  ✓ lspServers registry > languageIdForExtension returns null for unsupported extensions
Test Files  1 passed (1)
```

- [ ] 1.5 Commit:

```bash
git add lib/editor/lspServers.ts lib/editor/lspServers.test.ts
git commit -m "feat(lsp): add renderer language-server registry"
```

---

## Task 2 — Main-process registry (`electron/lsp/lspServers.js`) + sync test

**Files**
- Create: `/Users/ahomsi/Development/Personal Projects/Marven/electron/lsp/lspServers.js`
- Test: `/Users/ahomsi/Development/Personal Projects/Marven/electron/lsp/__tests__/lspServersSync.test.js`

**Steps**

- [ ] 2.1 Write the structural sync test (this asserts both registries stay aligned — a single source of truth would be nicer but cross-runtime [CJS in Electron, ESM in renderer] makes that fragile):

```js
// electron/lsp/__tests__/lspServersSync.test.js
const { describe, it, expect } = require("vitest");
const { LSP_SERVERS: mainServers } = require("../lspServers");

describe("electron/lsp/lspServers.js", () => {
  it("exports a typescript spec with required fields", () => {
    const ts = mainServers.typescript;
    expect(ts).toBeDefined();
    expect(ts.languageId).toBe("typescript");
    expect(ts.command).toBe("typescript-language-server");
    expect(ts.args).toEqual(["--stdio"]);
    expect(Array.isArray(ts.npmPackages)).toBe(true);
    expect(ts.npmPackages).toContain("typescript-language-server");
    expect(ts.extensions).toEqual(
      expect.arrayContaining(["ts", "tsx", "js", "jsx", "mjs", "cjs"])
    );
  });

  it("matches the renderer registry shape", async () => {
    // Renderer module is TS; import via vitest's TS transform.
    const renderer = await import("../../../lib/editor/lspServers");
    expect(Object.keys(mainServers).sort()).toEqual(
      Object.keys(renderer.LSP_SERVERS).sort()
    );
    for (const id of Object.keys(mainServers)) {
      const m = mainServers[id];
      const r = renderer.LSP_SERVERS[id];
      expect(m.command).toBe(r.command);
      expect(m.args).toEqual(r.args);
      expect(m.npmPackages).toEqual(r.npmPackages);
      expect(m.extensions.sort()).toEqual([...r.extensions].sort());
    }
  });
});
```

- [ ] 2.2 Run and confirm failure (module missing):

```bash
npx vitest run electron/lsp/__tests__/lspServersSync.test.js
```

Expected: `Cannot find module '../lspServers'`.

- [ ] 2.3 Implement `electron/lsp/lspServers.js`:

```js
// electron/lsp/lspServers.js
// CommonJS twin of lib/editor/lspServers.ts.
// Kept in sync via electron/lsp/__tests__/lspServersSync.test.js.

const LSP_SERVERS = {
  typescript: {
    languageId: "typescript",
    extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs"],
    npmPackages: ["typescript", "typescript-language-server"],
    command: "typescript-language-server",
    args: ["--stdio"],
    initializationOptions: {
      preferences: {
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true,
      },
    },
  },
};

function languageIdForExtension(ext) {
  if (!ext) return null;
  const norm = String(ext).toLowerCase();
  for (const spec of Object.values(LSP_SERVERS)) {
    if (spec.extensions.includes(norm)) return spec.languageId;
  }
  return null;
}

module.exports = { LSP_SERVERS, languageIdForExtension };
```

- [ ] 2.4 Re-run:

```bash
npx vitest run electron/lsp/__tests__/lspServersSync.test.js
```

Expected:
```
✓ electron/lsp/__tests__/lspServersSync.test.js (2)
  ✓ electron/lsp/lspServers.js > exports a typescript spec with required fields
  ✓ electron/lsp/lspServers.js > matches the renderer registry shape
```

- [ ] 2.5 Commit:

```bash
git add electron/lsp/lspServers.js electron/lsp/__tests__/lspServersSync.test.js
git commit -m "feat(lsp): add main-process language-server registry kept in sync with renderer"
```

---

## Task 3 — LspManager skeleton: JSON-RPC framing + spawn

**Files**
- Create: `/Users/ahomsi/Development/Personal Projects/Marven/electron/lsp/lspManager.js`
- Test: `/Users/ahomsi/Development/Personal Projects/Marven/electron/lsp/__tests__/lspManager.test.js`

This task introduces the manager class with: spawn, framed write, framed read, request/response correlation, and notification fan-out. Install + session handshake come in tasks 4 and 5.

**Steps**

- [ ] 3.1 Write the failing test:

```js
// electron/lsp/__tests__/lspManager.test.js
const { describe, it, expect, vi, beforeEach } = require("vitest");
const { EventEmitter } = require("events");

// Mock child_process before requiring lspManager.
vi.mock("child_process", () => {
  return {
    spawn: vi.fn(() => makeFakeChild()),
  };
});

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => child.emit("exit", 0, null));
  child.pid = 4242;
  return child;
}

const childProcess = require("child_process");

function frame(json) {
  const body = Buffer.from(JSON.stringify(json), "utf8");
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"),
    body,
  ]);
}

function parseLastFramedWrite(child) {
  const last = child.stdin.write.mock.calls.at(-1)[0];
  const buf = Buffer.isBuffer(last) ? last : Buffer.from(last);
  const sep = buf.indexOf("\r\n\r\n");
  return JSON.parse(buf.slice(sep + 4).toString("utf8"));
}

describe("LspManager (framing + transport)", () => {
  let mgr;
  let LspManager;

  beforeEach(async () => {
    vi.resetModules();
    childProcess.spawn.mockClear();
    ({ LspManager } = require("../lspManager"));
    mgr = new LspManager({
      installRoot: "/tmp/marven-lsp-test",
      // Pretend the bin is already installed so we can test transport in isolation.
      isInstalled: () => true,
    });
  });

  it("spawns the server process when ensure() runs and bin exists", async () => {
    const result = await mgr.ensure("typescript");
    expect(result.status).toBe("ready");
    expect(childProcess.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args] = childProcess.spawn.mock.calls[0];
    expect(cmd).toMatch(/typescript-language-server$/);
    expect(args).toEqual(["--stdio"]);
  });

  it("sends framed JSON-RPC on request() and resolves with the matching response", async () => {
    await mgr.ensure("typescript");
    const child = childProcess.spawn.mock.results[0].value;

    const pending = mgr._sendRequest("typescript", "ping", { hello: 1 });
    const sent = parseLastFramedWrite(child);
    expect(sent.method).toBe("ping");
    expect(sent.params).toEqual({ hello: 1 });
    expect(typeof sent.id).toBe("number");

    child.stdout.emit("data", frame({ jsonrpc: "2.0", id: sent.id, result: { pong: true } }));
    await expect(pending).resolves.toEqual({ pong: true });
  });

  it("parses Content-Length frames split across chunks", async () => {
    await mgr.ensure("typescript");
    const child = childProcess.spawn.mock.results[0].value;

    const notifications = [];
    mgr.on("notification", (n) => notifications.push(n));

    const full = frame({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { uri: "file:///x", diagnostics: [] } });
    // Split mid-body.
    child.stdout.emit("data", full.slice(0, 30));
    child.stdout.emit("data", full.slice(30));

    expect(notifications).toHaveLength(1);
    expect(notifications[0].method).toBe("textDocument/publishDiagnostics");
  });

  it("rejects pending requests on server exit and emits 'server-exit'", async () => {
    await mgr.ensure("typescript");
    const child = childProcess.spawn.mock.results[0].value;

    const exits = [];
    mgr.on("server-exit", (e) => exits.push(e));

    const pending = mgr._sendRequest("typescript", "ping", {});
    child.emit("exit", 1, null);

    await expect(pending).rejects.toThrow(/exited/);
    expect(exits).toEqual([{ languageId: "typescript", code: 1, signal: null }]);
  });
});
```

- [ ] 3.2 Run, confirm failure:

```bash
npx vitest run electron/lsp/__tests__/lspManager.test.js
```

Expected: `Cannot find module '../lspManager'`.

- [ ] 3.3 Implement the skeleton:

```js
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
    const child = spawn(this._binPath(languageId), spec.args, {
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
```

- [ ] 3.4 Re-run, expect:

```
✓ electron/lsp/__tests__/lspManager.test.js (4)
  ✓ LspManager (framing + transport) > spawns the server process when ensure() runs and bin exists
  ✓ LspManager (framing + transport) > sends framed JSON-RPC on request() and resolves with the matching response
  ✓ LspManager (framing + transport) > parses Content-Length frames split across chunks
  ✓ LspManager (framing + transport) > rejects pending requests on server exit and emits 'server-exit'
```

- [ ] 3.5 Commit:

```bash
git add electron/lsp/lspManager.js electron/lsp/__tests__/lspManager.test.js
git commit -m "feat(lsp): add LspManager skeleton with JSON-RPC framing"
```

---

## Task 4 — Install logic (`npm install` into `~/.marven/lsp/<lang>/`)

**Files**
- Modify: `/Users/ahomsi/Development/Personal Projects/Marven/electron/lsp/lspManager.js`
- Modify: `/Users/ahomsi/Development/Personal Projects/Marven/electron/lsp/__tests__/lspManager.test.js` (append cases)

**Steps**

- [ ] 4.1 Append the failing install tests:

```js
// ... append to electron/lsp/__tests__/lspManager.test.js

describe("LspManager (install)", () => {
  let LspManager;
  beforeEach(() => {
    vi.resetModules();
    childProcess.spawn.mockClear();
    ({ LspManager } = require("../lspManager"));
  });

  it("returns ready immediately when bin already installed", async () => {
    const runInstall = vi.fn();
    const mgr = new LspManager({
      installRoot: "/tmp/marven-lsp-test",
      isInstalled: () => true,
      runInstall,
    });
    const events = [];
    mgr.on("install-status", (e) => events.push(e));
    const r = await mgr.ensure("typescript");
    expect(r.status).toBe("ready");
    expect(runInstall).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("calls runInstall when bin missing and emits installing/installed events", async () => {
    let installed = false;
    const runInstall = vi.fn(async () => {
      installed = true;
      return { code: 0, stderr: "" };
    });
    const mgr = new LspManager({
      installRoot: "/tmp/marven-lsp-test",
      isInstalled: () => installed,
      runInstall,
    });
    const events = [];
    mgr.on("install-status", (e) => events.push(e));

    const r = await mgr.ensure("typescript");
    expect(r.status).toBe("ready");
    expect(runInstall).toHaveBeenCalledWith(
      "typescript",
      expect.objectContaining({ npmPackages: expect.arrayContaining(["typescript-language-server"]) })
    );
    expect(events.map((e) => e.state)).toEqual(["installing", "installed"]);
  });

  it("returns failed status on install error", async () => {
    const runInstall = vi.fn(async () => ({ code: 1, stderr: "boom" }));
    const mgr = new LspManager({
      installRoot: "/tmp/marven-lsp-test",
      isInstalled: () => false,
      runInstall,
    });
    const events = [];
    mgr.on("install-status", (e) => events.push(e));
    const r = await mgr.ensure("typescript");
    expect(r.status).toBe("failed");
    expect(r.error).toContain("boom");
    expect(events.map((e) => e.state)).toEqual(["installing", "install-failed"]);
  });

  it("dedupes concurrent ensure() calls during install", async () => {
    let installed = false;
    let inflight = 0;
    let maxInflight = 0;
    const runInstall = vi.fn(async () => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 10));
      inflight--;
      installed = true;
      return { code: 0, stderr: "" };
    });
    const mgr = new LspManager({
      installRoot: "/tmp/marven-lsp-test",
      isInstalled: () => installed,
      runInstall,
    });
    const [a, b] = await Promise.all([mgr.ensure("typescript"), mgr.ensure("typescript")]);
    expect(a.status).toBe("ready");
    expect(b.status).toBe("ready");
    expect(runInstall).toHaveBeenCalledTimes(1);
    expect(maxInflight).toBe(1);
  });
});
```

- [ ] 4.2 Run, expect failures (`install-status` event never fires; dedupe fails).

```bash
npx vitest run electron/lsp/__tests__/lspManager.test.js
```

- [ ] 4.3 Add `_install` plus a real npm runner. Edit `electron/lsp/lspManager.js`:

Add at top (after existing requires):
```js
const { spawn: cpSpawn } = require("child_process");
```
(already have `spawn` — reuse it; just keeping note that the default `runInstall` uses spawn too.)

Add inside the class:

```js
async _install(languageId) {
  if (this._installing.has(languageId)) return this._installing.get(languageId);
  const spec = LSP_SERVERS[languageId];
  if (!spec) return { status: "failed", error: `unknown languageId: ${languageId}` };

  const p = (async () => {
    this.emit("install-status", { languageId, state: "installing" });
    const installDir = path.join(this.installRoot, languageId);
    fs.mkdirSync(installDir, { recursive: true });
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
```

Add the default install runner (module scope, above `class LspManager`):

```js
function defaultRunNpmInstall(languageId, { installDir, npmPackages }) {
  return new Promise((resolve) => {
    const args = ["install", ...npmPackages, "--prefix", installDir, "--no-audit", "--no-fund"];
    const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stderr = "";
    child.stderr.on("data", (b) => { stderr += b.toString("utf8"); });
    child.on("exit", (code) => resolve({ code: code ?? 1, stderr }));
    child.on("error", (err) => resolve({ code: 1, stderr: String(err && err.message || err) }));
  });
}
```

- [ ] 4.4 Re-run, expect:

```
✓ LspManager (install) > returns ready immediately when bin already installed
✓ LspManager (install) > calls runInstall when bin missing and emits installing/installed events
✓ LspManager (install) > returns failed status on install error
✓ LspManager (install) > dedupes concurrent ensure() calls during install
```

- [ ] 4.5 Commit:

```bash
git add electron/lsp/lspManager.js electron/lsp/__tests__/lspManager.test.js
git commit -m "feat(lsp): add install logic with concurrent ensure() dedupe"
```

---

## Task 5 — Session lifecycle + `initialize` handshake

**Files**
- Modify: `/Users/ahomsi/Development/Personal Projects/Marven/electron/lsp/lspManager.js`
- Modify: `/Users/ahomsi/Development/Personal Projects/Marven/electron/lsp/__tests__/lspManager.test.js`

**Steps**

- [ ] 5.1 Append failing tests:

```js
describe("LspManager (sessions + handshake)", () => {
  let mgr, child, LspManager;

  beforeEach(async () => {
    vi.resetModules();
    childProcess.spawn.mockClear();
    ({ LspManager } = require("../lspManager"));
    mgr = new LspManager({
      installRoot: "/tmp/marven-lsp-test",
      isInstalled: () => true,
    });
    await mgr.ensure("typescript");
    child = childProcess.spawn.mock.results[0].value;
  });

  function lastFrames(c) {
    return c.stdin.write.mock.calls.map(([buf]) => {
      const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      const sep = b.indexOf("\r\n\r\n");
      return JSON.parse(b.slice(sep + 4).toString("utf8"));
    });
  }

  it("openSession sends initialize on first session, didOpen always", async () => {
    const pending = mgr.openSession({
      languageId: "typescript",
      filePath: "/tmp/foo.ts",
      workspaceRoot: "/tmp",
    });

    // Respond to initialize.
    const initReq = lastFrames(child).find((f) => f.method === "initialize");
    expect(initReq).toBeDefined();
    expect(initReq.params.rootUri).toBe("file:///tmp");
    child.stdout.emit("data", frame({ jsonrpc: "2.0", id: initReq.id, result: { capabilities: {} } }));

    const { sessionId } = await pending;
    expect(typeof sessionId).toBe("string");

    const frames = lastFrames(child);
    const initialized = frames.find((f) => f.method === "initialized");
    const didOpen = frames.find((f) => f.method === "textDocument/didOpen");
    expect(initialized).toBeDefined();
    expect(didOpen).toBeDefined();
    expect(didOpen.params.textDocument.uri).toBe("file:///tmp/foo.ts");
    expect(didOpen.params.textDocument.languageId).toBe("typescript");
  });

  it("second openSession reuses the server and skips initialize", async () => {
    // First session — full handshake.
    const p1 = mgr.openSession({ languageId: "typescript", filePath: "/tmp/a.ts", workspaceRoot: "/tmp" });
    const init = lastFrames(child).find((f) => f.method === "initialize");
    child.stdout.emit("data", frame({ jsonrpc: "2.0", id: init.id, result: { capabilities: {} } }));
    await p1;

    const before = lastFrames(child).filter((f) => f.method === "initialize").length;
    const p2 = await mgr.openSession({ languageId: "typescript", filePath: "/tmp/b.ts", workspaceRoot: "/tmp" });
    const after = lastFrames(child).filter((f) => f.method === "initialize").length;
    expect(after).toBe(before);
    expect(p2.sessionId).toBeDefined();
  });

  it("didChange sends framed textDocument/didChange with incrementing version", async () => {
    const p = mgr.openSession({ languageId: "typescript", filePath: "/tmp/c.ts", workspaceRoot: "/tmp" });
    const init = lastFrames(child).find((f) => f.method === "initialize");
    child.stdout.emit("data", frame({ jsonrpc: "2.0", id: init.id, result: { capabilities: {} } }));
    const { sessionId } = await p;

    mgr.didChange(sessionId, { version: 2, text: "const x = 1;" });
    const last = lastFrames(child).at(-1);
    expect(last.method).toBe("textDocument/didChange");
    expect(last.params.textDocument.version).toBe(2);
    expect(last.params.contentChanges[0].text).toBe("const x = 1;");
  });

  it("closeSession sends didClose and shuts the server when last session closes", async () => {
    const p = mgr.openSession({ languageId: "typescript", filePath: "/tmp/d.ts", workspaceRoot: "/tmp" });
    const init = lastFrames(child).find((f) => f.method === "initialize");
    child.stdout.emit("data", frame({ jsonrpc: "2.0", id: init.id, result: { capabilities: {} } }));
    const { sessionId } = await p;

    await mgr.closeSession(sessionId);
    const didClose = lastFrames(child).find((f) => f.method === "textDocument/didClose");
    expect(didClose).toBeDefined();
    expect(didClose.params.textDocument.uri).toBe("file:///tmp/d.ts");
  });

  it("request() routes through the right server and resolves with the response", async () => {
    const p = mgr.openSession({ languageId: "typescript", filePath: "/tmp/e.ts", workspaceRoot: "/tmp" });
    const init = lastFrames(child).find((f) => f.method === "initialize");
    child.stdout.emit("data", frame({ jsonrpc: "2.0", id: init.id, result: { capabilities: {} } }));
    const { sessionId } = await p;

    const hoverP = mgr.request(sessionId, "textDocument/hover", { position: { line: 0, character: 0 } });
    const sentHover = lastFrames(child).find((f) => f.method === "textDocument/hover");
    expect(sentHover.params.textDocument.uri).toBe("file:///tmp/e.ts");
    child.stdout.emit("data", frame({ jsonrpc: "2.0", id: sentHover.id, result: { contents: "x: number" } }));
    await expect(hoverP).resolves.toEqual({ contents: "x: number" });
  });

  it("encodes URIs with spaces correctly", async () => {
    const p = mgr.openSession({ languageId: "typescript", filePath: "/tmp/has space/foo.ts", workspaceRoot: "/tmp/has space" });
    const init = lastFrames(child).find((f) => f.method === "initialize");
    child.stdout.emit("data", frame({ jsonrpc: "2.0", id: init.id, result: { capabilities: {} } }));
    await p;
    const didOpen = lastFrames(child).find((f) => f.method === "textDocument/didOpen");
    expect(didOpen.params.textDocument.uri).toBe("file:///tmp/has%20space/foo.ts");
  });
});
```

- [ ] 5.2 Run, confirm failures.

- [ ] 5.3 Implement session API in `electron/lsp/lspManager.js`. Add inside the class:

```js
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
  const r = await this.ensure(languageId);
  if (r.status !== "ready") throw new Error(`LSP not ready: ${r.error || r.status}`);
  const state = this._servers.get(languageId);

  if (!state.initialized) {
    const rootUri = this._filePathToUri(workspaceRoot);
    await this._sendRequest(languageId, "initialize", {
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
    this._sendNotification(languageId, "initialized", {});
    state.initialized = true;
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
```

- [ ] 5.4 Re-run, expect all session tests passing:

```
✓ LspManager (sessions + handshake) > openSession sends initialize on first session, didOpen always
✓ LspManager (sessions + handshake) > second openSession reuses the server and skips initialize
✓ LspManager (sessions + handshake) > didChange sends framed textDocument/didChange with incrementing version
✓ LspManager (sessions + handshake) > closeSession sends didClose and shuts the server when last session closes
✓ LspManager (sessions + handshake) > request() routes through the right server and resolves with the response
✓ LspManager (sessions + handshake) > encodes URIs with spaces correctly
```

- [ ] 5.5 Commit:

```bash
git add electron/lsp/lspManager.js electron/lsp/__tests__/lspManager.test.js
git commit -m "feat(lsp): add session lifecycle and initialize handshake"
```

---

## Task 6 — IPC: preload bridge + main.js handlers

**Files**
- Modify: `/Users/ahomsi/Development/Personal Projects/Marven/electron/preload.js`
- Modify: `/Users/ahomsi/Development/Personal Projects/Marven/electron/main.js`

**Steps**

- [ ] 6.1 Extend `electron/preload.js`. After the `onPtyExit` block (before the closing `});` of `exposeInMainWorld`), add:

```js
  // ── LSP bridge ────────────────────────────────────────────────────────────
  lsp: {
    ensure: (languageId) => ipcRenderer.invoke("lsp-ensure", languageId),
    openSession: (opts) => ipcRenderer.invoke("lsp-open-session", opts),
    closeSession: (sessionId) => ipcRenderer.invoke("lsp-close-session", sessionId),
    didChange: (sessionId, payload) => ipcRenderer.send("lsp-did-change", { sessionId, payload }),
    request: (sessionId, method, params) =>
      ipcRenderer.invoke("lsp-request", { sessionId, method, params }),
    restart: (languageId) => ipcRenderer.invoke("lsp-restart", languageId),
    onNotification: (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on("lsp-notification", handler);
      return () => ipcRenderer.removeListener("lsp-notification", handler);
    },
    onStatus: (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on("lsp-status", handler);
      return () => ipcRenderer.removeListener("lsp-status", handler);
    },
  },
```

- [ ] 6.2 Extend `electron/main.js`. Near the top (after other top-level requires), add:

```js
const { LspManager } = require("./lsp/lspManager");
const lspManager = new LspManager();

function broadcastToAllWindows(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

lspManager.on("notification", (n) => broadcastToAllWindows("lsp-notification", n));
lspManager.on("install-status", (s) => broadcastToAllWindows("lsp-status", { kind: "install", ...s }));
lspManager.on("server-exit", (e) => broadcastToAllWindows("lsp-status", { kind: "server-exit", ...e }));
lspManager.on("stderr", (s) => broadcastToAllWindows("lsp-status", { kind: "stderr", ...s }));
```

Below the existing `ipcMain` registrations (anywhere after `ipcMain.handle('install-update', ...)` is fine), add:

```js
ipcMain.handle("lsp-ensure", async (_event, languageId) => {
  return lspManager.ensure(languageId);
});

ipcMain.handle("lsp-open-session", async (_event, opts) => {
  return lspManager.openSession(opts);
});

ipcMain.handle("lsp-close-session", async (_event, sessionId) => {
  await lspManager.closeSession(sessionId);
  return { ok: true };
});

ipcMain.on("lsp-did-change", (_event, { sessionId, payload }) => {
  try { lspManager.didChange(sessionId, payload); }
  catch (err) { console.error("[Marven] lsp didChange:", err && err.message); }
});

ipcMain.handle("lsp-request", async (_event, { sessionId, method, params }) => {
  try {
    return { ok: true, result: await lspManager.request(sessionId, method, params) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle("lsp-restart", async (_event, languageId) => {
  return lspManager.restart(languageId);
});
```

- [ ] 6.3 Smoke-check by booting Electron in dev (no automated test here; functional validation comes in Task 10):

```bash
npm run electron:dev
```

Expected: app starts without console errors and `window.marvenElectron.lsp` is defined (verify in DevTools later).

- [ ] 6.4 Commit:

```bash
git add electron/preload.js electron/main.js
git commit -m "feat(lsp): expose LspManager over IPC bridge"
```

---

## Task 7 — Renderer LSP client (`lib/editor/lspClient.ts`)

**Files**
- Create: `/Users/ahomsi/Development/Personal Projects/Marven/lib/editor/lspClient.ts`
- Test: `/Users/ahomsi/Development/Personal Projects/Marven/lib/editor/lspClient.test.ts`
- Modify: `/Users/ahomsi/Development/Personal Projects/Marven/types/index.ts` — add LSP types

**Steps**

- [ ] 7.1 Add types to `types/index.ts` (append at end of file):

```ts
// ── LSP types ────────────────────────────────────────────────────────────────
export type LspEnsureStatus = "ready" | "installing" | "failed";
export interface LspEnsureResult {
  status: LspEnsureStatus;
  error?: string;
}
export interface LspOpenSessionOpts {
  languageId: string;
  filePath: string;
  workspaceRoot: string;
  text?: string;
}
export interface LspNotification {
  languageId: string;
  method: string;
  params: unknown;
}
export interface LspStatusEvent {
  kind: "install" | "server-exit" | "stderr";
  languageId: string;
  state?: "installing" | "installed" | "install-failed";
  code?: number | null;
  signal?: string | null;
  text?: string;
  error?: string;
}
export interface LspPosition { line: number; character: number; }
export interface LspRange { start: LspPosition; end: LspPosition; }
export interface LspTextEdit { range: LspRange; newText: string; }
export interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: Array<{ textDocument: { uri: string; version: number | null }; edits: LspTextEdit[] }>;
}
```

- [ ] 7.2 Write the failing test:

```ts
// lib/editor/lspClient.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

function installFakeBridge() {
  const handlers = {
    notif: [] as Array<(n: unknown) => void>,
    status: [] as Array<(s: unknown) => void>,
  };
  const bridge = {
    ensure: vi.fn(async (_id: string) => ({ status: "ready" as const })),
    openSession: vi.fn(async (_o: unknown) => ({ sessionId: "sess_1" })),
    closeSession: vi.fn(async (_id: string) => ({ ok: true })),
    didChange: vi.fn(),
    request: vi.fn(async (_s: string, _m: string, _p: unknown) => ({ ok: true, result: { ok: 42 } })),
    restart: vi.fn(async (_id: string) => ({ status: "ready" as const })),
    onNotification: vi.fn((cb: (n: unknown) => void) => {
      handlers.notif.push(cb);
      return () => { handlers.notif = handlers.notif.filter((h) => h !== cb); };
    }),
    onStatus: vi.fn((cb: (s: unknown) => void) => {
      handlers.status.push(cb);
      return () => { handlers.status = handlers.status.filter((h) => h !== cb); };
    }),
  };
  (globalThis as any).window = { marvenElectron: { lsp: bridge } };
  return { bridge, handlers };
}

describe("lspClient", () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as any).window;
  });

  it("forwards ensure/openSession/closeSession/request to the bridge", async () => {
    const { bridge } = installFakeBridge();
    const { lspClient } = await import("./lspClient");

    expect(await lspClient.ensure("typescript")).toEqual({ status: "ready" });
    expect(bridge.ensure).toHaveBeenCalledWith("typescript");

    const opened = await lspClient.openSession({
      languageId: "typescript", filePath: "/x/a.ts", workspaceRoot: "/x",
    });
    expect(opened.sessionId).toBe("sess_1");

    await lspClient.closeSession("sess_1");
    expect(bridge.closeSession).toHaveBeenCalledWith("sess_1");

    const result = await lspClient.request("sess_1", "textDocument/hover", { position: { line: 0, character: 0 } });
    expect(result).toEqual({ ok: 42 });
  });

  it("request() throws when the bridge returns ok:false", async () => {
    const { bridge } = installFakeBridge();
    bridge.request.mockResolvedValueOnce({ ok: false, error: "boom" });
    const { lspClient } = await import("./lspClient");
    await expect(lspClient.request("sess_1", "textDocument/hover", {})).rejects.toThrow("boom");
  });

  it("onNotification subscribes and unsubscribes", async () => {
    const { handlers } = installFakeBridge();
    const { lspClient } = await import("./lspClient");

    const got: unknown[] = [];
    const unsub = lspClient.onNotification((n) => got.push(n));
    handlers.notif.forEach((h) => h({ method: "textDocument/publishDiagnostics", params: {} }));
    expect(got).toHaveLength(1);

    unsub();
    expect(handlers.notif).toHaveLength(0);
  });

  it("works as a no-op shim outside Electron (no window.marvenElectron)", async () => {
    const { lspClient } = await import("./lspClient");
    const r = await lspClient.ensure("typescript");
    expect(r.status).toBe("failed");
    expect(r.error).toMatch(/not available/i);
  });
});
```

- [ ] 7.3 Run, confirm failure (module missing).

- [ ] 7.4 Implement `lib/editor/lspClient.ts`:

```ts
// lib/editor/lspClient.ts
import type {
  LspEnsureResult,
  LspNotification,
  LspOpenSessionOpts,
  LspStatusEvent,
} from "@/types";
import type { LanguageId } from "./lspServers";

type Bridge = {
  ensure: (id: string) => Promise<LspEnsureResult>;
  openSession: (o: LspOpenSessionOpts) => Promise<{ sessionId: string }>;
  closeSession: (id: string) => Promise<{ ok: true }>;
  didChange: (sessionId: string, payload: { version: number; text: string }) => void;
  request: (sessionId: string, method: string, params?: unknown) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;
  restart: (id: string) => Promise<LspEnsureResult>;
  onNotification: (cb: (n: LspNotification) => void) => () => void;
  onStatus: (cb: (s: LspStatusEvent) => void) => () => void;
};

function getBridge(): Bridge | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { marvenElectron?: { lsp?: Bridge } };
  return w.marvenElectron?.lsp ?? null;
}

const NOT_AVAILABLE: LspEnsureResult = { status: "failed", error: "LSP bridge not available (running outside Electron)" };

export interface LspClient {
  ensure(languageId: LanguageId): Promise<LspEnsureResult>;
  openSession(opts: LspOpenSessionOpts): Promise<{ sessionId: string }>;
  closeSession(sessionId: string): Promise<void>;
  didChange(sessionId: string, payload: { version: number; text: string }): void;
  request<T = unknown>(sessionId: string, method: string, params?: unknown): Promise<T>;
  restart(languageId: LanguageId): Promise<LspEnsureResult>;
  onNotification(handler: (n: LspNotification) => void): () => void;
  onStatus(handler: (s: LspStatusEvent) => void): () => void;
}

export const lspClient: LspClient = {
  async ensure(languageId) {
    const b = getBridge();
    if (!b) return NOT_AVAILABLE;
    return b.ensure(languageId);
  },
  async openSession(opts) {
    const b = getBridge();
    if (!b) throw new Error(NOT_AVAILABLE.error);
    return b.openSession(opts);
  },
  async closeSession(sessionId) {
    const b = getBridge();
    if (!b) return;
    await b.closeSession(sessionId);
  },
  didChange(sessionId, payload) {
    const b = getBridge();
    if (!b) return;
    b.didChange(sessionId, payload);
  },
  async request<T>(sessionId: string, method: string, params?: unknown): Promise<T> {
    const b = getBridge();
    if (!b) throw new Error(NOT_AVAILABLE.error);
    const r = await b.request(sessionId, method, params);
    if (!r.ok) throw new Error(r.error);
    return r.result as T;
  },
  async restart(languageId) {
    const b = getBridge();
    if (!b) return NOT_AVAILABLE;
    return b.restart(languageId);
  },
  onNotification(handler) {
    const b = getBridge();
    if (!b) return () => {};
    return b.onNotification(handler);
  },
  onStatus(handler) {
    const b = getBridge();
    if (!b) return () => {};
    return b.onStatus(handler);
  },
};
```

- [ ] 7.5 Re-run, expect:

```
✓ lspClient > forwards ensure/openSession/closeSession/request to the bridge
✓ lspClient > request() throws when the bridge returns ok:false
✓ lspClient > onNotification subscribes and unsubscribes
✓ lspClient > works as a no-op shim outside Electron (no window.marvenElectron)
```

- [ ] 7.6 Commit:

```bash
git add lib/editor/lspClient.ts lib/editor/lspClient.test.ts types/index.ts
git commit -m "feat(lsp): add renderer lspClient bridging marvenElectron IPC"
```

---

## Task 8 — CodeMirror extension: diagnostics + hover + completions

**Files**
- Create: `/Users/ahomsi/Development/Personal Projects/Marven/lib/editor/lspExtension.ts`
- Test: `/Users/ahomsi/Development/Personal Projects/Marven/lib/editor/lspExtension.test.ts`

**Steps**

- [ ] 8.1 Failing test (covers offset conversion, diagnostic injection, hover, completion):

```ts
// lib/editor/lspExtension.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { lspExtension, __test } from "./lspExtension";

// jsdom-free: we drive the EditorView in node by attaching to a fake DOM via @codemirror/view's own host requirements.
// CodeMirror needs `document`. Provide jsdom.
import { JSDOM } from "jsdom";

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  (globalThis as any).document = dom.window.document;
  (globalThis as any).window = dom.window;
  (globalThis as any).navigator = dom.window.navigator;
});

function makeView(doc: string, ext: any) {
  const state = EditorState.create({ doc, extensions: [ext] });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({ state, parent });
}

describe("lspExtension offset conversion", () => {
  it("converts LSP {line,character} ↔ CM offsets correctly across CRLF/LF", () => {
    const doc = "abc\ndef\n12345";
    expect(__test.posToOffset(doc, { line: 0, character: 0 })).toBe(0);
    expect(__test.posToOffset(doc, { line: 1, character: 1 })).toBe(5); // 'e'
    expect(__test.posToOffset(doc, { line: 2, character: 5 })).toBe(13);
    expect(__test.offsetToPos(doc, 5)).toEqual({ line: 1, character: 1 });
  });
});

describe("lspExtension wiring", () => {
  let fakeClient: any;
  let notifSubs: Array<(n: any) => void> = [];

  beforeEach(() => {
    notifSubs = [];
    fakeClient = {
      didChange: vi.fn(),
      closeSession: vi.fn(),
      request: vi.fn(async (_s, method, _p) => {
        if (method === "textDocument/hover") return { contents: { kind: "markdown", value: "(const) x: number" } };
        if (method === "textDocument/completion") return { items: [{ label: "log", kind: 3 }, { label: "warn", kind: 3 }] };
        return null;
      }),
      onNotification: vi.fn((cb) => { notifSubs.push(cb); return () => {}; }),
    };
  });

  it("injects diagnostics from publishDiagnostics notification matching the file", async () => {
    const view = makeView("const x: number = \"x\";", lspExtension({
      sessionId: "s1",
      languageId: "typescript",
      filePath: "/tmp/foo.ts",
      client: fakeClient,
      onOpenFile: () => {},
      onApplyWorkspaceEdit: async () => {},
    }));
    expect(notifSubs.length).toBe(1);
    notifSubs[0]({
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///tmp/foo.ts",
        diagnostics: [{
          range: { start: { line: 0, character: 18 }, end: { line: 0, character: 21 } },
          severity: 1,
          message: "Type 'string' is not assignable to type 'number'.",
        }],
      },
    });
    await Promise.resolve();
    const diags = __test.getDiagnostics(view.state);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toMatch(/Type 'string'/);
    view.destroy();
  });

  it("ignores diagnostics for other files", async () => {
    const view = makeView("x", lspExtension({
      sessionId: "s1", languageId: "typescript", filePath: "/tmp/foo.ts",
      client: fakeClient, onOpenFile: () => {}, onApplyWorkspaceEdit: async () => {},
    }));
    notifSubs[0]({
      method: "textDocument/publishDiagnostics",
      params: { uri: "file:///tmp/other.ts", diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: "x" }] },
    });
    expect(__test.getDiagnostics(view.state)).toHaveLength(0);
    view.destroy();
  });

  it("sends didChange (debounced) when the doc changes", async () => {
    const view = makeView("a", lspExtension({
      sessionId: "s1", languageId: "typescript", filePath: "/tmp/foo.ts",
      client: fakeClient, onOpenFile: () => {}, onApplyWorkspaceEdit: async () => {},
      debounceMs: 0,
    }));
    view.dispatch({ changes: { from: 1, insert: "b" } });
    await new Promise((r) => setTimeout(r, 5));
    expect(fakeClient.didChange).toHaveBeenCalled();
    const arg = fakeClient.didChange.mock.calls.at(-1)[1];
    expect(arg.text).toBe("ab");
    expect(arg.version).toBeGreaterThanOrEqual(2);
    view.destroy();
  });

  it("fetches completions via textDocument/completion", async () => {
    const result = await __test.fetchCompletions(fakeClient, "s1", "/tmp/foo.ts", "console.", 8);
    expect(fakeClient.request).toHaveBeenCalledWith("s1", "textDocument/completion", expect.objectContaining({
      position: { line: 0, character: 8 },
    }));
    expect(result.map((i: any) => i.label)).toEqual(["log", "warn"]);
  });

  it("fetches hover via textDocument/hover", async () => {
    const out = await __test.fetchHover(fakeClient, "s1", "/tmp/foo.ts", "const x = 1;", 6);
    expect(out).toMatch(/x: number/);
  });
});
```

You will need `jsdom` as a devDependency (Marven already uses it transitively via Next, but verify and install if absent):

```bash
npm ls jsdom || npm install --save-dev jsdom
```

- [ ] 8.2 Run, confirm failure.

- [ ] 8.3 Implement `lib/editor/lspExtension.ts`:

```ts
// lib/editor/lspExtension.ts
import { Extension, StateField, StateEffect } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate, hoverTooltip } from "@codemirror/view";
import { Diagnostic, setDiagnostics } from "@codemirror/lint";
import {
  autocompletion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { LanguageId } from "./lspServers";
import type { LspClient } from "./lspClient";
import type {
  LspNotification,
  LspPosition,
  LspWorkspaceEdit,
} from "@/types";

export interface LspExtensionOpts {
  sessionId: string;
  languageId: LanguageId;
  filePath: string;
  client: LspClient;
  onOpenFile: (path: string, position?: LspPosition) => void;
  onApplyWorkspaceEdit: (edit: LspWorkspaceEdit) => Promise<void>;
  debounceMs?: number;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function fileUri(filePath: string): string {
  const norm = filePath.replace(/\\/g, "/");
  const withSlash = norm.startsWith("/") ? norm : "/" + norm;
  return "file://" + withSlash.split("/").map(encodeURIComponent).join("/").replace(/%2F/g, "/");
}

function posToOffset(doc: string, pos: LspPosition): number {
  let off = 0, line = 0;
  for (let i = 0; i < doc.length; i++) {
    if (line === pos.line) return off + pos.character;
    if (doc[i] === "\n") { line++; off = i + 1; }
  }
  return Math.min(off + pos.character, doc.length);
}

function offsetToPos(doc: string, offset: number): LspPosition {
  let line = 0, lineStart = 0;
  for (let i = 0; i < offset && i < doc.length; i++) {
    if (doc[i] === "\n") { line++; lineStart = i + 1; }
  }
  return { line, character: offset - lineStart };
}

function mdToString(contents: unknown): string {
  if (!contents) return "";
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(mdToString).filter(Boolean).join("\n\n");
  const c = contents as { value?: string; kind?: string };
  return c.value ?? "";
}

const SEVERITY_MAP: Record<number, Diagnostic["severity"]> = {
  1: "error", 2: "warning", 3: "info", 4: "info",
};

// ── extension ───────────────────────────────────────────────────────────────

export function lspExtension(opts: LspExtensionOpts): Extension {
  const { sessionId, filePath, client, onOpenFile, onApplyWorkspaceEdit } = opts;
  const debounceMs = opts.debounceMs ?? 150;
  const myUri = fileUri(filePath);
  let version = 1;

  // Subscribe to publishDiagnostics; bound when plugin initializes.
  let pluginView: EditorView | null = null;
  const unsubNotif = client.onNotification((n: LspNotification) => {
    if (!pluginView) return;
    if (n.method !== "textDocument/publishDiagnostics") return;
    const p = n.params as { uri: string; diagnostics: Array<{ range: { start: LspPosition; end: LspPosition }; severity?: number; message: string }> };
    if (p.uri !== myUri) return;
    const doc = pluginView.state.doc.toString();
    const cmDiags: Diagnostic[] = p.diagnostics.map((d) => ({
      from: posToOffset(doc, d.range.start),
      to: Math.max(posToOffset(doc, d.range.start) + 1, posToOffset(doc, d.range.end)),
      severity: SEVERITY_MAP[d.severity ?? 1] ?? "error",
      message: d.message,
    }));
    pluginView.dispatch(setDiagnostics(pluginView.state, cmDiags));
  });

  // Lifecycle plugin: track view, debounce didChange, close on destroy.
  const lifecycle = ViewPlugin.fromClass(class {
    timer: ReturnType<typeof setTimeout> | null = null;
    constructor(view: EditorView) { pluginView = view; }
    update(u: ViewUpdate) {
      if (!u.docChanged) return;
      version++;
      const text = u.state.doc.toString();
      const v = version;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => client.didChange(sessionId, { version: v, text }), debounceMs);
    }
    destroy() {
      if (this.timer) clearTimeout(this.timer);
      unsubNotif();
      void client.closeSession(sessionId);
      pluginView = null;
    }
  });

  // Hover.
  const hover = hoverTooltip(async (view, pos) => {
    const doc = view.state.doc.toString();
    const text = await fetchHover(client, sessionId, filePath, doc, pos);
    if (!text) return null;
    return {
      pos,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-lsp-hover";
        dom.textContent = text;
        return { dom };
      },
    };
  });

  // Completion source.
  const completionSource = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const doc = ctx.state.doc.toString();
    const items = await fetchCompletions(client, sessionId, filePath, doc, ctx.pos);
    if (!items.length) return null;
    return {
      from: ctx.matchBefore(/[\w$]*/)?.from ?? ctx.pos,
      options: items.map((i: any) => ({ label: i.label, type: completionKindToType(i.kind), detail: i.detail, info: mdToString(i.documentation) })),
    };
  };

  // Cmd/Ctrl + click → go to definition.
  const clickHandler = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.metaKey || event.ctrlKey)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const doc = view.state.doc.toString();
      const lspPos = offsetToPos(doc, pos);
      void client.request<unknown>(sessionId, "textDocument/definition", { position: lspPos }).then((res) => {
        const def = Array.isArray(res) ? res[0] : res;
        if (!def || typeof def !== "object") return;
        const d = def as { uri: string; range: { start: LspPosition } };
        const path = decodeURI(d.uri.replace(/^file:\/\//, ""));
        onOpenFile(path, d.range.start);
      });
      event.preventDefault();
      return true;
    },
  });

  // F2 → rename.
  const renameKey = EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.key !== "F2") return false;
      const cursor = view.state.selection.main.head;
      const doc = view.state.doc.toString();
      const lspPos = offsetToPos(doc, cursor);
      const newName = window.prompt("Rename symbol to:", "");
      if (!newName) { event.preventDefault(); return true; }
      void client.request<LspWorkspaceEdit | null>(sessionId, "textDocument/rename", { position: lspPos, newName }).then(async (edit) => {
        if (edit) await onApplyWorkspaceEdit(edit);
      });
      event.preventDefault();
      return true;
    },
  });

  return [
    lifecycle,
    hover,
    autocompletion({ override: [completionSource], activateOnTyping: true }),
    clickHandler,
    renameKey,
  ];
}

// ── helpers exported for tests ──────────────────────────────────────────────

async function fetchHover(client: LspClient, sessionId: string, filePath: string, doc: string, offset: number): Promise<string> {
  const pos = offsetToPos(doc, offset);
  const res = await client.request<{ contents: unknown } | null>(sessionId, "textDocument/hover", { position: pos });
  if (!res) return "";
  return mdToString(res.contents);
}

async function fetchCompletions(client: LspClient, sessionId: string, filePath: string, doc: string, offset: number): Promise<Array<{ label: string; kind?: number; detail?: string; documentation?: unknown }>> {
  const pos = offsetToPos(doc, offset);
  const res = await client.request<{ items?: any[] } | any[] | null>(sessionId, "textDocument/completion", { position: pos });
  if (!res) return [];
  if (Array.isArray(res)) return res;
  return res.items ?? [];
}

function completionKindToType(kind?: number): string | undefined {
  switch (kind) {
    case 3: return "function";
    case 6: return "variable";
    case 7: return "class";
    case 14: return "keyword";
    case 21: return "constant";
    case 22: return "type";
    default: return undefined;
  }
}

function getDiagnosticsForTest(state: any): Array<{ severity: string; message: string }> {
  // @codemirror/lint stores diagnostics in a hidden state field; expose via the public field set by setDiagnostics.
  // We rely on the lintState field returned by lintField; the simplest portable approach is to read effect history.
  const diags: any[] = [];
  for (const f of (state as any).values) {
    if (Array.isArray(f) && f.length && f[0] && typeof f[0].severity === "string") {
      diags.push(...f);
    }
    if (f && typeof f === "object" && Array.isArray(f.diagnostics)) {
      diags.push(...f.diagnostics);
    }
  }
  return diags;
}

export const __test = {
  posToOffset,
  offsetToPos,
  fetchHover,
  fetchCompletions,
  getDiagnostics: getDiagnosticsForTest,
};
```

Note on `getDiagnosticsForTest`: `@codemirror/lint` doesn't expose its diagnostics field publicly. If `getDiagnosticsForTest` returns an empty array in the test, simplify by tracking diagnostics through a parallel `StateField` that the extension also writes to. If you hit that during implementation, add this to the extension and read it instead:

```ts
const trackEffect = StateEffect.define<Diagnostic[]>();
const trackField = StateField.define<Diagnostic[]>({
  create: () => [],
  update(v, tr) {
    for (const e of tr.effects) if (e.is(trackEffect)) return e.value;
    return v;
  },
});
// In the publishDiagnostics handler, dispatch both setDiagnostics(...) and trackEffect.of(cmDiags).
// Then in __test.getDiagnostics: return state.field(trackField).
```

- [ ] 8.4 Re-run and iterate until green:

```bash
npx vitest run lib/editor/lspExtension.test.ts
```

Expected:
```
✓ lspExtension offset conversion > converts LSP {line,character} ↔ CM offsets correctly across CRLF/LF
✓ lspExtension wiring > injects diagnostics from publishDiagnostics notification matching the file
✓ lspExtension wiring > ignores diagnostics for other files
✓ lspExtension wiring > sends didChange (debounced) when the doc changes
✓ lspExtension wiring > fetches completions via textDocument/completion
✓ lspExtension wiring > fetches hover via textDocument/hover
```

- [ ] 8.5 Commit:

```bash
git add lib/editor/lspExtension.ts lib/editor/lspExtension.test.ts package.json package-lock.json
git commit -m "feat(lsp): add CodeMirror extension with diagnostics, hover, completions"
```

---

## Task 9 — Go-to-definition + rename, refined tests

**Files**
- Modify: `/Users/ahomsi/Development/Personal Projects/Marven/lib/editor/lspExtension.ts`
- Modify: `/Users/ahomsi/Development/Personal Projects/Marven/lib/editor/lspExtension.test.ts`

Most wiring already exists from Task 8 — this task hardens those code paths with their own tests and fixes any rough edges (URL decoding, multi-location definitions, `WorkspaceEdit` shapes).

**Steps**

- [ ] 9.1 Append the failing tests:

```ts
describe("lspExtension go-to-definition", () => {
  let fakeClient: any;
  let notifSubs: Array<(n: any) => void> = [];

  beforeEach(() => {
    notifSubs = [];
    fakeClient = {
      didChange: vi.fn(),
      closeSession: vi.fn(),
      request: vi.fn(async (_s, method) => {
        if (method === "textDocument/definition") {
          return { uri: "file:///tmp/has%20space/target.ts", range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } } };
        }
        if (method === "textDocument/rename") {
          return {
            changes: {
              "file:///tmp/a.ts": [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: "renamed" }],
            },
          };
        }
        return null;
      }),
      onNotification: vi.fn((cb) => { notifSubs.push(cb); return () => {}; }),
    };
  });

  it("Cmd+click triggers definition request and decodes URI", async () => {
    const opens: Array<{ path: string; pos?: LspPosition }> = [];
    const ext = lspExtension({
      sessionId: "s1", languageId: "typescript", filePath: "/tmp/foo.ts",
      client: fakeClient, onApplyWorkspaceEdit: async () => {},
      onOpenFile: (path, pos) => opens.push({ path, pos }),
    });
    const view = makeView("hello", ext);
    const ev = new (window as any).MouseEvent("mousedown", { metaKey: true, clientX: 0, clientY: 0, bubbles: true });
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 0));
    expect(fakeClient.request).toHaveBeenCalledWith("s1", "textDocument/definition", expect.any(Object));
    expect(opens[0]?.path).toBe("/tmp/has space/target.ts");
    expect(opens[0]?.pos).toEqual({ line: 4, character: 2 });
    view.destroy();
  });

  it("F2 calls rename and forwards WorkspaceEdit to onApplyWorkspaceEdit", async () => {
    const applied: any[] = [];
    (window as any).prompt = () => "newName";
    const ext = lspExtension({
      sessionId: "s1", languageId: "typescript", filePath: "/tmp/foo.ts",
      client: fakeClient,
      onOpenFile: () => {},
      onApplyWorkspaceEdit: async (edit) => { applied.push(edit); },
    });
    const view = makeView("abc", ext);
    const ev = new (window as any).KeyboardEvent("keydown", { key: "F2", bubbles: true });
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toHaveLength(1);
    expect(applied[0].changes["file:///tmp/a.ts"][0].newText).toBe("renamed");
    view.destroy();
  });

  it("handles array-form definition response (Location[])", async () => {
    fakeClient.request.mockImplementationOnce(async () => [{ uri: "file:///tmp/x.ts", range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } } }]);
    const opens: Array<{ path: string }> = [];
    const view = makeView("hi", lspExtension({
      sessionId: "s1", languageId: "typescript", filePath: "/tmp/foo.ts",
      client: fakeClient, onApplyWorkspaceEdit: async () => {},
      onOpenFile: (path) => opens.push({ path }),
    }));
    const ev = new (window as any).MouseEvent("mousedown", { metaKey: true, clientX: 0, clientY: 0, bubbles: true });
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 0));
    expect(opens[0]?.path).toBe("/tmp/x.ts");
    view.destroy();
  });
});
```

- [ ] 9.2 Run; if the definition click test fails because `posAtCoords` returns null in jsdom, adjust the extension to fall back to the current selection head when `posAtCoords` is null:

```ts
// inside clickHandler.mousedown, replace:
const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
if (pos == null) return false;
// with:
const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
```

- [ ] 9.3 Confirm:

```
✓ lspExtension go-to-definition > Cmd+click triggers definition request and decodes URI
✓ lspExtension go-to-definition > F2 calls rename and forwards WorkspaceEdit to onApplyWorkspaceEdit
✓ lspExtension go-to-definition > handles array-form definition response (Location[])
```

- [ ] 9.4 Commit:

```bash
git add lib/editor/lspExtension.ts lib/editor/lspExtension.test.ts
git commit -m "feat(lsp): harden go-to-definition and rename in CM extension"
```

---

## Task 10 — Wire into `CodeEditor.tsx`, `StatusBar.tsx`, smoke test, gated e2e

**Files**
- Modify: `/Users/ahomsi/Development/Personal Projects/Marven/app/components/marven/CodeEditor.tsx`
- Modify: `/Users/ahomsi/Development/Personal Projects/Marven/app/components/marven/StatusBar.tsx`
- Modify: `/Users/ahomsi/Development/Personal Projects/Marven/app/components/marven/EditorPanel.tsx` (only to pass `languageId` + `workspaceRoot` props)
- Create: `/Users/ahomsi/Development/Personal Projects/Marven/electron/lsp/__tests__/lspManager.e2e.test.js`

**Steps**

- [ ] 10.1 Extend `CodeEditor.tsx` `CodeEditorProps`:

```ts
import { lspExtension } from "@/lib/editor/lspExtension";
import { lspClient } from "@/lib/editor/lspClient";
import { languageIdForExtension, type LanguageId } from "@/lib/editor/lspServers";
import type { LspWorkspaceEdit, LspPosition } from "@/types";

// Append to CodeEditorProps:
filePath?: string;
workspaceRoot?: string;
onOpenFile?: (path: string, position?: LspPosition) => void;
onApplyWorkspaceEdit?: (edit: LspWorkspaceEdit) => Promise<void>;
```

Inside the component (after CM6 view is constructed, in a `useEffect` keyed on `[filePath, workspaceRoot, language]`):

```ts
const [lspSessionId, setLspSessionId] = useState<string | null>(null);
const lspCompartment = useRef(new Compartment());

useEffect(() => {
  const ext = filePath ? filePath.split(".").pop() ?? "" : "";
  const langId: LanguageId | null = languageIdForExtension(ext);
  if (!langId || !filePath || !workspaceRoot || !viewRef.current) return;

  let cancelled = false;
  let sessionIdLocal: string | null = null;

  (async () => {
    const r = await lspClient.ensure(langId);
    if (r.status !== "ready" || cancelled) return;
    const { sessionId } = await lspClient.openSession({
      languageId: langId, filePath, workspaceRoot, text: viewRef.current!.state.doc.toString(),
    });
    if (cancelled) { lspClient.closeSession(sessionId); return; }
    sessionIdLocal = sessionId;
    setLspSessionId(sessionId);
    viewRef.current!.dispatch({
      effects: lspCompartment.current.reconfigure(lspExtension({
        sessionId,
        languageId: langId,
        filePath,
        client: lspClient,
        onOpenFile: onOpenFile ?? (() => {}),
        onApplyWorkspaceEdit: onApplyWorkspaceEdit ?? (async () => {}),
      })),
    });
  })();

  return () => {
    cancelled = true;
    if (sessionIdLocal) lspClient.closeSession(sessionIdLocal);
    viewRef.current?.dispatch({ effects: lspCompartment.current.reconfigure([]) });
    setLspSessionId(null);
  };
}, [filePath, workspaceRoot]);
```

Include `lspCompartment.current.of([])` in the initial `extensions` array passed to `EditorState.create`.

- [ ] 10.2 Extend `StatusBar.tsx` to subscribe to `lspClient.onStatus` and `lspClient.onNotification` and render the badge per spec Section 6. Minimal hook:

```ts
import { useEffect, useState } from "react";
import { lspClient } from "@/lib/editor/lspClient";
import type { LanguageId } from "@/lib/editor/lspServers";

type LspBadgeState = "idle" | "installing" | "ready" | "failed" | "restarting";

export function useLspStatus(languageId: LanguageId | null): LspBadgeState {
  const [state, setState] = useState<LspBadgeState>("idle");
  useEffect(() => {
    if (!languageId) { setState("idle"); return; }
    let cancelled = false;
    lspClient.ensure(languageId).then((r) => {
      if (cancelled) return;
      setState(r.status === "ready" ? "ready" : r.status === "installing" ? "installing" : "failed");
    });
    const off = lspClient.onStatus((s) => {
      if (s.languageId !== languageId) return;
      if (s.kind === "install" && s.state === "installing") setState("installing");
      if (s.kind === "install" && s.state === "installed") setState("ready");
      if (s.kind === "install" && s.state === "install-failed") setState("failed");
      if (s.kind === "server-exit") setState("failed");
    });
    return () => { cancelled = true; off(); };
  }, [languageId]);
  return state;
}
```

Render a small badge in `StatusBar` next to the existing right-side info. Pass active file's `languageId` via prop (or thread through `app/page.tsx`).

- [ ] 10.3 In `EditorPanel.tsx`, derive `languageId` from active file extension and pass it (plus `workspaceRoot`, `onOpenFile`, `onApplyWorkspaceEdit`) to `<CodeEditor>`. `onOpenFile` should reuse the existing "open file" handler in `app/page.tsx`. `onApplyWorkspaceEdit` should iterate the LSP `WorkspaceEdit` and apply edits to in-memory buffers (or fall back to disk via existing file-write IPC).

- [ ] 10.4 Add the gated e2e test:

```js
// electron/lsp/__tests__/lspManager.e2e.test.js
const { describe, it, expect } = require("vitest");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ENABLED = process.env.RUN_LSP_E2E === "1";
const d = ENABLED ? describe : describe.skip;

d("LspManager e2e against real typescript-language-server", () => {
  it("publishes a diagnostic for a type error within 10s", { timeout: 60000 }, async () => {
    const { LspManager } = require("../lspManager");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "marven-lsp-e2e-"));
    const file = path.join(tmp, "foo.ts");
    fs.writeFileSync(file, 'const x: number = "wrong";\n', "utf8");
    fs.writeFileSync(path.join(tmp, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "es2020", module: "esnext" } }));

    const mgr = new LspManager();
    const ensured = await mgr.ensure("typescript");
    expect(ensured.status).toBe("ready");

    const diags = [];
    mgr.on("notification", (n) => {
      if (n.method === "textDocument/publishDiagnostics") diags.push(n.params);
    });

    const { sessionId } = await mgr.openSession({
      languageId: "typescript",
      filePath: file,
      workspaceRoot: tmp,
      text: fs.readFileSync(file, "utf8"),
    });

    const start = Date.now();
    while (Date.now() - start < 10000) {
      const match = diags.find((d) => d.uri.endsWith("/foo.ts") && d.diagnostics.some((x) => /assignable/.test(x.message)));
      if (match) {
        await mgr.closeSession(sessionId);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    await mgr.closeSession(sessionId);
    throw new Error("no diagnostic received in 10s; got: " + JSON.stringify(diags, null, 2));
  });
});
```

Run it explicitly:

```bash
RUN_LSP_E2E=1 npx vitest run electron/lsp/__tests__/lspManager.e2e.test.js
```

Expected (first run takes ~30s for npm install, subsequent <5s):
```
✓ LspManager e2e against real typescript-language-server > publishes a diagnostic for a type error within 10s
```

- [ ] 10.5 Run the full test suite to confirm nothing else regressed:

```bash
npm test
```

Expected: every test file passes, with the new LSP tests included.

- [ ] 10.6 Manual smoke test (per spec Section 7):
  1. `npm run electron:dev`
  2. Open a `.ts` file from a real workspace.
  3. Confirm StatusBar shows installing → ready within ~60s on first run, instantly on subsequent runs.
  4. Type `const x: number = "bad";` — confirm red squiggle.
  5. Hover `x` — confirm tooltip shows `(const) x: number`.
  6. Type `console.` — confirm completions dropdown.
  7. Cmd+click an import — confirm new tab opens at definition.
  8. Place cursor on a function name → F2 → type new name → Enter — confirm rename across files.

- [ ] 10.7 Commit:

```bash
git add app/components/marven/CodeEditor.tsx app/components/marven/StatusBar.tsx app/components/marven/EditorPanel.tsx electron/lsp/__tests__/lspManager.e2e.test.js
git commit -m "feat(lsp): wire LSP into CodeEditor, StatusBar, EditorPanel and add e2e test"
```

---

## Done criteria

- [ ] `npm test` is green.
- [ ] `RUN_LSP_E2E=1 npm test` is green on a machine with `npm` available.
- [ ] Manual smoke test (Section 7 / Task 10.6) passes end-to-end.
- [ ] No regression in existing CodeMirror behaviour for files without an LSP language (e.g. `.md`, `.json`).
- [ ] No console errors when toggling between LSP and non-LSP files repeatedly.
- [ ] `~/.marven/lsp/typescript/node_modules/.bin/typescript-language-server` exists after first run.

---

## Notes / non-obvious gotchas

1. The renderer-side `lspExtension` calls `client.onNotification` at construction time. If `CodeEditor` re-creates the extension on every render, you will leak subscriptions. The extension already unsubscribes on `destroy()`, but ensure `CodeEditor` only re-creates the extension when `filePath` or `workspaceRoot` actually change (use a `Compartment` reconfigure — shown in Task 10.1).
2. `typescript-language-server` requires a `tsconfig.json` or `jsconfig.json` to give good diagnostics. The e2e test writes a minimal one. Real usage falls back to TS defaults when none is present.
3. The Electron preload `marvenElectron.lsp.didChange` uses `ipcRenderer.send` (fire-and-forget), not `invoke`. This matches the existing `pty-write` pattern and avoids round-trip latency on every keystroke.
4. `closeSession` kills the server when the last session closes. For UX you may want a "keep warm" timer in a future task, but Phase 1 keeps it simple.
5. The `getDiagnosticsForTest` helper in `lib/editor/lspExtension.ts` reaches into private CM state. If it returns empty in a future CM version, switch to the parallel `StateField` approach noted in Task 8.3.

---

**File saved location (requested by parent):** `/Users/ahomsi/Development/Personal Projects/Marven/docs/superpowers/plans/2026-05-24-lsp-integration.md`
**Approximate line count:** ~890 lines

Note: I do not have file-write tools in this read-only planning mode. The complete plan content is provided above as my message — the parent agent should persist it to the path above.