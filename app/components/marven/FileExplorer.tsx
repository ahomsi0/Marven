"use client";

import { useState, useEffect, useMemo } from "react";
import type { WorkspaceFile } from "@/types";

interface FileExplorerProps {
  files: WorkspaceFile[];
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  onRefreshFiles: () => void;
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

  function ensureDir(dirPath: string): TreeNode[] {
    if (!dirPath) return root;
    if (dirs.has(dirPath)) return dirs.get(dirPath)!.children;
    const parts = dirPath.split("/");
    let parent = root;
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!dirs.has(cur)) {
        const node: TreeNode = { name: part, path: cur, type: "folder", children: [] };
        dirs.set(cur, node);
        parent.push(node);
      }
      parent = dirs.get(cur)!.children;
    }
    return parent;
  }

  for (const entry of sorted) {
    if (entry.type === "folder") {
      ensureDir(entry.path);
      continue;
    }
    const parts = entry.path.split("/");
    const parent = ensureDir(parts.slice(0, -1).join("/"));
    parent.push({ name: parts[parts.length - 1], path: entry.path, type: "file", children: [] });
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
    <span className="w-5 shrink-0 text-right font-mono text-[8px] font-bold leading-none" style={{ color }}>
      {label}
    </span>
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
  const pl = 8 + depth * 10;

  if (node.type === "folder") {
    return (
      <>
        <button
          type="button"
          onClick={() => onToggleFolder(node.path)}
          className="flex w-full items-center gap-1 py-[2px] text-left text-[#bbb] transition-colors hover:bg-[#2a2a2a] hover:text-[#e0e0e0]"
          style={{ paddingLeft: pl }}
        >
          <svg
            className="h-3 w-3 shrink-0 text-[#777] transition-transform duration-100"
            style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
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
      className={`flex w-full items-center gap-1 py-[2px] text-left transition-colors text-[12px] ${
        isActive
          ? "bg-[rgba(209,154,102,0.12)] text-[#d19a66]"
          : "text-[#ccc] hover:bg-[#2a2a2a] hover:text-[#e0e0e0]"
      }`}
      style={{ paddingLeft: pl + 14 }}
    >
      <FileIcon name={node.name} />
      <span className="truncate font-mono text-[12px] leading-5">{node.name}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function FileExplorer({
  files,
  workspaceRoot,
  selectedFilePath,
  onSelectFile,
  onRefreshFiles,
}: FileExplorerProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(allFolderPaths(buildTree(files))));
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const projectName = workspaceRoot?.split("/").filter(Boolean).pop() ?? "workspace";

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

  return (
    <div className="flex h-full flex-col bg-[#1a1a1a]">
      {/* Explorer header */}
      <div className="border-b border-[#2a2a2a] px-3 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#555]">Explorer</span>
      </div>

      {/* Project root row */}
      <div className="group flex items-center gap-1 border-b border-[#2a2a2a] px-2 py-1.5">
        <svg
          className="h-3 w-3 shrink-0 text-[#777]"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          style={{ transform: "rotate(90deg)" }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
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

      {/* Inline create input */}
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
  );
}
