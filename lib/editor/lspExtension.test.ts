import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { lspExtension, __test } from "./lspExtension";

// jsdom-free: we drive the EditorView in node by attaching to a fake DOM via @codemirror/view's own host requirements.
// CodeMirror needs `document`. Provide jsdom.
import { JSDOM } from "jsdom";

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  (globalThis as any).document = dom.window.document;
  (globalThis as any).window = dom.window;
  // navigator is read-only on globalThis in newer Node; define instead of assign.
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });
  // CodeMirror's DOMObserver needs these jsdom globals on Node.
  for (const k of ["MutationObserver", "getComputedStyle", "DOMRect", "Range", "Selection"]) {
    (globalThis as any)[k] = (dom.window as any)[k];
  }
  // jsdom doesn't ship rAF; patch onto the window so CodeMirror finds it.
  (dom.window as any).requestAnimationFrame = (cb: any) => setTimeout(() => cb(Date.now()), 0);
  (dom.window as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
});

function makeView(doc: string, ext: any) {
  const state = EditorState.create({ doc, extensions: [ext] });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({ state, parent });
}

describe("lspExtension offset conversion", () => {
  it("converts LSP {line,character} ↔ CM offsets correctly across CRLF/LF", () => {
    const doc = "abc\ndef\n12345";
    expect(__test.posToOffset(doc, { line: 0, character: 0 })).toBe(0);
    expect(__test.posToOffset(doc, { line: 1, character: 1 })).toBe(5); // 'e'
    expect(__test.posToOffset(doc, { line: 2, character: 5 })).toBe(13);
    expect(__test.offsetToPos(doc, 5)).toEqual({ line: 1, character: 1 });
  });
});

describe("lspExtension wiring", () => {
  let fakeClient: any;
  let notifSubs: Array<(n: any) => void> = [];

  beforeEach(() => {
    notifSubs = [];
    fakeClient = {
      didChange: vi.fn(),
      closeSession: vi.fn(),
      request: vi.fn(async (_s, method, _p) => {
        if (method === "textDocument/hover") return { contents: { kind: "markdown", value: "(const) x: number" } };
        if (method === "textDocument/completion") return { items: [{ label: "log", kind: 3 }, { label: "warn", kind: 3 }] };
        return null;
      }),
      onNotification: vi.fn((cb) => { notifSubs.push(cb); return () => {}; }),
    };
  });

  it("injects diagnostics from publishDiagnostics notification matching the file", async () => {
    const view = makeView("const x: number = \"x\";", lspExtension({
      sessionId: "s1",
      languageId: "typescript",
      filePath: "/tmp/foo.ts",
      client: fakeClient,
      onOpenFile: () => {},
      onApplyWorkspaceEdit: async () => {},
    }));
    expect(notifSubs.length).toBe(1);
    notifSubs[0]({
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///tmp/foo.ts",
        diagnostics: [{
          range: { start: { line: 0, character: 18 }, end: { line: 0, character: 21 } },
          severity: 1,
          message: "Type 'string' is not assignable to type 'number'.",
        }],
      },
    });
    await Promise.resolve();
    const diags = __test.getDiagnostics(view.state);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toMatch(/Type 'string'/);
    view.destroy();
  });

  it("ignores diagnostics for other files", async () => {
    const view = makeView("x", lspExtension({
      sessionId: "s1", languageId: "typescript", filePath: "/tmp/foo.ts",
      client: fakeClient, onOpenFile: () => {}, onApplyWorkspaceEdit: async () => {},
    }));
    notifSubs[0]({
      method: "textDocument/publishDiagnostics",
      params: { uri: "file:///tmp/other.ts", diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: "x" }] },
    });
    expect(__test.getDiagnostics(view.state)).toHaveLength(0);
    view.destroy();
  });

  it("sends didChange (debounced) when the doc changes", async () => {
    const view = makeView("a", lspExtension({
      sessionId: "s1", languageId: "typescript", filePath: "/tmp/foo.ts",
      client: fakeClient, onOpenFile: () => {}, onApplyWorkspaceEdit: async () => {},
      debounceMs: 0,
    }));
    view.dispatch({ changes: { from: 1, insert: "b" } });
    await new Promise((r) => setTimeout(r, 5));
    expect(fakeClient.didChange).toHaveBeenCalled();
    const arg = fakeClient.didChange.mock.calls.at(-1)[1];
    expect(arg.text).toBe("ab");
    expect(arg.version).toBeGreaterThanOrEqual(2);
    view.destroy();
  });

  it("fetches completions via textDocument/completion", async () => {
    const result = await __test.fetchCompletions(fakeClient, "s1", "/tmp/foo.ts", "console.", 8);
    expect(fakeClient.request).toHaveBeenCalledWith("s1", "textDocument/completion", expect.objectContaining({
      position: { line: 0, character: 8 },
    }));
    expect(result.map((i: any) => i.label)).toEqual(["log", "warn"]);
  });

  it("fetches hover via textDocument/hover", async () => {
    const out = await __test.fetchHover(fakeClient, "s1", "/tmp/foo.ts", "const x = 1;", 6);
    expect(out).toMatch(/x: number/);
  });
});
