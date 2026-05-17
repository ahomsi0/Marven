"use client";

import { useRef, useEffect, useCallback, useState, useMemo } from "react";
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

// ── File tree ─────────────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children: TreeNode[];
}

function buildTree(files: WorkspaceFile[]): TreeNode[] {
  const dirs = new Map<string, TreeNode>();
  const root: TreeNode[] = [];
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sorted) {
    const parts = file.path.split("/");
    let currentChildren = root;
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      if (!dirs.has(currentPath)) {
        const dir: TreeNode = { name: parts[i], path: currentPath, type: "folder", children: [] };
        dirs.set(currentPath, dir);
        currentChildren.push(dir);
      }
      currentChildren = dirs.get(currentPath)!.children;
    }
    currentChildren.push({ name: parts[parts.length - 1], path: file.path, type: "file", children: [] });
  }

  function sort(nodes: TreeNode[]): TreeNode[] {
    return nodes
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({ ...n, children: sort(n.children) }));
  }
  return sort(root);
}

function allFolderPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  function walk(ns: TreeNode[]) {
    for (const n of ns) {
      if (n.type === "folder") { paths.push(n.path); walk(n.children); }
    }
  }
  walk(nodes);
  return paths;
}

function fileIconColor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx"].includes(ext)) return "#569cd6";
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return "#d19a66";
  if (["css", "scss", "sass"].includes(ext)) return "#ce9178";
  if (ext === "json") return "#b5cea8";
  if (ext === "html") return "#f28b54";
  if (ext === "md" || ext === "mdx") return "#89c4f4";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext)) return "#22c55e";
  if (ext === "py") return "#3b82f6";
  if (["sh", "bash", "zsh"].includes(ext)) return "#9333ea";
  if (ext === "env" || name.startsWith(".env")) return "#d19a66";
  if (ext === "yml" || ext === "yaml") return "#ce9178";
  return "#888";
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const color = fileIconColor(name);
  const label =
    ext === "ts" ? "TS" : ext === "tsx" ? "TS" :
    ext === "js" ? "JS" : ext === "jsx" ? "JS" :
    ext === "json" ? "{}" :
    ext === "css" || ext === "scss" ? "CSS" :
    ext === "html" ? "HTML" :
    ext === "md" || ext === "mdx" ? "MD" :
    ext === "py" ? "PY" :
    ext === "yml" || ext === "yaml" ? "YML" :
    ["png","jpg","jpeg","gif","svg","webp","ico"].includes(ext) ? "IMG" :
    ext ? ext.toUpperCase().slice(0, 3) : "·";
  return (
    <span className="w-7 shrink-0 text-right font-mono text-[8px] font-bold leading-none" style={{ color }}>
      {label}
    </span>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" style={{ color: "#d19a66" }}>
      <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v1H2V6z" />
      <path d="M2 9h16v5a2 2 0 01-2 2H4a2 2 0 01-2-2V9z" />
    </svg>
  ) : (
    <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor" style={{ color: "#888" }}>
      <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  );
}

function TreeItem({
  node, depth, openFolders, selectedFilePath, onSelectFile, onToggleFolder,
}: {
  node: TreeNode; depth: number; openFolders: Set<string>;
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
}) {
  const isOpen = openFolders.has(node.path);
  const isActive = node.path === selectedFilePath;
  const pl = 8 + depth * 12;

  if (node.type === "folder") {
    return (
      <>
        <button
          type="button"
          onClick={() => onToggleFolder(node.path)}
          className="flex w-full items-center gap-1 py-[3px] text-left text-[#bbb] transition-colors hover:bg-[#2a2a2a] hover:text-[#e0e0e0]"
          style={{ paddingLeft: pl }}
        >
          <svg
            className="h-3 w-3 shrink-0 text-[#777] transition-transform duration-100"
            style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <FolderIcon open={isOpen} />
          <span className="truncate font-mono text-[12px] leading-5">{node.name}</span>
        </button>
        {isOpen && node.children.map((child) => (
          <TreeItem
            key={child.path} node={child} depth={depth + 1}
            openFolders={openFolders} selectedFilePath={selectedFilePath}
            onSelectFile={onSelectFile} onToggleFolder={onToggleFolder}
          />
        ))}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelectFile(node.path)}
      title={node.path}
      className={`flex w-full items-center gap-1 py-[3px] text-left transition-colors ${
        isActive
          ? "bg-[rgba(209,154,102,0.12)] text-[#d19a66]"
          : "text-[#ccc] hover:bg-[#2a2a2a] hover:text-[#e0e0e0]"
      }`}
      style={{ paddingLeft: pl + 16 }}
    >
      <FileIcon name={node.name} />
      <span className="truncate font-mono text-[12px] leading-5">{node.name}</span>
    </button>
  );
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

  const tree = useMemo(() => buildTree(files), [files]);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(allFolderPaths(buildTree(files))));
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreateSubmit() {
    const name = newName.trim();
    if (!name || !workspaceRoot) { setCreating(null); setNewName(""); return; }
    setCreateError(null);
    try {
      const res = await fetch("/api/workspace/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: workspaceRoot, path: name, type: creating }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCreateError(data.error ?? "Failed to create");
        return;
      }
      setCreating(null);
      setNewName("");
      onRefreshFiles();
      if (creating === "file") onSelectFile(name);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create");
    }
  }

  function startCreate(type: "file" | "folder") {
    setCreating(type);
    setNewName("");
    setCreateError(null);
  }

  function collapseAll() {
    setOpenFolders(new Set());
  }

  // When files change (e.g. new folder created), auto-open new folders
  useEffect(() => {
    const newPaths = allFolderPaths(tree);
    setOpenFolders((prev) => {
      const next = new Set(prev);
      newPaths.forEach((p) => next.add(p));
      return next;
    });
  }, [tree]);

  function toggleFolder(path: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

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
          {/* Explorer header */}
          <div className="border-b border-[#2a2a2a] px-3 py-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#555]">Explorer</span>
          </div>
          {/* Project root row */}
          <div className="group flex items-center gap-1 border-b border-[#2a2a2a] px-2 py-1.5">
            <svg className="h-3.5 w-3.5 shrink-0 text-[#d19a66]" viewBox="0 0 20 20" fill="currentColor">
              <path d="M2 6a2 2 0 012-2h4l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
            <span className="flex-1 truncate font-mono text-[11px] font-semibold uppercase tracking-wide text-[#ccc]">{projectName}</span>
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => startCreate("file")}
                disabled={!workspaceRoot}
                title="New file"
                className="rounded p-0.5 text-[#666] transition-colors hover:bg-[#2a2a2a] hover:text-[#d19a66] disabled:opacity-30"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => startCreate("folder")}
                disabled={!workspaceRoot}
                title="New folder"
                className="rounded p-0.5 text-[#666] transition-colors hover:bg-[#2a2a2a] hover:text-[#d19a66] disabled:opacity-30"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m-3-3h6m-9 8h12a2 2 0 002-2V8a2 2 0 00-2-2h-5l-2-2H4a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onRefreshFiles}
                title="Refresh"
                className="rounded p-0.5 text-[#666] transition-colors hover:bg-[#2a2a2a] hover:text-[#d19a66]"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                type="button"
                onClick={collapseAll}
                disabled={openFolders.size === 0}
                title="Collapse all folders"
                className="rounded p-0.5 text-[#666] transition-colors hover:bg-[#2a2a2a] hover:text-[#d19a66] disabled:opacity-30"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
                </svg>
              </button>
            </div>
          </div>
          {creating && (
            <div className="border-b border-[#2a2a2a] bg-[#1e1e1e] px-2 py-1">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[#555]">{creating === "file" ? "📄" : "📁"}</span>
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => { setNewName(e.target.value); setCreateError(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleCreateSubmit(); }
                    if (e.key === "Escape") { setCreating(null); setNewName(""); setCreateError(null); }
                  }}
                  onBlur={() => { if (!newName.trim()) { setCreating(null); setCreateError(null); } }}
                  placeholder={creating === "file" ? "file.ts" : "folder-name"}
                  className="w-full bg-transparent font-mono text-[11px] text-[#d4d4d4] outline-none placeholder:text-[#444]"
                />
              </div>
              {createError && (
                <p className="mt-0.5 font-mono text-[9px] text-red-400">{createError}</p>
              )}
            </div>
          )}
          {/* Tree */}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {tree.length === 0 && (
              <p className="px-3 py-2 text-[10px] text-[#555]">No files</p>
            )}
            {tree.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                openFolders={openFolders}
                selectedFilePath={selectedFilePath}
                onSelectFile={onSelectFile}
                onToggleFolder={toggleFolder}
              />
            ))}
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
