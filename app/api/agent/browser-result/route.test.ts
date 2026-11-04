// app/api/agent/browser-result/route.test.ts
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { registerBrowserCall } from "@/lib/agent/browserBridge";

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/agent/browser-result", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/agent/browser-result", () => {
  it("resolves the waiting call", async () => {
    const waiting = registerBrowserCall("r1", "run1");
    const res = await post({ callId: "r1", result: { kind: "ok", text: "done" } });
    expect(res.status).toBe(200);
    await expect(waiting).resolves.toEqual({ kind: "ok", text: "done" });
  });

  it("rejects unknown calls and bad results", async () => {
    expect((await post({ callId: "nope", result: { kind: "ok", text: "x" } })).status).toBe(404);
    registerBrowserCall("r2", "run1");
    expect((await post({ callId: "r2", result: { kind: "nonsense" } })).status).toBe(400);
    expect((await post({ result: { kind: "ok", text: "x" } })).status).toBe(400);
  });
});
