import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rateLimit.js";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("createRateLimiter", () => {
  it("allows up to max hits per window for a key", () => {
    const c = clock();
    const limit = createRateLimiter({ max: 3, windowMs: 10_000, now: c.now });
    expect(limit.take(1).ok).toBe(true);
    expect(limit.take(1).ok).toBe(true);
    expect(limit.take(1).ok).toBe(true);
    expect(limit.take(1).ok).toBe(false);
  });

  it("counts keys separately", () => {
    const c = clock();
    const limit = createRateLimiter({ max: 1, windowMs: 1000, now: c.now });
    expect(limit.take("a").ok).toBe(true);
    expect(limit.take("b").ok).toBe(true);
    expect(limit.take("a").ok).toBe(false);
  });

  it("frees a slot once the oldest hit leaves the window", () => {
    const c = clock();
    const limit = createRateLimiter({ max: 2, windowMs: 1000, now: c.now });
    limit.take(1);
    c.advance(500);
    limit.take(1);
    expect(limit.take(1).ok).toBe(false);
    c.advance(500);
    expect(limit.take(1).ok).toBe(true);
    expect(limit.take(1).ok).toBe(false);
  });

  it("rejected hits do not use up the window", () => {
    const c = clock();
    const limit = createRateLimiter({ max: 1, windowMs: 1000, now: c.now });
    limit.take(1);
    c.advance(900);
    expect(limit.take(1).ok).toBe(false);
    c.advance(100);
    expect(limit.take(1).ok).toBe(true);
  });

  it("asks for a warning only on the first rejection of a burst", () => {
    const c = clock();
    const limit = createRateLimiter({ max: 1, windowMs: 1000, now: c.now });
    expect(limit.take(1)).toEqual({ ok: true, warn: false });
    expect(limit.take(1)).toEqual({ ok: false, warn: true });
    expect(limit.take(1)).toEqual({ ok: false, warn: false });
    c.advance(1000);
    expect(limit.take(1)).toEqual({ ok: true, warn: false });
    expect(limit.take(1)).toEqual({ ok: false, warn: true });
  });

  it("drops keys whose hits have all expired", () => {
    const c = clock();
    const limit = createRateLimiter({ max: 1, windowMs: 1000, now: c.now });
    for (let i = 0; i < 50; i++) limit.take(i);
    c.advance(1000);
    limit.take("fresh");
    expect(limit.size()).toBe(1);
  });
});
