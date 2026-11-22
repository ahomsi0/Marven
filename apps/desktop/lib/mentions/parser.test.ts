import { describe, it, expect } from "vitest";
import { getActiveTrigger } from "./parser";

describe("getActiveTrigger", () => {
  it("returns null for empty string", () => {
    expect(getActiveTrigger("", 0)).toBeNull();
  });

  it("returns null when there is no @ before the cursor", () => {
    expect(getActiveTrigger("hello", 5)).toBeNull();
  });

  it("returns a trigger when text is '@' and cursor at 1", () => {
    expect(getActiveTrigger("@", 1)).toEqual({ startOffset: 0, query: "" });
  });

  it("returns a trigger for 'hi @fo' with cursor at 6", () => {
    expect(getActiveTrigger("hi @fo", 6)).toEqual({ startOffset: 3, query: "fo" });
  });

  it("returns null when whitespace lives between @ and cursor", () => {
    expect(getActiveTrigger("hi @ ", 5)).toBeNull();
  });

  it("returns null when a newline lives between @ and cursor", () => {
    expect(getActiveTrigger("@a\nb", 4)).toBeNull();
  });

  it("returns null when @ is preceded by a non-whitespace char (email-like)", () => {
    expect(getActiveTrigger("user@host", 9)).toBeNull();
  });

  it("returns a trigger when @ sits at the very start of input", () => {
    expect(getActiveTrigger("@abc", 4)).toEqual({ startOffset: 0, query: "abc" });
  });

  it("returns a trigger when @ follows a newline", () => {
    expect(getActiveTrigger("hi\n@abc", 7)).toEqual({ startOffset: 3, query: "abc" });
  });

  it("returns null when cursor is at 0", () => {
    expect(getActiveTrigger("@abc", 0)).toBeNull();
  });
});
