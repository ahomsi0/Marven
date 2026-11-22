import { describe, it, expect } from "vitest";
import { isWebUrl, cleanBounds, cleanText, isId, isHost, hostOf, approvalHostOf, isApprovalHost, staysOnOrigin, isAllowedPermission, cleanAgentAction } from "./validate.js";

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

  it("names a loopback site by host and port for approvals, any other by host", () => {
    expect(approvalHostOf("https://www.example.com:8080/a")).toBe("www.example.com");
    expect(approvalHostOf("http://localhost:5173/app")).toBe("localhost:5173");
    expect(approvalHostOf("http://127.0.0.1/")).toBe("127.0.0.1:80");
    expect(approvalHostOf("https://localhost/")).toBe("localhost:443");
    expect(approvalHostOf("http://[::1]:8080/")).toBe("[::1]:8080");
    expect(approvalHostOf("http://dev.localhost:4000/")).toBe("dev.localhost:4000");
    for (const url of ["about:blank", "data:text/html,hi", "garbage"]) expect(approvalHostOf(url)).toBe("");
  });

  it("accepts approval hosts with a port only for loopback", () => {
    for (const good of ["example.com", "localhost:5173", "127.0.0.1:80", "[::1]:8080", "dev.localhost:65535"]) {
      expect(isApprovalHost(good), good).toBe(true);
    }
    for (const bad of ["example.com:443", "localhost:0", "localhost:65536", "localhost:05173", "localhost:", ":80", "localhost:80:80", "a b:80", "", null]) {
      expect(isApprovalHost(bad), String(bad)).toBe(false);
    }
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

  it("isAllowedPermission allows only sanitized clipboard writes and fullscreen", () => {
    expect(isAllowedPermission("clipboard-sanitized-write")).toBe(true);
    expect(isAllowedPermission("fullscreen")).toBe(true);
    for (const p of ["clipboard-read", "media", "geolocation", "notifications", "pointerLock", "keyboardLock", "openExternal", ""]) {
      expect(isAllowedPermission(p)).toBe(false);
    }
  });
});

describe("cleanAgentAction", () => {
  const base = { approvedHosts: ["shop.test", "../bad"], approvedSubmit: true, canSeeImages: false };

  it("keeps known tools with checked arguments", () => {
    expect(cleanAgentAction({ ...base, tool: "browser_open", args: { url: "https://shop.test/" } })).toEqual({
      tool: "browser_open", args: { url: "https://shop.test/" }, approvedHosts: ["shop.test"], approvedSubmit: true, canSeeImages: false,
    });
    expect(cleanAgentAction({ ...base, tool: "browser_click", args: { tab: "t-1", ref: "3" } })?.args).toEqual({ tab: "t-1", ref: 3 });
    expect(cleanAgentAction({ ...base, tool: "browser_type", args: { tab: "t", ref: 1, text: "x".repeat(3000), submit: "yes" } })?.args)
      .toEqual({ tab: "t", ref: 1, text: "x".repeat(2000), submit: false });
    expect(cleanAgentAction({ ...base, tool: "browser_wait", args: { tab: "t", for: "load", timeoutMs: 99999 } })?.args)
      .toEqual({ tab: "t", for: "load", text: "", timeoutMs: 15000 });
    expect(cleanAgentAction({ ...base, tool: "browser_read", args: { tab: "t" } })?.args).toEqual({ tab: "t", offset: 0, find: "" });
  });

  it("keeps approved loopback hosts with their port", () => {
    const action = cleanAgentAction({ ...base, approvedHosts: ["localhost:5173", "localhost", "example.com:443", "127.0.0.1:3000"], tool: "browser_tabs", args: { action: "list" } });
    expect(action?.approvedHosts).toEqual(["localhost:5173", "localhost", "127.0.0.1:3000"]);
  });

  it("keeps the approved target only as a short string", () => {
    const click = { ...base, tool: "browser_click", args: { tab: "t", ref: 1 } };
    expect(cleanAgentAction({ ...click, approvedTarget: "Pay" })?.approvedTarget).toBe("Pay");
    expect(cleanAgentAction({ ...click, approvedTarget: "x".repeat(81) })).not.toHaveProperty("approvedTarget");
    expect(cleanAgentAction({ ...click, approvedTarget: 3 })).not.toHaveProperty("approvedTarget");
    expect(cleanAgentAction(click)).not.toHaveProperty("approvedTarget");
  });

  it("refuses unknown tools and bad arguments", () => {
    expect(cleanAgentAction(null)).toBeNull();
    expect(cleanAgentAction({ ...base, tool: "browser_fly", args: {} })).toBeNull();
    expect(cleanAgentAction({ ...base, tool: "browser_open", args: { url: "file:///etc/passwd" } })).toBeNull();
    expect(cleanAgentAction({ ...base, tool: "browser_click", args: { tab: "t", ref: 0 } })).toBeNull();
    expect(cleanAgentAction({ ...base, tool: "browser_click", args: { tab: "../x", ref: 1 } })).toBeNull();
    expect(cleanAgentAction({ ...base, tool: "browser_press", args: { tab: "t", key: "F12" } })).toBeNull();
    expect(cleanAgentAction({ ...base, tool: "browser_history", args: { tab: "t", action: "home" } })).toBeNull();
    expect(cleanAgentAction({ ...base, tool: "browser_wait", args: { tab: "t", for: "text" } })).toBeNull();
    expect(cleanAgentAction({ ...base, tool: "browser_scroll", args: { tab: "t" } })).toBeNull();
  });
});
