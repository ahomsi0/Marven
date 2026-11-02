import { describe, it, expect } from "vitest";
import { quarantineValue } from "./downloads.js";

describe("quarantineValue", () => {
  it("writes flags, hex epoch seconds and the app name", () => {
    expect(quarantineValue(1_700_000_000_000)).toBe("0081;6553f100;Marven;");
  });

  it("drops the milliseconds", () => {
    expect(quarantineValue(1_700_000_000_999)).toBe("0081;6553f100;Marven;");
  });
});
