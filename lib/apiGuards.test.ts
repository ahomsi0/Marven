import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { crossOriginRejection, hostHeaderRejection } from "./apiGuards";

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
