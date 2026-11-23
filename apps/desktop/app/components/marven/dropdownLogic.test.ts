import { describe, it, expect } from "vitest";
import {
  appendTypeahead,
  computeMenuPlacement,
  edgeIndex,
  initialActiveIndex,
  isTypeaheadKey,
  listboxKeyCommand,
  stepIndex,
  triggerOpenIntent,
  typeaheadIndex,
  type NavOption,
} from "./dropdownLogic";

const opts = (labels: string[], disabled: number[] = []): NavOption[] =>
  labels.map((label, i) => ({ label, disabled: disabled.includes(i) }));

describe("edgeIndex", () => {
  it("finds the first and last enabled options", () => {
    const o = opts(["a", "b", "c", "d"], [0, 3]);
    expect(edgeIndex(o, "first")).toBe(1);
    expect(edgeIndex(o, "last")).toBe(2);
  });

  it("returns -1 when nothing is enabled", () => {
    expect(edgeIndex(opts(["a", "b"], [0, 1]), "first")).toBe(-1);
    expect(edgeIndex([], "last")).toBe(-1);
  });
});

describe("stepIndex", () => {
  const o = opts(["a", "b", "c", "d", "e"], [2]);

  it("moves one step and skips disabled options", () => {
    expect(stepIndex(o, 0, 1)).toBe(1);
    expect(stepIndex(o, 1, 1)).toBe(3);
    expect(stepIndex(o, 3, -1)).toBe(1);
  });

  it("stops at the ends instead of wrapping", () => {
    expect(stepIndex(o, 4, 1)).toBe(4);
    expect(stepIndex(o, 0, -1)).toBe(0);
  });

  it("stays put when only disabled options lie ahead", () => {
    expect(stepIndex(opts(["a", "b", "c"], [1, 2]), 0, 1)).toBe(0);
  });

  it("lands on an edge when nothing is active", () => {
    expect(stepIndex(o, -1, 1)).toBe(0);
    expect(stepIndex(o, -1, -1)).toBe(4);
  });
});

describe("initialActiveIndex", () => {
  const o = opts(["a", "b", "c"], [0]);

  it("starts on the selected option", () => {
    expect(initialActiveIndex(o, 2)).toBe(2);
  });

  it("falls back to the first enabled option when the selection is missing or disabled", () => {
    expect(initialActiveIndex(o, -1)).toBe(1);
    expect(initialActiveIndex(o, 0)).toBe(1);
  });

  it("honours first/last intents", () => {
    expect(initialActiveIndex(o, 2, "first")).toBe(1);
    expect(initialActiveIndex(o, 1, "last")).toBe(2);
  });
});

describe("listboxKeyCommand", () => {
  const o = opts(["a", "b", "c", "d"], [3]);

  it("maps arrows, Home and End to moves", () => {
    expect(listboxKeyCommand(o, 0, "ArrowDown")).toEqual({ type: "move", index: 1 });
    expect(listboxKeyCommand(o, 2, "ArrowDown")).toEqual({ type: "move", index: 2 });
    expect(listboxKeyCommand(o, 2, "ArrowUp")).toEqual({ type: "move", index: 1 });
    expect(listboxKeyCommand(o, 2, "Home")).toEqual({ type: "move", index: 0 });
    expect(listboxKeyCommand(o, 0, "End")).toEqual({ type: "move", index: 2 });
  });

  it("pages by several options at a time", () => {
    const many = opts(Array.from({ length: 30 }, (_, i) => `o${i}`));
    expect(listboxKeyCommand(many, 0, "PageDown")).toEqual({ type: "move", index: 10 });
    expect(listboxKeyCommand(many, 25, "PageDown")).toEqual({ type: "move", index: 29 });
    expect(listboxKeyCommand(many, 5, "PageUp")).toEqual({ type: "move", index: 0 });
  });

  it("selects the active option with Enter or Space", () => {
    expect(listboxKeyCommand(o, 1, "Enter")).toEqual({ type: "select", index: 1 });
    expect(listboxKeyCommand(o, 2, " ")).toEqual({ type: "select", index: 2 });
  });

  it("treats Space as part of a type-ahead query while typing", () => {
    expect(listboxKeyCommand(o, 2, " ", { typing: true })).toEqual({ type: "none" });
  });

  it("closes without selecting when the active option is disabled or missing", () => {
    expect(listboxKeyCommand(o, 3, "Enter")).toEqual({ type: "close" });
    expect(listboxKeyCommand(o, -1, " ")).toEqual({ type: "close" });
  });

  it("closes on Escape and reports Tab", () => {
    expect(listboxKeyCommand(o, 1, "Escape")).toEqual({ type: "close" });
    expect(listboxKeyCommand(o, 1, "Tab")).toEqual({ type: "tab" });
    expect(listboxKeyCommand(o, 1, "x")).toEqual({ type: "none" });
  });
});

describe("triggerOpenIntent", () => {
  it("opens on the usual select keys", () => {
    expect(triggerOpenIntent("ArrowDown")).toBe("selected");
    expect(triggerOpenIntent("ArrowUp")).toBe("selected");
    expect(triggerOpenIntent("Enter")).toBe("selected");
    expect(triggerOpenIntent(" ")).toBe("selected");
    expect(triggerOpenIntent("Home")).toBe("first");
    expect(triggerOpenIntent("End")).toBe("last");
    expect(triggerOpenIntent("Tab")).toBeNull();
    expect(triggerOpenIntent("a")).toBeNull();
  });
});

describe("type-ahead", () => {
  const fonts = opts(["Default", "Menlo", "Monaco", "Fira Code", "JetBrains Mono", "Courier"], [5]);

  it("only treats single printable keys without modifiers as type-ahead", () => {
    expect(isTypeaheadKey("m")).toBe(true);
    expect(isTypeaheadKey("M")).toBe(true);
    expect(isTypeaheadKey(" ")).toBe(false);
    expect(isTypeaheadKey("ArrowDown")).toBe(false);
    expect(isTypeaheadKey("a", { meta: true })).toBe(false);
    expect(isTypeaheadKey("a", { ctrl: true })).toBe(false);
  });

  it("collects keystrokes and starts over after a pause", () => {
    let s = appendTypeahead({ query: "", at: 0 }, "M", 1000);
    s = appendTypeahead(s, "o", 1200);
    expect(s.query).toBe("mo");
    s = appendTypeahead(s, "f", 2000);
    expect(s.query).toBe("f");
  });

  it("matches a prefix case-insensitively", () => {
    expect(typeaheadIndex(fonts, "fi", 0)).toBe(3);
    expect(typeaheadIndex(fonts, "JET", 0)).toBe(4);
  });

  it("keeps the current option while more of its name is typed", () => {
    expect(typeaheadIndex(fonts, "mon", 2)).toBe(2);
  });

  it("cycles through options sharing a first letter when it's repeated", () => {
    expect(typeaheadIndex(fonts, "m", 0)).toBe(1);
    expect(typeaheadIndex(fonts, "m", 1)).toBe(2);
    expect(typeaheadIndex(fonts, "mm", 2)).toBe(1);
  });

  it("wraps around to find a match earlier in the list", () => {
    expect(typeaheadIndex(fonts, "d", 3)).toBe(0);
  });

  it("skips disabled options and reports misses", () => {
    expect(typeaheadIndex(fonts, "c", 0)).toBe(-1);
    expect(typeaheadIndex(fonts, "z", 0)).toBe(-1);
    expect(typeaheadIndex(fonts, "", 0)).toBe(-1);
  });
});

describe("computeMenuPlacement", () => {
  const viewport = { width: 1000, height: 800 };
  const anchor = (top: number, left: number, width = 200, height = 30) => ({
    top,
    left,
    width,
    right: left + width,
    bottom: top + height,
  });

  it("opens below, matching the trigger's width at least", () => {
    const p = computeMenuPlacement({ anchor: anchor(100, 50), menu: { width: 120, height: 200 }, viewport });
    expect(p).toEqual({ top: 134, left: 50, width: 200, maxHeight: 320, side: "below" });
  });

  it("flips above when there's more room there", () => {
    const p = computeMenuPlacement({ anchor: anchor(700, 50), menu: { width: 200, height: 300 }, viewport });
    expect(p.side).toBe("above");
    expect(p.top).toBe(700 - 4 - 300);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });

  it("stays below and shrinks when below still has more room", () => {
    const p = computeMenuPlacement({ anchor: anchor(300, 50), menu: { width: 200, height: 900 }, viewport, maxHeight: 2000 });
    expect(p.side).toBe("below");
    expect(p.maxHeight).toBe(800 - 330 - 4 - 8);
  });

  it("shrinks above to the room there", () => {
    const p = computeMenuPlacement({ anchor: anchor(600, 50), menu: { width: 200, height: 900 }, viewport, maxHeight: 2000 });
    expect(p.side).toBe("above");
    expect(p.maxHeight).toBe(600 - 4 - 8);
    expect(p.top).toBe(8);
  });

  it("shifts left to stay inside the viewport", () => {
    const p = computeMenuPlacement({ anchor: anchor(100, 900, 80), menu: { width: 300, height: 100 }, viewport });
    expect(p.left).toBe(1000 - 8 - 300);
  });

  it("lines up with the trigger's right edge in RTL and clamps at the left", () => {
    const rtl = computeMenuPlacement({ anchor: anchor(100, 500, 200), menu: { width: 300, height: 100 }, viewport, rtl: true });
    expect(rtl.left + rtl.width).toBe(700);
    const clamped = computeMenuPlacement({ anchor: anchor(100, 0, 100), menu: { width: 300, height: 100 }, viewport, rtl: true });
    expect(clamped.left).toBe(8);
  });

  it("never gets wider than the viewport", () => {
    const p = computeMenuPlacement({ anchor: anchor(100, 0), menu: { width: 5000, height: 100 }, viewport });
    expect(p.width).toBe(1000 - 16);
    expect(p.left).toBe(8);
  });
});
