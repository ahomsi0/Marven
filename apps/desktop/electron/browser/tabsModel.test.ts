import { describe, it, expect } from "vitest";
import {
  emptyState, addTab, closeTab, activateTab, moveTab, reopenClosed, clearClosed, updateTab, toSaved, fromSaved, CLOSED_LIMIT,
} from "./tabsModel.js";

const tab = (id: string) => ({ id, url: `https://${id}.com/`, title: id });
const ids = (s: { tabs: { id: string }[] }) => s.tabs.map((t) => t.id);

describe("tabsModel", () => {
  it("adds at the end by default and activates", () => {
    let s = addTab(emptyState(), tab("a"));
    s = addTab(s, tab("b"));
    expect(ids(s)).toEqual(["a", "b"]);
    expect(s.activeId).toBe("b");
  });

  it("adds after a given tab, optionally in the background", () => {
    let s = addTab(addTab(emptyState(), tab("a")), tab("b"));
    s = addTab(s, tab("c"), { afterId: "a", activate: false });
    expect(ids(s)).toEqual(["a", "c", "b"]);
    expect(s.activeId).toBe("b");
  });

  it("activates the first tab even when added in the background", () => {
    const s = addTab(emptyState(), tab("a"), { activate: false });
    expect(s.activeId).toBe("a");
  });

  it("closing the active tab activates its right neighbour, else the left", () => {
    let s = ["a", "b", "c"].reduce((acc, id) => addTab(acc, tab(id)), emptyState());
    s = activateTab(s, "b");
    s = closeTab(s, "b");
    expect(ids(s)).toEqual(["a", "c"]);
    expect(s.activeId).toBe("c");
    s = closeTab(s, "c");
    expect(s.activeId).toBe("a");
    s = closeTab(s, "a");
    expect(s.activeId).toBeNull();
  });

  it("closing a background tab keeps the active one", () => {
    let s = ["a", "b"].reduce((acc, id) => addTab(acc, tab(id)), emptyState());
    s = closeTab(s, "a");
    expect(s.activeId).toBe("b");
  });

  it("remembers closed tabs, newest first, up to the limit", () => {
    let s = emptyState();
    for (let i = 0; i < CLOSED_LIMIT + 3; i++) s = closeTab(addTab(s, tab(`t${i}`)), `t${i}`);
    expect(s.closed).toHaveLength(CLOSED_LIMIT);
    expect(s.closed[0].url).toBe(`https://t${CLOSED_LIMIT + 2}.com/`);
  });

  it("reopens the last closed tab at its old position", () => {
    let s = ["a", "b", "c"].reduce((acc, id) => addTab(acc, tab(id)), emptyState());
    s = closeTab(s, "b");
    s = reopenClosed(s, () => "b2");
    expect(ids(s)).toEqual(["a", "b2", "c"]);
    expect(s.activeId).toBe("b2");
    expect(s.tabs[1].url).toBe("https://b.com/");
    expect(s.closed).toHaveLength(0);
    expect(reopenClosed(s, () => "x")).toBe(s);
  });

  it("moves a tab and clamps the target index", () => {
    let s = ["a", "b", "c"].reduce((acc, id) => addTab(acc, tab(id)), emptyState());
    s = moveTab(s, "a", 2);
    expect(ids(s)).toEqual(["b", "c", "a"]);
    s = moveTab(s, "a", -5);
    expect(ids(s)).toEqual(["a", "b", "c"]);
    expect(moveTab(s, "zzz", 1)).toBe(s);
  });

  it("updates a tab's url and title", () => {
    const s = updateTab(addTab(emptyState(), tab("a")), "a", { url: "https://new.com/", title: "New" });
    expect(s.tabs[0]).toEqual({ id: "a", url: "https://new.com/", title: "New" });
  });

  it("caps a patched title and ignores a non-web url", () => {
    let s = addTab(emptyState(), tab("a"));
    s = updateTab(s, "a", { title: "x".repeat(10_000) });
    expect(s.tabs[0].title).toHaveLength(300);
    s = updateTab(s, "a", { url: "javascript:alert(1)" });
    expect(s.tabs[0].url).toBe("https://a.com/");
    expect(updateTab(s, "a", { title: "x".repeat(10_000), url: "https://a.com/" })).toBe(s); // nothing changed
  });

  it("keeps extra state fields when closing and reopening", () => {
    let s = { ...addTab(emptyState(), tab("a")), extra: 1 };
    s = closeTab(s, "a");
    expect(s.extra).toBe(1);
    s = reopenClosed(s, () => "a2");
    expect(s.extra).toBe(1);
  });

  it("ignores unknown ids", () => {
    const s = addTab(emptyState(), tab("a"));
    expect(activateTab(s, "nope")).toBe(s);
    expect(closeTab(s, "nope")).toBe(s);
    expect(updateTab(s, "nope", { title: "x" })).toBe(s);
  });

  it("round-trips through the saved shape with fresh ids", () => {
    let s = ["a", "b", "c"].reduce((acc, id) => addTab(acc, tab(id)), emptyState());
    s = activateTab(s, "b");
    const saved = toSaved(s);
    expect(saved).toEqual({
      tabs: [
        { url: "https://a.com/", title: "a" },
        { url: "https://b.com/", title: "b" },
        { url: "https://c.com/", title: "c" },
      ],
      activeIndex: 1,
    });
    let n = 0;
    const restored = fromSaved(saved, () => `id${n++}`);
    expect(ids(restored)).toEqual(["id0", "id1", "id2"]);
    expect(restored.activeId).toBe("id1");
    expect(restored.closed).toEqual([]);
  });

  it("drops bad saved entries and survives garbage", () => {
    let n = 0;
    const restored = fromSaved(
      { tabs: [{ url: "file:///etc/hosts", title: "x" }, { url: "https://ok.com/", title: 5 }, null], activeIndex: 7 },
      () => `id${n++}`,
    );
    expect(restored.tabs).toEqual([{ id: "id0", url: "https://ok.com/", title: "" }]);
    expect(restored.activeId).toBe("id0");
    expect(fromSaved("garbage", () => "x")).toEqual(emptyState());
  });

  it("clearClosed forgets recently closed tabs and keeps the rest", () => {
    let s = ["a", "b"].reduce((acc, id) => addTab(acc, tab(id)), emptyState());
    s = closeTab(s, "a");
    const cleared = clearClosed(s);
    expect(cleared.closed).toEqual([]);
    expect(ids(cleared)).toEqual(["b"]);
    expect(cleared.activeId).toBe("b");
    expect(clearClosed(cleared)).toBe(cleared);
  });
});
