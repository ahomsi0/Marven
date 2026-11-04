import { describe, expect, it } from "vitest";
import { clickEvents, isAgentKey, keyEvents } from "./agentKeys.js";

describe("agent keys", () => {
  it("allows only the listed keys", () => {
    expect(isAgentKey("Enter")).toBe(true);
    expect(isAgentKey("ArrowDown")).toBe(true);
    expect(isAgentKey("a")).toBe(false);
    expect(isAgentKey("constructor")).toBe(false);
  });

  it("sends Enter with its character so forms submit", () => {
    expect(keyEvents("Enter")).toEqual([
      { type: "keyDown", keyCode: "Enter" },
      { type: "char", keyCode: "\r" },
      { type: "keyUp", keyCode: "Enter" },
    ]);
    expect(keyEvents("ArrowDown")).toEqual([{ type: "keyDown", keyCode: "Down" }, { type: "keyUp", keyCode: "Down" }]);
  });

  it("clicks with a move, a press and a release at one point", () => {
    expect(clickEvents(10.4, 20.6)).toEqual([
      { type: "mouseMove", x: 10.4, y: 20.6 },
      { type: "mouseDown", x: 10.4, y: 20.6, button: "left", clickCount: 1 },
      { type: "mouseUp", x: 10.4, y: 20.6, button: "left", clickCount: 1 },
    ]);
  });
});
