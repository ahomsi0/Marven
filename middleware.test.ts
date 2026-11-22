import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, middleware } from "./middleware";

const TOKEN = "0123456789abcdef".repeat(4);

function apiReq(path: string, headers: Record<string, string> = {}, method = "POST"): NextRequest {
  return new NextRequest(`http://127.0.0.1:47891${path}`, {
    method,
    headers: { host: "localhost:47891", ...headers },
  });
}

// NextResponse.next() marks the request as passed on to the route.
const passedThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("middleware API token check", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.MARVEN_API_TOKEN;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.MARVEN_API_TOKEN;
    else process.env.MARVEN_API_TOKEN = prev;
  });

  describe("with MARVEN_API_TOKEN set (packaged app)", () => {
    beforeEach(() => {
      process.env.MARVEN_API_TOKEN = TOKEN;
    });

    it("rejects a request with no token (e.g. curl from another local program)", async () => {
      const res = middleware(apiReq("/api/mcp"));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Missing API token" });
    });

    it("rejects a wrong token", () => {
      const res = middleware(apiReq("/api/workspace/files", { "x-marven-token": "f".repeat(64) }, "PATCH"));
      expect(res.status).toBe(403);
    });

    it("allows the right token", () => {
      const res = middleware(apiReq("/api/mcp", { "x-marven-token": TOKEN }));
      expect(passedThrough(res)).toBe(true);
    });

    it("checks GETs too", () => {
      expect(middleware(apiReq("/api/health", {}, "GET")).status).toBe(403);
      expect(passedThrough(middleware(apiReq("/api/health", { "x-marven-token": TOKEN }, "GET")))).toBe(true);
    });

    it("still applies the Origin and Host checks with a valid token", () => {
      expect(middleware(apiReq("/api/mcp", { "x-marven-token": TOKEN, origin: "https://evil.example" })).status).toBe(403);
      expect(middleware(apiReq("/api/mcp", { "x-marven-token": TOKEN, host: "evil.com:47891" })).status).toBe(403);
    });

    it("leaves non-API paths alone", () => {
      expect(passedThrough(middleware(apiReq("/", {}, "GET")))).toBe(true);
    });
  });

  describe("without MARVEN_API_TOKEN (dev: separate next dev process)", () => {
    beforeEach(() => {
      delete process.env.MARVEN_API_TOKEN;
    });

    it("keeps today's behaviour: no Origin, loopback Host is allowed", () => {
      expect(passedThrough(middleware(apiReq("/api/mcp")))).toBe(true);
    });

    it("still rejects cross-origin and non-loopback Host requests", () => {
      expect(middleware(apiReq("/api/mcp", { origin: "https://evil.example" })).status).toBe(403);
      expect(middleware(apiReq("/api/mcp", { host: "evil.com:47891" })).status).toBe(403);
    });
  });

  it("runs in the Node.js runtime so it reads the per-launch env var", () => {
    expect(config.runtime).toBe("nodejs");
    expect(config.matcher).toEqual(["/api/:path*"]);
  });
});
