import { describe, it, expect } from "vitest";
import { parseTimer, detectClipboardAction, clipboardPrompt } from "./chatIntents";

describe("parseTimer", () => {
  it("parses minutes", () => {
    expect(parseTimer("set a timer for 5 minutes")).toEqual({ ms: 300_000, label: "5 minutes" });
  });
  it("parses a single second", () => {
    expect(parseTimer("timer 1 second")).toEqual({ ms: 1000, label: "1 second" });
  });
  it("parses hours", () => {
    expect(parseTimer("set timer 2 hours")).toEqual({ ms: 7_200_000, label: "2 hours" });
  });
  it("ignores other text", () => {
    expect(parseTimer("what time is it")).toBeNull();
  });
});

describe("detectClipboardAction", () => {
  it("detects each action", () => {
    expect(detectClipboardAction("what's in my clipboard")).toBe("read");
    expect(detectClipboardAction("summarize my clipboard")).toBe("summarize");
    expect(detectClipboardAction("fix my grammar")).toBe("fix-grammar");
  });
  it("returns null for anything else", () => {
    expect(detectClipboardAction("copy this")).toBeNull();
  });
});

describe("clipboardPrompt", () => {
  it("wraps the clipboard text for each action", () => {
    expect(clipboardPrompt("read", "hi")).toBe("Here is my clipboard: hi\n\nDescribe it briefly.");
    expect(clipboardPrompt("summarize", "hi")).toBe("Summarize this text: hi");
    expect(clipboardPrompt("fix-grammar", "hi")).toBe("Fix the grammar, return only the corrected text: hi");
  });
});
