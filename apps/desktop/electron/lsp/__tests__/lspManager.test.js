import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// We inject a fake spawn into LspManager instead of mocking child_process,
// because the manager is a CJS module and vi.mock would not intercept its require().
let fakeSpawn;

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => child.emit("exit", 0, null));
  child.pid = 4242;
  return child;
}

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
    fakeSpawn = vi.fn(() => makeFakeChild());
    ({ LspManager } = require("../lspManager"));
    mgr = new LspManager({
      installRoot: "/tmp/marven-lsp-test",
      // Pretend the bin is already installed so we can test transport in isolation.
      isInstalled: () => true,
      spawnFn: fakeSpawn,
    });
  });

  it("spawns the server process when ensure() runs and bin exists", async () => {
    const result = await mgr.ensure("typescript");
    expect(result.status).toBe("ready");
    expect(fakeSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args] = fakeSpawn.mock.calls[0];
    expect(cmd).toMatch(/typescript-language-server$/);
    expect(args).toEqual(["--stdio"]);
  });

  it("sends framed JSON-RPC on request() and resolves with the matching response", async () => {
    await mgr.ensure("typescript");
    const child = fakeSpawn.mock.results[0].value;

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
    const child = fakeSpawn.mock.results[0].value;

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
    const child = fakeSpawn.mock.results[0].value;

    const exits = [];
    mgr.on("server-exit", (e) => exits.push(e));

    const pending = mgr._sendRequest("typescript", "ping", {});
    child.emit("exit", 1, null);

    await expect(pending).rejects.toThrow(/exited/);
    expect(exits).toEqual([{ languageId: "typescript", code: 1, signal: null }]);
  });
});

describe("LspManager (install)", () => {
  let LspManager;
  beforeEach(() => {
    vi.resetModules();
    ({ LspManager } = require("../lspManager"));
  });

  it("returns ready immediately when bin already installed", async () => {
    const runInstall = vi.fn();
    const mgr = new LspManager({
      installRoot: "/tmp/marven-lsp-test",
      isInstalled: () => true,
      runInstall,
      spawnFn: vi.fn(() => makeFakeChild()),
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
      spawnFn: vi.fn(() => makeFakeChild()),
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
      spawnFn: vi.fn(() => makeFakeChild()),
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
      spawnFn: vi.fn(() => makeFakeChild()),
    });
    const [a, b] = await Promise.all([mgr.ensure("typescript"), mgr.ensure("typescript")]);
    expect(a.status).toBe("ready");
    expect(b.status).toBe("ready");
    expect(runInstall).toHaveBeenCalledTimes(1);
    expect(maxInflight).toBe(1);
  });
});

describe("LspManager (sessions + handshake)", () => {
  let mgr, child, LspManager;
  let localFakeSpawn;

  beforeEach(async () => {
    vi.resetModules();
    ({ LspManager } = require("../lspManager"));
    localFakeSpawn = vi.fn(() => makeFakeChild());
    mgr = new LspManager({
      installRoot: "/tmp/marven-lsp-test",
      isInstalled: () => true,
      spawnFn: localFakeSpawn,
    });
    await mgr.ensure("typescript");
    child = localFakeSpawn.mock.results[0].value;
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

describe("LspManager (idle shutdown + exit cleanup)", () => {
  let LspManager;
  let spawnFn;

  beforeEach(() => {
    vi.resetModules();
    ({ LspManager } = require("../lspManager"));
    spawnFn = vi.fn(() => makeFakeChild());
  });

  function framesOf(c) {
    return c.stdin.write.mock.calls.map(([buf]) => {
      const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
      const sep = b.indexOf("\r\n\r\n");
      return JSON.parse(b.slice(sep + 4).toString("utf8"));
    });
  }

  // Open a session, answering initialize on whichever child is current.
  async function open(mgr, filePath) {
    const p = mgr.openSession({ languageId: "typescript", filePath, workspaceRoot: "/tmp" });
    // Let ensure()/spawn run if the server isn't up yet.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const child = spawnFn.mock.results.at(-1).value;
    const init = framesOf(child).find((f) => f.method === "initialize");
    if (init && !child.__answered) {
      child.__answered = true;
      child.stdout.emit("data", frame({ jsonrpc: "2.0", id: init.id, result: { capabilities: {} } }));
    }
    return p;
  }

  it("keeps the server alive across close-then-open (file switch)", async () => {
    vi.useFakeTimers();
    try {
      const mgr = new LspManager({ installRoot: "/tmp/x", isInstalled: () => true, spawnFn, idleShutdownMs: 30_000 });
      const { sessionId: a } = await open(mgr, "/tmp/a.ts");
      const child = spawnFn.mock.results[0].value;

      await mgr.closeSession(a);
      expect(child.kill).not.toHaveBeenCalled();

      const { sessionId: b } = await open(mgr, "/tmp/b.ts");
      vi.advanceTimersByTime(60_000);

      expect(child.kill).not.toHaveBeenCalled();
      expect(spawnFn).toHaveBeenCalledTimes(1);
      const didOpens = framesOf(child).filter((f) => f.method === "textDocument/didOpen");
      expect(didOpens.map((f) => f.params.textDocument.uri)).toEqual(["file:///tmp/a.ts", "file:///tmp/b.ts"]);
      expect(mgr.listSessions().map((s) => s.sessionId)).toEqual([b]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("kills the server after the idle grace period when nothing reopens", async () => {
    vi.useFakeTimers();
    try {
      const mgr = new LspManager({ installRoot: "/tmp/x", isInstalled: () => true, spawnFn, idleShutdownMs: 30_000 });
      const { sessionId } = await open(mgr, "/tmp/a.ts");
      const child = spawnFn.mock.results[0].value;

      await mgr.closeSession(sessionId);
      vi.advanceTimersByTime(29_999);
      expect(child.kill).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(mgr._servers.has("typescript")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("respawns on the next openSession after the server exits, and drops its sessions", async () => {
    const mgr = new LspManager({ installRoot: "/tmp/x", isInstalled: () => true, spawnFn });
    const { sessionId: a } = await open(mgr, "/tmp/a.ts");
    const first = spawnFn.mock.results[0].value;

    first.emit("exit", 1, null);
    expect(mgr._servers.has("typescript")).toBe(false);
    expect(mgr.listSessions()).toEqual([]);
    await expect(mgr.request(a, "textDocument/hover", {})).rejects.toThrow(/unknown sessionId/);
    await expect(mgr.closeSession(a)).resolves.toBeUndefined();

    const { sessionId: b } = await open(mgr, "/tmp/b.ts");
    expect(spawnFn).toHaveBeenCalledTimes(2);
    const second = spawnFn.mock.results[1].value;
    expect(framesOf(second).some((f) => f.method === "initialize")).toBe(true);
    expect(mgr.listSessions().map((s) => s.sessionId)).toEqual([b]);
  });

  it("ignores a late exit from a replaced server", async () => {
    const mgr = new LspManager({ installRoot: "/tmp/x", isInstalled: () => true, spawnFn });
    await mgr.ensure("typescript");
    const first = spawnFn.mock.results[0].value;
    first.kill = vi.fn(); // the exit arrives later, not synchronously
    const restarting = mgr.restart("typescript");
    first.emit("exit", null, "SIGTERM");
    await restarting;
    expect(spawnFn).toHaveBeenCalledTimes(2);
    const second = spawnFn.mock.results[1].value;

    const exits = [];
    mgr.on("server-exit", (e) => exits.push(e));
    first.emit("exit", null, "SIGTERM"); // duplicate/late exit from the old child
    expect(mgr._servers.get("typescript").child).toBe(second);
    expect(exits).toEqual([]);
  });

  it("dispose() kills every server and refuses to spawn more", async () => {
    const mgr = new LspManager({ installRoot: "/tmp/x", isInstalled: () => true, spawnFn });
    await open(mgr, "/tmp/a.ts");
    const child = spawnFn.mock.results[0].value;

    mgr.dispose();
    expect(child.kill).toHaveBeenCalled();
    expect(mgr._servers.size).toBe(0);
    expect(mgr.listSessions()).toEqual([]);
    const r = await mgr.ensure("typescript");
    expect(r.status).toBe("failed");
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });
});
