import { describe, it, expect } from "vitest";
import { shortcutAction } from "./shortcuts.js";

const key = (k: string, extra: Record<string, boolean> = {}) => ({ type: "keyDown", key: k, meta: true, control: false, shift: false, alt: false, ...extra });

describe("shortcutAction", () => {
  it("maps Cmd shortcuts on macOS", () => {
    expect(shortcutAction(key("t"), "darwin")).toEqual({ action: "new-tab" });
    expect(shortcutAction(key("w"), "darwin")).toEqual({ action: "close-tab" });
    expect(shortcutAction(key("T", { shift: true }), "darwin")).toEqual({ action: "reopen-tab" });
    expect(shortcutAction(key("l"), "darwin")).toEqual({ action: "focus-address" });
    expect(shortcutAction(key("r"), "darwin")).toEqual({ action: "reload" });
    expect(shortcutAction(key("["), "darwin")).toEqual({ action: "back" });
    expect(shortcutAction(key("]"), "darwin")).toEqual({ action: "forward" });
    expect(shortcutAction(key("3"), "darwin")).toEqual({ action: "select-tab", index: 2 });
    expect(shortcutAction(key("9"), "darwin")).toEqual({ action: "select-tab", index: -1 });
  });

  it("uses Ctrl elsewhere", () => {
    expect(shortcutAction(key("t"), "win32")).toBeNull();
    expect(shortcutAction(key("t", { meta: false, control: true }), "win32")).toEqual({ action: "new-tab" });
  });

  it("ignores key-ups, Alt combos, other keys and junk", () => {
    expect(shortcutAction({ ...key("t"), type: "keyUp" }, "darwin")).toBeNull();
    expect(shortcutAction(key("t", { alt: true }), "darwin")).toBeNull();
    expect(shortcutAction(key("c"), "darwin")).toBeNull();
    expect(shortcutAction(key("w", { shift: true }), "darwin")).toBeNull();
    expect(shortcutAction(null, "darwin")).toBeNull();
  });
});
