"use client";

import { useRef, useEffect, useCallback } from "react";
import type { WorkspaceFile } from "@/types";

interface EditorPanelProps {
  files: WorkspaceFile[];
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  fileContent: string;
  isFileLoading: boolean;
  isFileDirty: boolean;
  terminalOutput: string;
  showTerminal: boolean;
  onToggleTerminal: () => void;
  onSelectFile: (path: string) => void;
  onFileContentChange: (value: string) => void;
  onSaveFile: () => void;
  onRefreshFiles: () => void;
}

// ── Syntax highlighting ────────────────────────────────────────────────────────

const JS_KEYWORDS = new Set([
  "const", "let", "var", "function", "class", "return", "if", "else", "for",
  "while", "do", "switch", "case", "break", "continue", "new", "typeof",
  "instanceof", "import", "export", "from", "default", "async", "await",
  "try", "catch", "finally", "throw", "extends", "interface", "type", "enum",
  "implements", "abstract", "declare", "readonly", "public", "private",
  "protected", "static", "override", "void", "null", "undefined", "true",
  "false", "this", "super", "in", "of", "yield", "delete", "keyof", "infer",
  "never", "unknown", "any", "string", "number", "boolean", "object",
]);

type TokType = "comment" | "string" | "keyword" | "number" | "text";
type Tok = { t: TokType; v: string };

function tokenizeJs(code: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < code.length) {
    // line comment
    if (code[i] === "/" && code[i + 1] === "/") {
      const s = i;
      while (i < code.length && code[i] !== "\n") i++;
      toks.push({ t: "comment", v: code.slice(s, i) });
      continue;
    }
    // block comment
    if (code[i] === "/" && code[i + 1] === "*") {
      const s = i; i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      toks.push({ t: "comment", v: code.slice(s, i) });
      continue;
    }
    // string / template literal
    if (code[i] === '"' || code[i] === "'" || code[i] === "`") {
      const q = code[i]; const s = i; i++;
      while (i < code.length) {
        if (code[i] === "\\") { i += 2; continue; }
        if (code[i] === q) { i++; break; }
        i++;
      }
      toks.push({ t: "string", v: code.slice(s, i) });
      continue;
    }
    // number
    if (/\d/.test(code[i]) || (code[i] === "." && /\d/.test(code[i + 1] ?? ""))) {
      const s = i;
      while (i < code.length && /[\d.xXa-fA-F_]/.test(code[i])) i++;
      toks.push({ t: "number", v: code.slice(s, i) });
      continue;
    }
    // identifier / keyword
    if (/[a-zA-Z_$]/.test(code[i])) {
      const s = i;
      while (i < code.length && /[a-zA-Z0-9_$]/.test(code[i])) i++;
      const w = code.slice(s, i);
      toks.push({ t: JS_KEYWORDS.has(w) ? "keyword" : "text", v: w });
      continue;
    }
    toks.push({ t: "text", v: code[i] });
    i++;
  }
  return toks;
}

function tokenizeJson(code: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < code.length) {
    if (code[i] === '"') {
      const s = i; i++;
      while (i < code.length) {
        if (code[i] === "\\") { i += 2; continue; }
        if (code[i] === '"') { i++; break; }
        i++;
      }
      // peek ahead — if followed by ":" it's a key
      let j = i; while (j < code.length && (code[j] === " " || code[j] === "\t")) j++;
      toks.push({ t: code[j] === ":" ? "keyword" : "string", v: code.slice(s, i) });
      continue;
    }
    if (/\d|-/.test(code[i])) {
      const s = i;
      while (i < code.length && /[\d.eE+\-]/.test(code[i])) i++;
      toks.push({ t: "number", v: code.slice(s, i) });
      continue;
    }
    if (code.slice(i, i + 4) === "true" || code.slice(i, i + 5) === "false" || code.slice(i, i + 4) === "null") {
      const end = code[i + 4] === "e" ? i + 5 : i + 4;
      toks.push({ t: "keyword", v: code.slice(i, end) });
      i = end;
      continue;
    }
    toks.push({ t: "text", v: code[i] });
    i++;
  }
  return toks;
}

const COLOR: Record<TokType, string> = {
  comment: "#6a9955",
  string: "#ce9178",
  keyword: "#569cd6",
  number: "#b5cea8",
  text: "#d4d4d4",
};

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightCode(code: string, ext: string): string {
  if (code.length > 80_000) return esc(code); // skip very large files
  let toks: Tok[] | null = null;
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(ext)) toks = tokenizeJs(code);
  else if (ext === "json") toks = tokenizeJson(code);
  if (!toks) return esc(code);
  return toks
    .map(({ t, v }) => {
      const e = esc(v);
      return t === "text" ? e : `<span style="color:${COLOR[t]}">${e}</span>`;
    })
    .join("");
}

// ─────────────────────────────────────────────────────────────────────────────

export function EditorPanel({
  files,
  workspaceRoot,
  selectedFilePath,
  fileContent,
  isFileLoading,
  isFileDirty,
  terminalOutput,
  showTerminal,
  onToggleTerminal,
  onSelectFile,
  onFileContentChange,
  onSaveFile,
  onRefreshFiles,
}: EditorPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const activeFileName = selectedFilePath?.split("/").pop() ?? null;
  const fileExt = activeFileName?.split(".").pop()?.toLowerCase() ?? "";
  const projectName = workspaceRoot?.split("/").filter(Boolean).pop() ?? "workspace";
  const relativeFilePath = workspaceRoot && selectedFilePath
    ? selectedFilePath.startsWith(workspaceRoot)
      ? selectedFilePath.slice(workspaceRoot.length).replace(/^\//, "")
      : activeFileName ?? ""
    : activeFileName ?? "";

  const highlighted = isFileLoading ? "" : highlightCode(fileContent, fileExt);
  const lineCount = isFileLoading ? 1 : (fileContent.split("\n").length || 1);

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const pre = preRef.current;
    const gut = gutterRef.current;
    if (!ta) return;
    if (pre) { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; }
    if (gut) gut.scrollTop = ta.scrollTop;
  }, []);

  useEffect(() => {
    syncScroll();
  }, [fileContent, syncScroll]);

  // Detect language label for status bar
  const langLabel = ["ts", "tsx"].includes(fileExt)
    ? "TypeScript"
    : ["js", "jsx"].includes(fileExt)
    ? "JavaScript"
    : fileExt.toUpperCase() || "Plain Text";

  return (
    <div className="flex h-full min-w-0 flex-col bg-[#1e1e1e]">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* File explorer */}
        <div className="flex w-[220px] min-w-[220px] flex-col border-r border-[#333] bg-[#1a1a1a]">
          <div className="flex items-center justify-between border-b border-[#333] px-3 py-2">
            <span className="text-[9px] uppercase tracking-[0.2em] text-[#666]">{projectName}</span>
            <button
              type="button"
              onClick={onRefreshFiles}
              className="text-[11px] text-[#666] hover:text-[#aaa] transition-colors"
            >
              ↻
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {files.length === 0 && (
              <p className="px-3 py-2 text-[10px] text-[#555]">No files</p>
            )}
            {files.map((file) => {
              const isActive = file.path === selectedFilePath;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => onSelectFile(file.path)}
                  title={file.path}
                  className={`flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left transition-colors ${
                    isActive
                      ? "border-[#d19a66] bg-[rgba(209,154,102,0.08)] text-[#d19a66]"
                      : "border-transparent text-[#888] hover:bg-[#252525] hover:text-[#ccc]"
                  }`}
                >
                  <span className="truncate text-[11px] font-mono">{file.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Editor */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Tab bar */}
          <div className="flex items-stretch border-b border-[#333] bg-[#1a1a1a]">
            {activeFileName ? (
              <div className="flex items-center gap-1.5 border-r border-[#333] bg-[#1e1e1e] px-4 py-2 font-mono" title={selectedFilePath ?? ""}>
                {relativeFilePath.includes("/") && (
                  <span className="text-[10px] text-[#555]">
                    {relativeFilePath.slice(0, relativeFilePath.lastIndexOf("/") + 1)}
                  </span>
                )}
                <span className="text-[11px] text-[#aaa]">{activeFileName}</span>
                {isFileDirty && <span className="text-[#d19a66] text-[10px]">●</span>}
              </div>
            ) : (
              <div className="px-4 py-2 text-[11px] text-[#555]">No file open</div>
            )}
            <div className="ml-auto flex items-center gap-2 px-3">
              {isFileDirty && (
                <button
                  type="button"
                  onClick={onSaveFile}
                  className="rounded border border-[#444] px-2 py-1 text-[10px] text-[#aaa] transition-colors hover:border-[#666] hover:text-[#ddd]"
                >
                  Save
                </button>
              )}
            </div>
          </div>

          {/* Code area — highlighted pre + transparent textarea overlay */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/* Line numbers */}
            <div
              ref={gutterRef}
              className="w-10 shrink-0 select-none overflow-hidden border-r border-[#2a2a2a] bg-[#1a1a1a] py-3 pr-2 text-right font-mono text-[11px] leading-7 text-[#555]"
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>

            {/* Editor content */}
            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
              {/* Highlighted layer */}
              <pre
                ref={preRef}
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-auto px-4 py-3 font-mono text-[12px] leading-7 whitespace-pre"
                style={{ margin: 0, background: "transparent", color: "#d4d4d4" }}
                dangerouslySetInnerHTML={{ __html: highlighted || "&nbsp;" }}
              />
              {/* Editable layer */}
              <textarea
                ref={textareaRef}
                value={isFileLoading ? "Loading..." : fileContent}
                onChange={(e) => onFileContentChange(e.target.value)}
                onScroll={syncScroll}
                disabled={!selectedFilePath || isFileLoading}
                spellCheck={false}
                className="absolute inset-0 h-full w-full resize-none border-0 bg-transparent px-4 py-3 font-mono text-[12px] leading-7 outline-none disabled:opacity-40"
                style={{ color: "transparent", caretColor: "#ddd", overflow: "auto" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Terminal */}
      <div className={`border-t border-[#333] bg-[#161616] ${showTerminal ? "h-[120px]" : "h-7"} flex flex-col shrink-0 transition-all`}>
        <div
          className="flex h-7 cursor-pointer items-center gap-3 border-b border-[#2a2a2a] px-3"
          onClick={onToggleTerminal}
        >
          <span className="text-[9px] uppercase tracking-[0.2em] text-[#666]">Terminal</span>
          <span className="text-[9px] text-[#555]">{showTerminal ? "▾" : "▸"}</span>
        </div>
        {showTerminal && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-6 text-[#aaa] whitespace-pre-wrap">
            {terminalOutput || <span className="text-[#444]">No output yet.</span>}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-[#333] bg-[#1a1a1a] px-3 py-1 font-mono text-[9px] text-[#666]">
        <span>{projectName}</span>
        <div className="flex gap-4">
          <span>{activeFileName ?? "—"}</span>
          <span className="text-[#d19a66]/50">{langLabel}</span>
        </div>
      </div>
    </div>
  );
}
