import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelBrowserCalls, cleanBrowserResult, hasBrowserCall, registerBrowserCall, resolveBrowserCall } from "./browserBridge";

afterEach(() => vi.useRealTimers());

describe("browser call registry", () => {
  it("resolves a registered call once", async () => {
    const p = registerBrowserCall("c1", "run1");
    expect(hasBrowserCall("c1")).toBe(true);
    expect(resolveBrowserCall("c1", { kind: "ok", text: "hi" })).toBe(true);
    await expect(p).resolves.toEqual({ kind: "ok", text: "hi" });
    expect(resolveBrowserCall("c1", { kind: "ok", text: "again" })).toBe(false);
  });

  it("times out as an error", async () => {
    vi.useFakeTimers();
    const p = registerBrowserCall("c2", "run1", 1000);
    vi.advanceTimersByTime(1001);
    await expect(p).resolves.toMatchObject({ kind: "error" });
    expect(hasBrowserCall("c2")).toBe(false);
  });

  it("cancels only the given run's calls", async () => {
    const a = registerBrowserCall("a", "runA");
    const b = registerBrowserCall("b", "runB");
    cancelBrowserCalls("runA");
    await expect(a).resolves.toEqual({ kind: "error", text: "Stopped." });
    expect(hasBrowserCall("b")).toBe(true);
    resolveBrowserCall("b", { kind: "error", text: "x" });
    await b;
  });
});

describe("cleanBrowserResult", () => {
  it("accepts the three shapes and caps strings", () => {
    expect(cleanBrowserResult({ kind: "ok", text: "x".repeat(30000) })).toEqual({ kind: "ok", text: "x".repeat(20000) });
    expect(cleanBrowserResult({ kind: "error", text: "nope" })).toEqual({ kind: "error", text: "nope" });
    expect(cleanBrowserResult({
      kind: "needs_approval",
      approval: { kind: "submit", host: "shop.test", action: "click", target: "Pay", fields: [{ name: "Email", value: "a@b.c" }] },
    })).toEqual({
      kind: "needs_approval",
      approval: { kind: "submit", host: "shop.test", action: "click", target: "Pay", fields: [{ name: "Email", value: "a@b.c" }] },
    });
  });

  it("keeps a JPEG or PNG data URL image and drops anything else", () => {
    const jpeg = "data:image/jpeg;base64,AAAA";
    expect(cleanBrowserResult({ kind: "ok", text: "s", image: { base64: jpeg, mimeType: "image/jpeg", name: "x" } }))
      .toEqual({ kind: "ok", text: "s", image: { base64: jpeg, mimeType: "image/jpeg", name: "screenshot.jpg" } });
    expect(cleanBrowserResult({ kind: "ok", text: "s", image: { base64: "javascript:alert(1)", mimeType: "image/jpeg" } }))
      .toEqual({ kind: "ok", text: "s" });
  });

  it("rejects unknown kinds and bad approvals", () => {
    expect(cleanBrowserResult(null)).toBeNull();
    expect(cleanBrowserResult({ kind: "weird" })).toBeNull();
    expect(cleanBrowserResult({ kind: "needs_approval", approval: { kind: "site", host: "", action: "click", target: "" } })).toBeNull();
    expect(cleanBrowserResult({ kind: "needs_approval", approval: { kind: "site", host: "a.test", action: "fly", target: "" } })).toBeNull();
  });
});
