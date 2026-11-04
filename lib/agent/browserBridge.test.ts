import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelBrowserCalls, cleanBrowserResult, hasBrowserCall, registerBrowserCall, resolveBrowserCall } from "./browserBridge";

afterEach(() => vi.useRealTimers());

describe("browser call registry", () => {
  it("resolves a registered call once", async () => {
    const p = registerBrowserCall("c1", "run1");
    expect(hasBrowserCall("c1")).toBe(true);
    expect(resolveBrowserCall("c1", "run1", { kind: "ok", text: "hi" })).toBe(true);
    await expect(p).resolves.toEqual({ kind: "ok", text: "hi" });
    expect(resolveBrowserCall("c1", "run1", { kind: "ok", text: "again" })).toBe(false);
  });

  it("only resolves a call for the run that owns it", async () => {
    const p = registerBrowserCall("c3", "runA");
    expect(resolveBrowserCall("c3", "runB", { kind: "ok", text: "hijack" })).toBe(false);
    expect(hasBrowserCall("c3")).toBe(true);
    expect(resolveBrowserCall("c3", "runA", { kind: "ok", text: "mine" })).toBe(true);
    await expect(p).resolves.toEqual({ kind: "ok", text: "mine" });
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
    resolveBrowserCall("b", "runB", { kind: "error", text: "x" });
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

  it("keeps a PNG and enforces the size limit", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(cleanBrowserResult({ kind: "ok", text: "s", image: { base64: png } }))
      .toEqual({ kind: "ok", text: "s", image: { base64: png, mimeType: "image/png", name: "screenshot.png" } });
    const prefix = "data:image/png;base64,";
    const atLimit = prefix + "A".repeat(5_000_000 - prefix.length);
    expect(cleanBrowserResult({ kind: "ok", text: "s", image: { base64: atLimit } })).toMatchObject({ image: { base64: atLimit } });
    expect(cleanBrowserResult({ kind: "ok", text: "s", image: { base64: atLimit + "A" } })).toEqual({ kind: "ok", text: "s" });
  });

  it("drops an image with no payload", () => {
    expect(cleanBrowserResult({ kind: "ok", text: "s", image: { base64: "data:image/png;base64," } })).toEqual({ kind: "ok", text: "s" });
    expect(cleanBrowserResult({ kind: "ok", text: "s", image: { base64: "data:image/jpeg;base64," } })).toEqual({ kind: "ok", text: "s" });
  });

  it("strips control and bidi characters from approval text", () => {
    const result = cleanBrowserResult({
      kind: "needs_approval",
      approval: {
        kind: "submit",
        host: "shop\u202e.test",
        action: "click",
        target: "Pay\u0000 now\u2066",
        fields: [{ name: "Em\u202eail", value: "a\u200f@b.c\n" }],
      },
    });
    expect(result).toEqual({
      kind: "needs_approval",
      approval: { kind: "submit", host: "shop.test", action: "click", target: "Pay now", fields: [{ name: "Email", value: "a@b.c" }] },
    });
  });

  it("drops junk fields entries instead of showing blank rows", () => {
    const result = cleanBrowserResult({
      kind: "needs_approval",
      approval: { kind: "submit", host: "a.test", action: "click", target: "Go", fields: [null, 3, { name: "Email", value: "a" }, { name: "\u202e", value: "" }] },
    });
    expect(result).toMatchObject({ approval: { fields: [{ name: "Email", value: "a" }] } });
  });

  it("rejects unknown kinds and bad approvals", () => {
    expect(cleanBrowserResult(null)).toBeNull();
    expect(cleanBrowserResult({ kind: "weird" })).toBeNull();
    expect(cleanBrowserResult({ kind: "needs_approval", approval: { kind: "site", host: "", action: "click", target: "" } })).toBeNull();
    expect(cleanBrowserResult({ kind: "needs_approval", approval: { kind: "site", host: "a.test", action: "fly", target: "" } })).toBeNull();
  });
});
