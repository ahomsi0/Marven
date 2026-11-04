// app/api/agent/browser-result/route.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { cancelBrowserCalls, hasBrowserCall, registerBrowserCall } from "@/lib/agent/browserBridge";

const postRaw = (body: string) =>
  POST(new NextRequest("http://localhost/api/agent/browser-result", { method: "POST", body }));
const post = (body: unknown) => postRaw(JSON.stringify(body));

// Don't leave a registry entry (and its 30-minute timer) behind.
afterEach(() => cancelBrowserCalls("run1"));

describe("POST /api/agent/browser-result", () => {
  it("resolves the waiting call", async () => {
    const waiting = registerBrowserCall("r1", "run1");
    const res = await post({ callId: "r1", runId: "run1", result: { kind: "ok", text: "done" } });
    expect(res.status).toBe(200);
    await expect(waiting).resolves.toEqual({ kind: "ok", text: "done" });
  });

  it("rejects unknown calls and bad results", async () => {
    expect((await post({ callId: "nope", runId: "run1", result: { kind: "ok", text: "x" } })).status).toBe(404);
    registerBrowserCall("r2", "run1");
    expect((await post({ callId: "r2", runId: "run1", result: { kind: "nonsense" } })).status).toBe(400);
    expect((await post({ runId: "run1", result: { kind: "ok", text: "x" } })).status).toBe(400);
  });

  it("requires the runId that owns the call", async () => {
    registerBrowserCall("r3", "run1");
    expect((await post({ callId: "r3", result: { kind: "ok", text: "x" } })).status).toBe(400);
    expect((await post({ callId: "r3", runId: "other", result: { kind: "ok", text: "x" } })).status).toBe(404);
    expect(hasBrowserCall("r3")).toBe(true);
  });

  it("rejects a body that isn't a JSON object", async () => {
    expect((await postRaw("null")).status).toBe(400);
    expect((await postRaw("42")).status).toBe(400);
    expect((await postRaw("not json")).status).toBe(400);
  });
});
