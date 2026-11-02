import { describe, it, expect } from "vitest";
import { isWebUrl, cleanBounds, cleanText, isId, isHost, hostOf, staysOnOrigin } from "./validate.js";

describe("validate", () => {
  it("accepts only http(s) URLs", () => {
    expect(isWebUrl("https://example.com/")).toBe(true);
    expect(isWebUrl("http://localhost:3000")).toBe(true);
    for (const bad of ["file:///etc/hosts", "javascript:alert(1)", "chrome://settings", "not a url", "", 42, null]) {
      expect(isWebUrl(bad)).toBe(false);
    }
    expect(isWebUrl("https://x.com/" + "a".repeat(9000))).toBe(false);
  });

  it("cleans bounds or rejects them", () => {
    expect(cleanBounds({ x: 1.6, y: -3, width: 200.2, height: 100 })).toEqual({ x: 2, y: 0, width: 200, height: 100 });
    expect(cleanBounds({ x: 1, y: 2, width: NaN, height: 4 })).toBeNull();
    expect(cleanBounds(null)).toBeNull();
    expect(cleanBounds("0,0,1,1")).toBeNull();
  });

  it("clamps huge bounds", () => {
    expect(cleanBounds({ x: 1e9, y: 5, width: Number.MAX_VALUE, height: 100_001 })).toEqual({ x: 100000, y: 5, width: 100000, height: 100000 });
  });

  it("caps text and drops non-strings", () => {
    expect(cleanText("abcdef", 3)).toBe("abc");
    expect(cleanText(undefined, 3)).toBe("");
    expect(cleanText({}, 3)).toBe("");
  });

  it("recognises ids and hosts", () => {
    expect(isId("6f1c2d3e-aaaa-4bbb-8ccc-000000000000")).toBe(true);
    expect(isId("d12")).toBe(true);
    expect(isId("../etc")).toBe(false);
    expect(isId("")).toBe(false);
    expect(isHost("www.example.com")).toBe(true);
    expect(isHost("[::1]")).toBe(true);
    expect(isHost("a_b.example.com")).toBe(true);
    expect(isHost("example.com.")).toBe(true);
    for (const bad of ["..", ".", "a..b", ":::", "a b", "", "EXAMPLE.com", "x/y", "x:80", "a".repeat(254), 42, null]) {
      expect(isHost(bad)).toBe(false);
    }
  });

  it("extracts the hostname", () => {
    expect(hostOf("https://www.example.com:8080/a")).toBe("www.example.com");
    expect(hostOf("garbage")).toBe("");
  });

  it("staysOnOrigin compares a navigation target with the current page's origin", () => {
    expect(staysOnOrigin("http://localhost:3000/chat", "http://localhost:3000/")).toBe(true);
    expect(staysOnOrigin("http://localhost:3001/", "http://localhost:3000/")).toBe(false);
    expect(staysOnOrigin("https://evil.example/", "http://localhost:3000/")).toBe(false);
  });

  it("staysOnOrigin treats an empty current URL or unparsable input as same-origin", () => {
    expect(staysOnOrigin("http://localhost:3000/", "")).toBe(true);
    expect(staysOnOrigin("not a url", "http://localhost:3000/")).toBe(true);
  });
});
