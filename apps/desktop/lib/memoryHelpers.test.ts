import { describe, it, expect } from "vitest";
import { parseRememberCommand } from "./memoryHelpers";

describe("parseRememberCommand", () => {
  it("extracts what to remember from the supported phrasings", () => {
    expect(parseRememberCommand("remember that I prefer dark mode")).toBe("I prefer dark mode");
    expect(parseRememberCommand("Remember my dog is called Rex")).toBe("my dog is called Rex");
    expect(parseRememberCommand("don't forget that the build runs on Fridays")).toBe(
      "the build runs on Fridays",
    );
  });

  it("returns null for anything else", () => {
    expect(parseRememberCommand("what do you remember?")).toBeNull();
    expect(parseRememberCommand("remember")).toBeNull();
    expect(parseRememberCommand("hello")).toBeNull();
  });
});
