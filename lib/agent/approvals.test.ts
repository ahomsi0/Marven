import { describe, it, expect, vi } from "vitest";
import { registerApproval, resolveApproval, hasPending } from "./approvals";

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
