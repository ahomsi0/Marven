import { describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { POST } from "./route";

function makeReq(body: unknown): NextRequest {
  return {
    url: "http://localhost:47891/api/system",
    headers: new Headers(),
    json: async () => body,
  } as unknown as NextRequest;
}

describe("POST /api/system", () => {
  it("rejects shell metacharacters in open-app names before spawning", async () => {
    const res = await POST(makeReq({ action: "open-app", payload: "$(touch /tmp/marven-pwned)" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid application name" });
  });
});
