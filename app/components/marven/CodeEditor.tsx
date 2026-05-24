"use client";

import { useEffect, useRef, useState } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { rust } from "@codemirror/lang-rust";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { php } from "@codemirror/lang-php";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";
import { search, openSearchPanel, closeSearchPanel } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { lspExtension } from "@/lib/editor/lspExtension";
import { lspClient } from "@/lib/editor/lspClient";
import { languageIdForExtension, type LanguageId } from "@/lib/editor/lspServers";
import type { LspWorkspaceEdit, LspPosition } from "@/types";

// ── Public API ────────────────────────────────────────────────────────────────

export interface CodeEditorActions {
  /** Get the current selected text + range, or null. */
  getSelection: () => { text: string; from: number; to: number } | null;
  /** Replace a [from, to) range with `text`. */
  replaceRange: (from: number, to: number, text: string) => void;
  /** Focus the editor. */
  focus: () => void;
  /** Scroll a character offset into view (used by Find for next/prev). */
  scrollToPos: (pos: number) => void;
  /** Scroll a 1-based line number into view, optionally placing the cursor at
   * `col` (1-based) on that line. Used by the global-search panel to jump to
   * a specific match. */
  scrollToLine: (line: number, col?: number) => void;
  /** Set the editor's selection range. Both offsets are character positions. */
  setSelection: (from: number, to: number) => void;
  /** Get a [from, to) range corresponding to the Nth match of `query` (case-insensitive). */
  findRange: (query: string, occurrence: number) => { from: number; to: number } | null;
  /** Get current full document text. */
  getContent: () => string;
  /** Open the built-in CodeMirror search panel. */
  openSearch: () => void;
  /** Close the built-in CodeMirror search panel. */
  closeSearch: () => void;
}

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** File extension or language ID. Falls back to no language extension when unknown. */
  language: string;
  /** Mirrors data-theme on <html>. */
  theme: import("@/lib/theme").Theme;
  readOnly?: boolean;
  /** Optional save handler — when set, ⌘S inside the editor calls this. */
  onSave?: () => void;
  onReady?: (actions: CodeEditorActions) => void;
  /** Placeholder text shown when the document is empty. */
  placeholderText?: string;
  /** When true, renders a thin scroll progress indicator on the right edge. */
  showMinimap?: boolean;
  /** Absolute path of the file being edited; required to enable LSP. */
  filePath?: string;
  /** Absolute path of the workspace root; required to enable LSP. */
  workspaceRoot?: string;
  /** Called when LSP go-to-definition wants to open a file. */
  onOpenFile?: (path: string, position?: LspPosition) => void;
  /** Called when LSP rename produces a multi-file edit. */
  onApplyWorkspaceEdit?: (edit: LspWorkspaceEdit) => Promise<void>;
}

// ── Language picker ───────────────────────────────────────────────────────────

function languageExtension(lang: string): Extension | null {
  const ext = lang.toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript({ jsx: true });
    case "ts":
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "py":
      return python();
    case "html":
    case "htm":
      return html();
    case "css":
    case "scss":
      return css();
    case "json":
      return json();
    case "md":
    case "mdx":
    case "markdown":
      return markdown();
    case "yaml":
    case "yml":
      return yaml();
    case "rs":
      return rust();
    case "java":
      return java();
    case "c":
    case "cpp":
    case "cc":
    case "h":
    case "hpp":
      return cpp();
    case "php":
      return php();
    case "sql":
      return sql();
    case "xml":
    case "svg":
      return xml();
    default:
      return null;
  }
}

// ── Themes ────────────────────────────────────────────────────────────────────

// Light theme — VS Code-inspired palette. Hardcoded colors are fine inside the
// editor surface; the wrapper around the editor still uses the Marven CSS
// variables for the chrome.
const lightTheme = EditorView.theme(
  {
    "&": {
      color: "#1f1f1f",
      backgroundColor: "var(--m-surface)",
      height: "100%",
    },
    ".cm-scroller": {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontSize: "12px",
      lineHeight: "28px",
    },
    ".cm-content": {
      caretColor: "#1f1f1f",
      padding: "12px 0",
    },
    ".cm-line": {
      padding: "0 16px",
    },
    ".cm-gutters": {
      backgroundColor: "var(--m-bg)",
      color: "var(--m-text-faint)",
      border: "none",
      borderRight: "1px solid var(--m-border-subtle)",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(0, 0, 0, 0.03)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--m-text-muted)",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(209, 154, 102, 0.20)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "rgba(209, 154, 102, 0.28)",
    },
    ".cm-cursor": {
      borderLeftColor: "#1f1f1f",
    },
    ".cm-searchMatch": {
      backgroundColor: "rgba(234, 179, 8, 0.30)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgba(234, 179, 8, 0.55)",
    },
    // Syntax token colors (the light scheme) — VS Code-ish, readable on white.
    ".tok-keyword": { color: "#0000ff" },
    ".tok-string": { color: "#a31515" },
    ".tok-number": { color: "#098658" },
    ".tok-comment": { color: "#008000", fontStyle: "italic" },
  },
  { dark: false },
);

// Custom CodeMirror highlight rules for the light theme.
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const lightHighlight = HighlightStyle.define([
  { tag: t.keyword, color: "#0000ff" },
  { tag: [t.string, t.special(t.string)], color: "#a31515" },
  { tag: [t.number, t.bool, t.null], color: "#098658" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#008000", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#795e26" },
  { tag: [t.className, t.typeName], color: "#267f99" },
  { tag: [t.propertyName, t.attributeName], color: "#001080" },
  { tag: [t.tagName], color: "#800000" },
  { tag: [t.operator, t.punctuation], color: "#1f1f1f" },
  { tag: t.heading, color: "#0000ff", fontWeight: "bold" },
  { tag: t.link, color: "#0000ff", textDecoration: "underline" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
]);

// Loaded AFTER the theme compartment so it overrides both oneDark and the
// custom light theme rules. Three things this does:
//   1. Suppress the bracket-matching highlight (chunky gray box on `>`/`}`)
//   2. Suppress the active-line highlight (tinted strip across the cursor row)
//   3. Force the editor background to match Marven's app background — oneDark
//      paints a blue-ish #282c34 by default that reads as a "highlight" next
//      to the darker app chrome.
const disableBracketHighlight = EditorView.theme({
  "&": {
    backgroundColor: "var(--m-surface) !important",
  },
  ".cm-content": {
    backgroundColor: "var(--m-surface) !important",
  },
  ".cm-gutters": {
    backgroundColor: "var(--m-surface) !important",
    borderRight: "none !important",
  },
  ".cm-matchingBracket, .cm-nonmatchingBracket": {
    backgroundColor: "transparent !important",
    outline: "none !important",
    color: "inherit !important",
  },
  "&.cm-focused .cm-activeLine, .cm-activeLine": {
    backgroundColor: "transparent !important",
  },
  "&.cm-focused .cm-activeLineGutter, .cm-activeLineGutter": {
    backgroundColor: "transparent !important",
  },
});

const typographyTheme = EditorView.theme({
  "&": {
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize: "12px",
    lineHeight: "28px",
  },
  ".cm-content": {
    padding: "12px 0",
  },
  ".cm-line": {
    padding: "0 16px",
  },
  ".cm-gutters": {
    paddingRight: "4px",
    minWidth: "40px",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 6px 0 8px",
    fontSize: "11px",
  },
  ".cm-tooltip": {
    fontSize: "11px",
  },
});

// ── React wrapper ─────────────────────────────────────────────────────────────

export function CodeEditor({
  value,
  onChange,
  language,
  theme,
  readOnly = false,
  onSave,
  onReady,
  placeholderText,
  showMinimap = false,
  filePath,
  workspaceRoot,
  onOpenFile,
  onApplyWorkspaceEdit,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  // Compartments allow us to dynamically swap extensions (language / theme /
  // read-only) without recreating the entire EditorView.
  const langCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const readOnlyCompartment = useRef(new Compartment());
  const saveKeymapCompartment = useRef(new Compartment());
  const lspCompartment = useRef(new Compartment());

  // Latest values reachable from inside extensions without recreating them.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // ─ Mount once ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hostRef.current) return;

    const langExt = languageExtension(language);
    const themeExt =
      theme !== "light"
        ? oneDark
        : [lightTheme, syntaxHighlighting(lightHighlight)];

    const saveBinding: Extension = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
    ]);

    const extensions: Extension[] = [
      basicSetup,
      keymap.of([indentWithTab]),
      saveKeymapCompartment.current.of(saveBinding),
      EditorView.lineWrapping,
      typographyTheme,
      themeCompartment.current.of(themeExt),
      disableBracketHighlight,
      langCompartment.current.of(langExt ?? []),
      readOnlyCompartment.current.of(
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      ),
      search({ top: true }),
      lspCompartment.current.of([]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          // If this change came from our own external-value sync (parent
          // pushing a new `value`), don't bubble it back up as a user edit.
          if (suppressNextChangeRef.current) {
            suppressNextChangeRef.current = false;
            return;
          }
          const next = u.state.doc.toString();
          onChangeRef.current(next);
        }
        // Track scroll position for the minimap progress indicator.
        if (u.geometryChanged || u.docChanged || u.transactions.some((tr) => tr.scrollIntoView)) {
          const { scrollTop, scrollHeight, clientHeight } = u.view.scrollDOM;
          const prog = scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0;
          setScrollProgress(prog);
        }
      }),
    ];

    if (placeholderText) extensions.push(placeholder(placeholderText));

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    if (onReady) {
      const actions: CodeEditorActions = {
        getSelection: () => {
          const v = viewRef.current;
          if (!v) return null;
          const sel = v.state.selection.main;
          if (sel.empty) return null;
          return {
            text: v.state.doc.sliceString(sel.from, sel.to),
            from: sel.from,
            to: sel.to,
          };
        },
        replaceRange: (from, to, text) => {
          const v = viewRef.current;
          if (!v) return;
          v.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
          });
        },
        focus: () => viewRef.current?.focus(),
        scrollToPos: (pos) => {
          const v = viewRef.current;
          if (!v) return;
          const clamped = Math.max(0, Math.min(pos, v.state.doc.length));
          v.dispatch({
            effects: EditorView.scrollIntoView(clamped, { y: "center" }),
          });
        },
        scrollToLine: (line, col) => {
          const v = viewRef.current;
          if (!v) return;
          const totalLines = v.state.doc.lines;
          // Clamp to a valid 1-based line. CodeMirror's doc.line is 1-indexed.
          const safeLine = Math.max(1, Math.min(line, totalLines));
          const lineInfo = v.state.doc.line(safeLine);
          // Place cursor at col (1-based). Default col=1 → line start. Clamp to
          // the line's actual length so we never overshoot when col is stale.
          const lineLen = lineInfo.to - lineInfo.from;
          const safeCol = Math.max(1, Math.min(col ?? 1, lineLen + 1));
          const cursor = lineInfo.from + (safeCol - 1);
          v.dispatch({
            selection: { anchor: cursor },
            effects: EditorView.scrollIntoView(cursor, { y: "center" }),
          });
        },
        setSelection: (from, to) => {
          const v = viewRef.current;
          if (!v) return;
          const docLen = v.state.doc.length;
          const safeFrom = Math.max(0, Math.min(from, docLen));
          const safeTo = Math.max(0, Math.min(to, docLen));
          v.dispatch({
            selection: { anchor: safeFrom, head: safeTo },
          });
        },
        findRange: (query, occurrence) => {
          const v = viewRef.current;
          if (!v || !query) return null;
          const doc = v.state.doc.toString();
          const hay = doc.toLowerCase();
          const needle = query.toLowerCase();
          if (!needle) return null;
          let count = 0;
          let i = 0;
          while (i <= hay.length - needle.length) {
            const idx = hay.indexOf(needle, i);
            if (idx === -1) return null;
            if (count === occurrence) {
              return { from: idx, to: idx + needle.length };
            }
            count += 1;
            i = idx + needle.length;
            if (count > 10000) return null;
          }
          return null;
        },
        getContent: () => viewRef.current?.state.doc.toString() ?? "",
        openSearch: () => {
          if (viewRef.current) openSearchPanel(viewRef.current);
        },
        closeSearch: () => {
          if (viewRef.current) closeSearchPanel(viewRef.current);
        },
      };
      onReady(actions);
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // We deliberately mount only once. Prop changes propagate via the
    // dedicated reconfigure effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─ LSP wiring ───────────────────────────────────────────────────────────────
  // Open an LSP session when (filePath, workspaceRoot) change and the file
  // has a known LSP language. Reconfigures the lspCompartment with a fresh
  // extension. Closes the session on unmount or when inputs change.
  useEffect(() => {
    const ext = filePath ? filePath.split(".").pop() ?? "" : "";
    const langId: LanguageId | null = languageIdForExtension(ext);
    if (!langId || !filePath || !workspaceRoot || !viewRef.current) return;

    let cancelled = false;
    let sessionIdLocal: string | null = null;

    (async () => {
      const r = await lspClient.ensure(langId);
      if (r.status !== "ready" || cancelled || !viewRef.current) return;
      try {
        const { sessionId } = await lspClient.openSession({
          languageId: langId,
          filePath,
          workspaceRoot,
          text: viewRef.current.state.doc.toString(),
        });
        if (cancelled) {
          lspClient.closeSession(sessionId);
          return;
        }
        sessionIdLocal = sessionId;
        viewRef.current.dispatch({
          effects: lspCompartment.current.reconfigure(
            lspExtension({
              sessionId,
              languageId: langId,
              filePath,
              client: lspClient,
              onOpenFile: onOpenFile ?? (() => {}),
              onApplyWorkspaceEdit: onApplyWorkspaceEdit ?? (async () => {}),
            }),
          ),
        });
      } catch {
        // Swallow — LSP failures should not break the editor.
      }
    })();

    return () => {
      cancelled = true;
      if (sessionIdLocal) lspClient.closeSession(sessionIdLocal);
      if (viewRef.current) {
        viewRef.current.dispatch({ effects: lspCompartment.current.reconfigure([]) });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, workspaceRoot]);

  // ─ External value updates ───────────────────────────────────────────────────
  // When the parent pushes a new `value` prop (e.g. file just finished loading
  // from disk), we dispatch a change that updates the editor doc. The internal
  // updateListener treats that as a user edit and fires onChange — which makes
  // the parent re-mark the buffer dirty. That sets up a deadlock where the
  // load handler later sees dirty=true and refuses to apply its result, so the
  // file shows the loading spinner forever. Suppress onChange while we apply.
  const suppressNextChangeRef = useRef(false);
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) {
      suppressNextChangeRef.current = true;
      v.dispatch({
        changes: { from: 0, to: cur.length, insert: value },
      });
    }
  }, [value]);

  // ─ Language swap ────────────────────────────────────────────────────────────
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const langExt = languageExtension(language);
    v.dispatch({
      effects: langCompartment.current.reconfigure(langExt ?? []),
    });
  }, [language]);

  // ─ Theme swap ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const themeExt =
      theme !== "light"
        ? oneDark
        : [lightTheme, syntaxHighlighting(lightHighlight)];
    v.dispatch({
      effects: themeCompartment.current.reconfigure(themeExt),
    });
  }, [theme]);

  // ─ ReadOnly swap ────────────────────────────────────────────────────────────
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({
      effects: readOnlyCompartment.current.reconfigure(
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      ),
    });
  }, [readOnly]);

  // ─ Save keymap refresh (binding is stable via ref, but if onSave goes from
  //   undefined → defined we still want a no-op stub installed) ───────────────
  // Nothing to do here — the keymap references onSaveRef and naturally picks
  // up the latest handler.

  return (
    <div className="relative h-full w-full min-h-0 min-w-0 overflow-hidden">
      <div
        ref={hostRef}
        className="marven-scroll h-full w-full min-h-0 min-w-0 overflow-hidden bg-[var(--m-surface)]"
      />
      {showMinimap && (
        <div
          className="pointer-events-none absolute right-0 top-0 h-full w-[3px] bg-[var(--m-border-subtle)]"
          aria-hidden="true"
        >
          <div
            className="absolute w-full bg-[#d19a66]/50"
            style={{
              top: `${scrollProgress * 100}%`,
              height: "20%",
              transform: "translateY(-50%)",
            }}
          />
        </div>
      )}
    </div>
  );
}
