import { describe, it, expect, vi } from "vitest";
import { registerApproval, registerScopedApproval, resolveApproval, hasPending } from "./approvals";

describe("approvals", () => {
  it("resolves with accept=true", async () => {
    const p = registerApproval("call-1", 1000);
    queueMicrotask(() => resolveApproval("call-1", true));
    await expect(p).resolves.toBe(true);
  });

  it("resolves with accept=false", async () => {
    const p = registerApproval("call-2", 1000);
    queueMicrotask(() => resolveApproval("call-2", false));
    await expect(p).resolves.toBe(false);
  });

  it("auto-rejects after timeout", async () => {
    vi.useFakeTimers();
    const p = registerApproval("call-3", 100);
    vi.advanceTimersByTime(150);
    await expect(p).resolves.toBe(false);
    vi.useRealTimers();
  });

  it("hasPending returns true while gated, false after resolve", () => {
    registerApproval("call-4", 1000);
    expect(hasPending("call-4")).toBe(true);
    resolveApproval("call-4", true);
    expect(hasPending("call-4")).toBe(false);
  });

  it("resolveApproval is a no-op for unknown callId", () => {
    expect(() => resolveApproval("nope", true)).not.toThrow();
  });

  it("collision: second register clears prior timer and rejects prior promise", async () => {
    const p1 = registerApproval("call-collision", 1000);
    const p2 = registerApproval("call-collision", 1000);  // collides
    resolveApproval("call-collision", true);
    await expect(p1).resolves.toBe(false);  // prior rejected
    await expect(p2).resolves.toBe(true);   // current accepted
  });
});

describe("registerScopedApproval", () => {
  it("resolves with the scope the user chose", async () => {
    const p = registerScopedApproval("s1", 60_000);
    expect(resolveApproval("s1", true, "site")).toBe(true);
    await expect(p).resolves.toEqual({ accept: true, scope: "site" });
  });

  it("defaults to once and rejects on timeout", async () => {
    const p = registerScopedApproval("s2", 60_000);
    resolveApproval("s2", true);
    await expect(p).resolves.toEqual({ accept: true, scope: "once" });
    vi.useFakeTimers();
    const q = registerScopedApproval("s3", 10);
    vi.advanceTimersByTime(11);
    await expect(q).resolves.toEqual({ accept: false, scope: "once" });
    vi.useRealTimers();
  });

  it("leaves boolean approvals unchanged", async () => {
    const p = registerApproval("s4", 60_000);
    resolveApproval("s4", true, "site");
    await expect(p).resolves.toBe(true);
  });
});
