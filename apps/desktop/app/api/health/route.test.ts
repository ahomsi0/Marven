import { afterEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { GET } from "./route";

function makeReq(token?: string): NextRequest {
  return {
    headers: new Headers(token ? { "x-marven-health-token": token } : undefined),
  } as unknown as NextRequest;
}

const originalToken = process.env.MARVEN_HEALTH_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.MARVEN_HEALTH_TOKEN;
  else process.env.MARVEN_HEALTH_TOKEN = originalToken;
});

describe("GET /api/health", () => {
  it("requires the per-launch token when production startup configured one", async () => {
    process.env.MARVEN_HEALTH_TOKEN = "test-token";

    expect((await GET(makeReq())).status).toBe(401);
    expect((await GET(makeReq("wrong-token"))).status).toBe(401);
    expect((await GET(makeReq("test-token"))).status).toBe(200);
  });
});
