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
