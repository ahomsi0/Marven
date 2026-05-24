// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  inlineCompletionExtension,
  type InlineCompletionOptions,
} from "./inlineCompletionExtension";

function makeView(doc: string, opts: Partial<InlineCompletionOptions> = {}) {
  const ext = inlineCompletionExtension({
    enabled: true,
    debounceMs: 100,
    provider: "ollama",
    model: "m",
    filePath: "a.ts",
    workspaceRoot: "/w",
    onAccept: opts.onAccept,
    onDismiss: opts.onDismiss,
    ...opts,
  });
  const state = EditorState.create({
    doc,
    extensions: [EditorState.allowMultipleSelections.of(true), ext],
  });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state, parent });
  return { view, parent };
}

function mockFetchOnce(completion: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ completion }),
  } as unknown as Response);
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("inlineCompletionExtension", () => {
  it("debounced fetch fires and ghost decoration appears", async () => {
    const f = mockFetchOnce("return 1;");
    vi.stubGlobal("fetch", f);
    const { view, parent } = makeView("function add() {\n  ");
    // Move cursor to end.
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    // Trigger a doc change at end.
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "x" },
      selection: { anchor: view.state.doc.length + 1 },
    });
    // Not yet fetched (still in debounce).
    expect(f).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await flushPromises();
    expect(f).toHaveBeenCalledTimes(1);
    expect(parent.querySelector(".cm-inline-completion")?.textContent).toBe(
      "return 1;",
    );
  });

  it("Tab inserts the ghost text and clears it, calling onAccept", async () => {
    const f = mockFetchOnce("XYZ");
    vi.stubGlobal("fetch", f);
    const onAccept = vi.fn();
    const { view, parent } = makeView("ab", { onAccept });
    view.dispatch({
      changes: { from: 2, insert: "c" },
      selection: { anchor: 3 },
    });
    await vi.advanceTimersByTimeAsync(100);
    await flushPromises();
    expect(parent.querySelector(".cm-inline-completion")).not.toBeNull();

    // Simulate Tab keypress through the keymap.
    // We call the registered command directly via dispatching keymap is harder;
    // use view.contentDOM keydown event.
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    view.contentDOM.dispatchEvent(event);

    expect(view.state.doc.toString()).toBe("abcXYZ");
    expect(view.state.selection.main.head).toBe(6);
    expect(parent.querySelector(".cm-inline-completion")).toBeNull();
    expect(onAccept).toHaveBeenCalledWith(3);
  });

  it("Escape dismisses ghost and calls onDismiss", async () => {
    const f = mockFetchOnce("ZZ");
    vi.stubGlobal("fetch", f);
    const onDismiss = vi.fn();
    const { view, parent } = makeView("ab", { onDismiss });
    view.dispatch({
      changes: { from: 2, insert: "c" },
      selection: { anchor: 3 },
    });
    await vi.advanceTimersByTimeAsync(100);
    await flushPromises();
    expect(parent.querySelector(".cm-inline-completion")).not.toBeNull();

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    view.contentDOM.dispatchEvent(event);
    expect(parent.querySelector(".cm-inline-completion")).toBeNull();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("subsequent doc change dismisses the ghost", async () => {
    const f = mockFetchOnce("ZZ");
    vi.stubGlobal("fetch", f);
    const { view, parent } = makeView("ab");
    view.dispatch({
      changes: { from: 2, insert: "c" },
      selection: { anchor: 3 },
    });
    await vi.advanceTimersByTimeAsync(100);
    await flushPromises();
    expect(parent.querySelector(".cm-inline-completion")).not.toBeNull();

    // Backspace.
    view.dispatch({
      changes: { from: 2, to: 3 },
      selection: { anchor: 2 },
    });
    expect(parent.querySelector(".cm-inline-completion")).toBeNull();
  });

  it("cursor moved before fetch resolves → ghost not set", async () => {
    let resolve!: (r: unknown) => void;
    const pending = new Promise((r) => (resolve = r));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(pending),
    );
    const { view, parent } = makeView("ab");
    view.dispatch({
      changes: { from: 2, insert: "c" },
      selection: { anchor: 3 },
    });
    await vi.advanceTimersByTimeAsync(100);
    // Move cursor before response arrives.
    view.dispatch({ selection: { anchor: 1 } });
    resolve({
      ok: true,
      json: async () => ({ completion: "XX" }),
    });
    await flushPromises();
    expect(parent.querySelector(".cm-inline-completion")).toBeNull();
  });

  it("newer request supersedes older response", async () => {
    const fetches: Array<(r: unknown) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise((r) => fetches.push(r))),
    );
    const { view, parent } = makeView("ab");
    // First trigger.
    view.dispatch({
      changes: { from: 2, insert: "c" },
      selection: { anchor: 3 },
    });
    await vi.advanceTimersByTimeAsync(100);
    // Second trigger (newer).
    view.dispatch({
      changes: { from: 3, insert: "d" },
      selection: { anchor: 4 },
    });
    await vi.advanceTimersByTimeAsync(100);
    // Resolve first (stale).
    fetches[0]({
      ok: true,
      json: async () => ({ completion: "OLD" }),
    });
    await flushPromises();
    expect(parent.querySelector(".cm-inline-completion")?.textContent).not.toBe(
      "OLD",
    );
    // Resolve second.
    fetches[1]({
      ok: true,
      json: async () => ({ completion: "NEW" }),
    });
    await flushPromises();
    expect(parent.querySelector(".cm-inline-completion")?.textContent).toBe(
      "NEW",
    );
  });

  it("empty doc → no trigger", async () => {
    const f = mockFetchOnce("ZZ");
    vi.stubGlobal("fetch", f);
    const { view } = makeView("");
    view.dispatch({ changes: { from: 0, insert: "" } });
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(f).not.toHaveBeenCalled();
  });

  it("multi-cursor → no trigger", async () => {
    const f = mockFetchOnce("ZZ");
    vi.stubGlobal("fetch", f);
    const { view } = makeView("abc\ndef");
    // First set multi-cursor selection.
    view.dispatch({
      selection: EditorSelection.create(
        [EditorSelection.cursor(1), EditorSelection.cursor(5)],
        0,
      ),
    });
    expect(view.state.selection.ranges.length).toBe(2);
    // Now make a doc change while multi-cursor is active.
    view.dispatch({
      changes: { from: 1, insert: "x" },
    });
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(f).not.toHaveBeenCalled();
  });
});
