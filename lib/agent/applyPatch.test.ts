import { describe, it, expect } from "vitest";
import { simulateApplyPatch } from "./applyPatch";

describe("simulateApplyPatch", () => {
  it("applies a single replacement edit", () => {
    const result = simulateApplyPatch("hello world", [{ search: "world", replace: "there" }]);
    expect(result).toBe("hello there");
  });

  it("applies multiple edits in order", () => {
    const result = simulateApplyPatch("foo bar baz", [
      { search: "foo", replace: "one" },
      { search: "baz", replace: "three" },
    ]);
    expect(result).toBe("one bar three");
  });

  it("returns null when search text is not found", () => {
    const result = simulateApplyPatch("hello world", [{ search: "missing", replace: "x" }]);
    expect(result).toBeNull();
  });

  it("returns null when search text is ambiguous (appears more than once)", () => {
    const result = simulateApplyPatch("abc abc", [{ search: "abc", replace: "x" }]);
    expect(result).toBeNull();
  });

  it("handles deletion (empty replace)", () => {
    const result = simulateApplyPatch("hello world", [{ search: " world", replace: "" }]);
    expect(result).toBe("hello");
  });

  it("handles empty content (new file)", () => {
    const result = simulateApplyPatch("", [{ search: "", replace: "anything" }]);
    expect(result).toBeNull(); // empty search is rejected
  });

  it("returns null when search is an empty string", () => {
    const result = simulateApplyPatch("some content", [{ search: "", replace: "x" }]);
    expect(result).toBeNull();
  });

  it("applies edit that changes length correctly", () => {
    const result = simulateApplyPatch("aaabbbccc", [{ search: "bbb", replace: "XX" }]);
    expect(result).toBe("aaaXXccc");
  });
});
