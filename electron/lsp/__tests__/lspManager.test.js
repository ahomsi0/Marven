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
