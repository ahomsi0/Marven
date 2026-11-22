// lib/editor/lspExtension.ts
import { Extension, StateField, StateEffect } from "@codemirror/state";
import { EditorView, ViewPlugin, ViewUpdate, hoverTooltip } from "@codemirror/view";
import { Diagnostic, setDiagnostics } from "@codemirror/lint";
import {
  autocompletion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { LanguageId } from "./lspServers";
import type { LspClient } from "./lspClient";
import type {
  LspNotification,
  LspPosition,
  LspWorkspaceEdit,
} from "@/types";

export interface LspExtensionOpts {
  sessionId: string;
  languageId: LanguageId;
  filePath: string;
  client: LspClient;
  onOpenFile: (path: string, position?: LspPosition) => void;
  onApplyWorkspaceEdit: (edit: LspWorkspaceEdit) => Promise<void>;
  debounceMs?: number;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function fileUri(filePath: string): string {
  const norm = filePath.replace(/\\/g, "/");
  const withSlash = norm.startsWith("/") ? norm : "/" + norm;
  return "file://" + withSlash.split("/").map(encodeURIComponent).join("/").replace(/%2F/g, "/");
}

function posToOffset(doc: string, pos: LspPosition): number {
  let off = 0, line = 0;
  for (let i = 0; i < doc.length; i++) {
    if (line === pos.line) return off + pos.character;
    if (doc[i] === "\n") { line++; off = i + 1; }
  }
  return Math.min(off + pos.character, doc.length);
}

function offsetToPos(doc: string, offset: number): LspPosition {
  let line = 0, lineStart = 0;
  for (let i = 0; i < offset && i < doc.length; i++) {
    if (doc[i] === "\n") { line++; lineStart = i + 1; }
  }
  return { line, character: offset - lineStart };
}

function mdToString(contents: unknown): string {
  if (!contents) return "";
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map(mdToString).filter(Boolean).join("\n\n");
  const c = contents as { value?: string; kind?: string };
  return c.value ?? "";
}

const SEVERITY_MAP: Record<number, Diagnostic["severity"]> = {
  1: "error", 2: "warning", 3: "info", 4: "info",
};

// Parallel diagnostics field for testability (per plan Task 8.3 fallback).
const setTrackedDiagnostics = StateEffect.define<Diagnostic[]>();
const trackedDiagnosticsField = StateField.define<Diagnostic[]>({
  create: () => [],
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setTrackedDiagnostics)) return e.value;
    return v;
  },
});

// ── helpers used by tests and the plugin ────────────────────────────────────

async function fetchHover(client: LspClient, sessionId: string, filePath: string, doc: string, offset: number): Promise<string> {
  const pos = offsetToPos(doc, offset);
  const res = await client.request<{ contents: unknown } | null>(sessionId, "textDocument/hover", { position: pos });
  if (!res) return "";
  return mdToString(res.contents);
}

async function fetchCompletions(
  client: LspClient,
  sessionId: string,
  filePath: string,
  doc: string,
  offset: number,
): Promise<Array<{ label: string; kind?: number; detail?: string; documentation?: unknown }>> {
  const pos = offsetToPos(doc, offset);
  const res = await client.request<{ items?: any[] } | any[] | null>(sessionId, "textDocument/completion", { position: pos });
  if (!res) return [];
  if (Array.isArray(res)) return res;
  return res.items ?? [];
}

function completionKindToType(kind?: number): string | undefined {
  switch (kind) {
    case 3: return "function";
    case 6: return "variable";
    case 7: return "class";
    case 14: return "keyword";
    case 21: return "constant";
    case 22: return "type";
    default: return undefined;
  }
}

// ── extension ───────────────────────────────────────────────────────────────

export function lspExtension(opts: LspExtensionOpts): Extension {
  const { sessionId, filePath, client, onOpenFile, onApplyWorkspaceEdit } = opts;
  const debounceMs = opts.debounceMs ?? 150;
  const myUri = fileUri(filePath);
  let version = 1;

  // Subscribe to publishDiagnostics; bound when plugin initializes.
  let pluginView: EditorView | null = null;
  const unsubNotif = client.onNotification((n: LspNotification) => {
    if (!pluginView) return;
    if (n.method !== "textDocument/publishDiagnostics") return;
    const p = n.params as {
      uri: string;
      diagnostics: Array<{ range: { start: LspPosition; end: LspPosition }; severity?: number; message: string }>;
    };
    if (p.uri !== myUri) return;
    const doc = pluginView.state.doc.toString();
    const cmDiags: Diagnostic[] = p.diagnostics.map((d) => ({
      from: posToOffset(doc, d.range.start),
      to: Math.max(posToOffset(doc, d.range.start) + 1, posToOffset(doc, d.range.end)),
      severity: SEVERITY_MAP[d.severity ?? 1] ?? "error",
      message: d.message,
    }));
    const trDiag = setDiagnostics(pluginView.state, cmDiags);
    pluginView.dispatch({
      ...trDiag,
      effects: [
        ...(Array.isArray(trDiag.effects) ? trDiag.effects : trDiag.effects ? [trDiag.effects] : []),
        setTrackedDiagnostics.of(cmDiags),
      ],
    });
  });

  // Lifecycle plugin: track view, debounce didChange, close on destroy.
  const lifecycle = ViewPlugin.fromClass(class {
    timer: ReturnType<typeof setTimeout> | null = null;
    constructor(view: EditorView) { pluginView = view; }
    update(u: ViewUpdate) {
      if (!u.docChanged) return;
      version++;
      const text = u.state.doc.toString();
      const v = version;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => client.didChange(sessionId, { version: v, text }), debounceMs);
    }
    destroy() {
      if (this.timer) clearTimeout(this.timer);
      unsubNotif();
      void client.closeSession(sessionId);
      pluginView = null;
    }
  });

  // Hover.
  const hover = hoverTooltip(async (view, pos) => {
    const doc = view.state.doc.toString();
    const text = await fetchHover(client, sessionId, filePath, doc, pos);
    if (!text) return null;
    return {
      pos,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-lsp-hover";
        dom.textContent = text;
        return { dom };
      },
    };
  });

  // Completion source.
  const completionSource = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const doc = ctx.state.doc.toString();
    const items = await fetchCompletions(client, sessionId, filePath, doc, ctx.pos);
    if (!items.length) return null;
    return {
      from: ctx.matchBefore(/[\w$]*/)?.from ?? ctx.pos,
      options: items.map((i: any) => ({
        label: i.label,
        type: completionKindToType(i.kind),
        detail: i.detail,
        info: mdToString(i.documentation),
      })),
    };
  };

  // Cmd/Ctrl + click → go to definition.
  const clickHandler = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.metaKey || event.ctrlKey)) return false;
      // posAtCoords can throw in test environments lacking a full layout (jsdom).
      // Fall back to the current selection head when coords cannot be resolved.
      let pos: number;
      try {
        pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      } catch {
        pos = view.state.selection.main.head;
      }
      const doc = view.state.doc.toString();
      const lspPos = offsetToPos(doc, pos);
      void client.request<unknown>(sessionId, "textDocument/definition", { position: lspPos }).then((res) => {
        const def = Array.isArray(res) ? res[0] : res;
        if (!def || typeof def !== "object") return;
        const d = def as { uri: string; range: { start: LspPosition } };
        const path = decodeURI(d.uri.replace(/^file:\/\//, ""));
        onOpenFile(path, d.range.start);
      });
      event.preventDefault();
      return true;
    },
  });

  // F2 → rename.
  const renameKey = EditorView.domEventHandlers({
    keydown(event, view) {
      if (event.key !== "F2") return false;
      const cursor = view.state.selection.main.head;
      const doc = view.state.doc.toString();
      const lspPos = offsetToPos(doc, cursor);
      const newName = window.prompt("Rename symbol to:", "");
      if (!newName) { event.preventDefault(); return true; }
      void client.request<LspWorkspaceEdit | null>(sessionId, "textDocument/rename", { position: lspPos, newName }).then(async (edit) => {
        if (edit) await onApplyWorkspaceEdit(edit);
      });
      event.preventDefault();
      return true;
    },
  });

  return [
    trackedDiagnosticsField,
    lifecycle,
    hover,
    autocompletion({ override: [completionSource], activateOnTyping: true }),
    clickHandler,
    renameKey,
  ];
}

function getDiagnosticsForTest(state: any): Array<{ severity: string; message: string }> {
  try {
    return state.field(trackedDiagnosticsField) ?? [];
  } catch {
    return [];
  }
}

export const __test = {
  posToOffset,
  offsetToPos,
  fetchHover,
  fetchCompletions,
  getDiagnostics: getDiagnosticsForTest,
};
