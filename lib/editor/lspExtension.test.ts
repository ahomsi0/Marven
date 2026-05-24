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

describe("lspExtension go-to-definition", () => {
  let fakeClient: any;
  let notifSubs: Array<(n: any) => void> = [];

  beforeEach(() => {
    notifSubs = [];
    fakeClient = {
      didChange: vi.fn(),
      closeSession: vi.fn(),
      request: vi.fn(async (_s, method) => {
        if (method === "textDocument/definition") {
          return { uri: "file:///tmp/has%20space/target.ts", range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } } };
        }
        if (method === "textDocument/rename") {
          return {
            changes: {
              "file:///tmp/a.ts": [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: "renamed" }],
            },
          };
        }
        return null;
      }),
      onNotification: vi.fn((cb) => { notifSubs.push(cb); return () => {}; }),
    };
  });

  it("Cmd+click triggers definition request and decodes URI", async () => {
    const opens: Array<{ path: string; pos?: any }> = [];
    const ext = lspExtension({
      sessionId: "s1", languageId: "typescript", filePath: "/tmp/foo.ts",
      client: fakeClient, onApplyWorkspaceEdit: async () => {},
      onOpenFile: (path, pos) => opens.push({ path, pos }),
    });
    const view = makeView("hello", ext);
    const ev = new (window as any).MouseEvent("mousedown", { metaKey: true, clientX: 0, clientY: 0, bubbles: true, button: 0 });
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 0));
    expect(fakeClient.request).toHaveBeenCalledWith("s1", "textDocument/definition", expect.any(Object));
    expect(opens[0]?.path).toBe("/tmp/has space/target.ts");
    expect(opens[0]?.pos).toEqual({ line: 4, character: 2 });
    view.destroy();
  });

  it("F2 calls rename and forwards WorkspaceEdit to onApplyWorkspaceEdit", async () => {
    const applied: any[] = [];
    (window as any).prompt = () => "newName";
    const ext = lspExtension({
      sessionId: "s1", languageId: "typescript", filePath: "/tmp/foo.ts",
      client: fakeClient,
      onOpenFile: () => {},
      onApplyWorkspaceEdit: async (edit) => { applied.push(edit); },
    });
    const view = makeView("abc", ext);
    const ev = new (window as any).KeyboardEvent("keydown", { key: "F2", bubbles: true });
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 0));
    expect(applied).toHaveLength(1);
    expect(applied[0].changes["file:///tmp/a.ts"][0].newText).toBe("renamed");
    view.destroy();
  });

  it("handles array-form definition response (Location[])", async () => {
    fakeClient.request.mockImplementationOnce(async () => [{ uri: "file:///tmp/x.ts", range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } } }]);
    const opens: Array<{ path: string }> = [];
    const view = makeView("hi", lspExtension({
      sessionId: "s1", languageId: "typescript", filePath: "/tmp/foo.ts",
      client: fakeClient, onApplyWorkspaceEdit: async () => {},
      onOpenFile: (path) => opens.push({ path }),
    }));
    const ev = new (window as any).MouseEvent("mousedown", { metaKey: true, clientX: 0, clientY: 0, bubbles: true, button: 0 });
    view.contentDOM.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 0));
    expect(opens[0]?.path).toBe("/tmp/x.ts");
    view.destroy();
  });
});
