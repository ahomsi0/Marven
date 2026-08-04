import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { crossOriginRejection } from "./apiGuards";

function reqWithOrigin(origin: string | null): NextRequest {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === "origin" ? origin : null) },
  } as unknown as NextRequest;
}

describe("crossOriginRejection", () => {
  it("allows requests with no Origin header (same-origin GET / non-browser)", () => {
    expect(crossOriginRejection(reqWithOrigin(null))).toBeNull();
  });

  it("allows local origins", () => {
    expect(crossOriginRejection(reqWithOrigin("http://localhost:47891"))).toBeNull();
    expect(crossOriginRejection(reqWithOrigin("http://localhost:3000"))).toBeNull();
    expect(crossOriginRejection(reqWithOrigin("http://127.0.0.1:8080"))).toBeNull();
  });

  it("rejects foreign origins", () => {
    expect(crossOriginRejection(reqWithOrigin("http://evil.com"))).toMatch(/cross-origin/i);
    expect(crossOriginRejection(reqWithOrigin("https://attacker.example"))).toMatch(/cross-origin/i);
  });

  it("rejects a malformed Origin", () => {
    expect(crossOriginRejection(reqWithOrigin("not a url"))).toMatch(/invalid/i);
  });
});
