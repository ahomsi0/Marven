// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordAccept,
  recordDismiss,
  readStats,
  resetStats,
} from "./telemetry";

beforeEach(() => {
  resetStats();
});

describe("telemetry", () => {
  it("starts at zero", () => {
    expect(readStats()).toEqual({
      accepts: 0,
      dismisses: 0,
      chars: 0,
      rate: 0,
    });
  });

  it("increments accepts and chars", () => {
    recordAccept(5);
    recordAccept(10);
    const s = readStats();
    expect(s.accepts).toBe(2);
    expect(s.chars).toBe(15);
    expect(s.dismisses).toBe(0);
  });

  it("increments dismisses", () => {
    recordDismiss();
    recordDismiss();
    expect(readStats().dismisses).toBe(2);
  });

  it("rate is 0 when no events", () => {
    expect(readStats().rate).toBe(0);
  });

  it("rate is accepts / (accepts + dismisses)", () => {
    recordAccept(1);
    recordAccept(1);
    recordAccept(1);
    recordAccept(1);
    recordAccept(1);
    recordDismiss();
    recordDismiss();
    recordDismiss();
    recordDismiss();
    recordDismiss();
    expect(readStats().rate).toBe(0.5);
  });

  it("reset clears all counters", () => {
    recordAccept(3);
    recordDismiss();
    resetStats();
    expect(readStats()).toEqual({
      accepts: 0,
      dismisses: 0,
      chars: 0,
      rate: 0,
    });
  });
});
