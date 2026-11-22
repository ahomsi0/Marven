import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import {
  API_TOKEN_HEADER,
  apiTokenRejection,
  constantTimeEqual,
  crossOriginRejection,
  hostHeaderRejection,
} from "./apiGuards";

function reqWithOrigin(origin: string | null): NextRequest {
  return {
    url: "http://localhost:47891/api/test",
    headers: { get: (k: string) => (k.toLowerCase() === "origin" ? origin : null) },
  } as unknown as NextRequest;
}

function reqWithHost(host: string | null): NextRequest {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === "host" ? host : null) },
  } as unknown as NextRequest;
}

describe("crossOriginRejection", () => {
  it("allows requests with no Origin header (same-origin GET / non-browser)", () => {
    expect(crossOriginRejection(reqWithOrigin(null))).toBeNull();
  });

  it("allows the app origin and its loopback alias", () => {
    expect(crossOriginRejection(reqWithOrigin("http://localhost:47891"))).toBeNull();
    expect(crossOriginRejection(reqWithOrigin("http://127.0.0.1:47891"))).toBeNull();
  });

  it("rejects a local origin on a different port", () => {
    expect(crossOriginRejection(reqWithOrigin("http://localhost:3000"))).toMatch(/cross-origin/i);
    expect(crossOriginRejection(reqWithOrigin("http://127.0.0.1:8080"))).toMatch(/cross-origin/i);
  });

  it("rejects foreign origins", () => {
    expect(crossOriginRejection(reqWithOrigin("http://evil.com"))).toMatch(/cross-origin/i);
    expect(crossOriginRejection(reqWithOrigin("https://attacker.example"))).toMatch(/cross-origin/i);
  });

  it("rejects a malformed Origin", () => {
    expect(crossOriginRejection(reqWithOrigin("not a url"))).toMatch(/invalid/i);
  });
});

describe("hostHeaderRejection", () => {
  it("allows loopback hosts with the ports the app actually serves on", () => {
    expect(hostHeaderRejection(reqWithHost("localhost:3000"))).toBeNull();
    expect(hostHeaderRejection(reqWithHost("localhost:47891"))).toBeNull();
    expect(hostHeaderRejection(reqWithHost("127.0.0.1:47891"))).toBeNull();
    expect(hostHeaderRejection(reqWithHost("[::1]:47891"))).toBeNull();
    expect(hostHeaderRejection(reqWithHost("LOCALHOST:3000"))).toBeNull();
  });

  it("allows loopback hosts without a port", () => {
    expect(hostHeaderRejection(reqWithHost("localhost"))).toBeNull();
    expect(hostHeaderRejection(reqWithHost("127.0.0.1"))).toBeNull();
    expect(hostHeaderRejection(reqWithHost("[::1]"))).toBeNull();
  });

  it("rejects a missing Host header", () => {
    expect(hostHeaderRejection(reqWithHost(null))).toMatch(/missing/i);
  });

  it("rejects non-loopback hosts, including rebinding-style names", () => {
    expect(hostHeaderRejection(reqWithHost("evil.com:47891"))).toMatch(/non-loopback/i);
    expect(hostHeaderRejection(reqWithHost("localhost.evil.com:3000"))).toMatch(/non-loopback/i);
    expect(hostHeaderRejection(reqWithHost("127.0.0.1.nip.io:3000"))).toMatch(/non-loopback/i);
    expect(hostHeaderRejection(reqWithHost("localhost:3000@evil.com"))).toMatch(/non-loopback/i);
    expect(hostHeaderRejection(reqWithHost("192.168.1.10:3000"))).toMatch(/non-loopback/i);
  });

  it("rejects a malformed Host", () => {
    expect(hostHeaderRejection(reqWithHost("not a host"))).toMatch(/non-loopback/i);
  });
});

function reqWithToken(token: string | null): NextRequest {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === API_TOKEN_HEADER ? token : null) },
  } as unknown as NextRequest;
}

const TOKEN = "a".repeat(64);

describe("apiTokenRejection", () => {
  it("rejects a request without the token header", () => {
    expect(apiTokenRejection(reqWithToken(null), TOKEN)).toMatch(/missing/i);
    expect(apiTokenRejection(reqWithToken(""), TOKEN)).toMatch(/missing/i);
  });

  it("rejects a wrong token, including prefixes and same-length guesses", () => {
    expect(apiTokenRejection(reqWithToken("b".repeat(64)), TOKEN)).toMatch(/invalid/i);
    expect(apiTokenRejection(reqWithToken("a".repeat(63)), TOKEN)).toMatch(/invalid/i);
    expect(apiTokenRejection(reqWithToken(TOKEN + "a"), TOKEN)).toMatch(/invalid/i);
  });

  it("allows the right token", () => {
    expect(apiTokenRejection(reqWithToken(TOKEN), TOKEN)).toBeNull();
  });

  it("allows everything when no token is configured (dev / next dev)", () => {
    expect(apiTokenRejection(reqWithToken(null), undefined)).toBeNull();
    expect(apiTokenRejection(reqWithToken(null), "")).toBeNull();
    expect(apiTokenRejection(reqWithToken("anything"), undefined)).toBeNull();
  });

  it("reads MARVEN_API_TOKEN at call time by default", () => {
    const prev = process.env.MARVEN_API_TOKEN;
    try {
      process.env.MARVEN_API_TOKEN = TOKEN;
      expect(apiTokenRejection(reqWithToken(null))).toMatch(/missing/i);
      expect(apiTokenRejection(reqWithToken(TOKEN))).toBeNull();
      delete process.env.MARVEN_API_TOKEN;
      expect(apiTokenRejection(reqWithToken(null))).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.MARVEN_API_TOKEN;
      else process.env.MARVEN_API_TOKEN = prev;
    }
  });
});

describe("constantTimeEqual", () => {
  it("compares strings exactly", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });
});
