"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import type { WorkspaceFile } from "@/types";
import { FileIcon as FileGlyph, FolderIcon as FolderGlyph } from "./Icons";

interface ContextMenuState {
  node: TreeNode;
  x: number;
  y: number;
}

interface FileExplorerProps {
  files: WorkspaceFile[];
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  onRefreshFiles: () => void;
  onOpenFolder: () => void;
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
  // Symbol-based icons matching VS Code's compact style — keeps widths predictable
  // so file names align with folder names in the tree.
  let label: string;
  let color: string;
  let size = "text-[10px]";
  if (ext === "html") { label = "<>"; color = "#e67e22"; }
  else if (ext === "css" || ext === "scss") { label = "#"; color = "#ec4899"; size = "text-[12px]"; }
  else if (ext === "json") { label = "{}"; color = "#eab308"; }
  else if (ext === "md" || ext === "mdx") { label = "MD"; color = "#5b9cf6"; }
  else if (ext === "ts" || ext === "tsx") { label = "TS"; color = "#3b82f6"; }
  else if (ext === "js" || ext === "jsx") { label = "JS"; color = "#eab308"; }
  else if (ext === "py") { label = "PY"; color = "#3b82f6"; }
  else if (["png","jpg","jpeg","gif","svg","webp","ico"].includes(ext)) { label = "·"; color = "#a855f7"; size = "text-[12px]"; }
  else { label = "·"; color = "#888"; size = "text-[12px]"; }
  return (
    <span className={`inline-flex h-3 w-3 shrink-0 items-center justify-center font-mono ${size} font-bold leading-none`} style={{ color }}>
      {label}
    </span>
  );
}

function TreeItem({
  node, depth, openFolders, selectedFilePath, onSelectFile, onToggleFolder, onContextMenu,
}: {
  node: TreeNode; depth: number; openFolders: Set<string>;
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
  onContextMenu: (node: TreeNode, x: number, y: number) => void;
}) {
  const isOpen = openFolders.has(node.path);
  const isActive = node.path === selectedFilePath;
  const pl = 8 + depth * 10;

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(node, e.clientX, e.clientY);
  }

  if (node.type === "folder") {
    return (
      <>
        <button
          type="button"
          onClick={() => onToggleFolder(node.path)}
          onContextMenu={handleContextMenu}
          className="flex w-full items-center gap-1 py-[2px] text-left text-[var(--m-text)] transition-colors hover:bg-[var(--m-surface-3)] hover:text-[var(--m-text)]"
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
            onContextMenu={onContextMenu}
          />
        ))}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelectFile(node.path)}
      onContextMenu={handleContextMenu}
      title={node.path}
      className={`flex w-full items-center gap-1 py-[2px] text-left transition-colors text-[12px] ${
        isActive
          ? "bg-[var(--m-accent-soft)] text-[var(--m-accent)]"
          : "text-[var(--m-text)] hover:bg-[var(--m-surface-3)] hover:text-[var(--m-text)]"
      }`}
      style={{ paddingLeft: pl }}
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
  onOpenFolder,
}: FileExplorerProps) {
  const folderName = workspaceRoot?.split("/").filter(Boolean).pop() ?? null;
  const tree = useMemo(() => buildTree(files), [files]);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(allFolderPaths(buildTree(files))));
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const projectName = workspaceRoot?.split("/").filter(Boolean).pop() ?? "workspace";

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    function handleOutside(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [contextMenu]);

  async function handleDelete(node: TreeNode) {
    setContextMenu(null);
    const label = node.type === "folder" ? `folder "${node.name}" and all its contents` : `file "${node.name}"`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    try {
      const res = await fetch("/api/workspace/file-ops", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: node.path, root: workspaceRoot }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? "Delete failed");
        return;
      }
      onRefreshFiles();
    } catch {
      alert("Delete failed");
    }
  }

  async function handleCopy(node: TreeNode) {
    setContextMenu(null);
    try {
      const res = await fetch("/api/workspace/file-ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: node.path, root: workspaceRoot }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? "Copy failed");
        return;
      }
      const data = await res.json();
      onRefreshFiles();
      if (node.type === "file" && data.path) onSelectFile(data.path);
    } catch {
      alert("Copy failed");
    }
  }

  function handleCopyPath(node: TreeNode) {
    setContextMenu(null);
    navigator.clipboard.writeText(node.path).catch(() => {});
  }

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
    <div className="flex h-full flex-col bg-[var(--m-bg)]">
      {/* Open folder button (replaces Explorer header) */}
      <div className="border-b border-[var(--m-border-subtle)] px-3 py-3">
        <button
          type="button"
          onClick={onOpenFolder}
          className="flex w-full items-center gap-2 rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)] px-3 py-2 text-left transition-colors hover:border-[var(--m-text-faint)]"
        >
          <svg className="h-3.5 w-3.5 shrink-0 text-[#d19a66]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25" />
          </svg>
          {folderName ? (
            <span className="truncate text-[11px] text-[var(--m-text)]">{folderName}</span>
          ) : (
            <span className="text-[11px] text-[var(--m-text-muted)]">Open Folder...</span>
          )}
          {workspaceRoot && (
            <span className="ml-auto shrink-0 text-[9px] text-[var(--m-text-muted)]">change</span>
          )}
        </button>
      </div>

      {/* Project root row */}
      <div className="group flex items-center gap-1 border-b border-[var(--m-border-subtle)] px-2 py-1.5">
        <button
          type="button"
          onClick={() => setTreeCollapsed((v) => !v)}
          aria-label={treeCollapsed ? "Expand file tree" : "Collapse file tree"}
          title={treeCollapsed ? "Expand file tree" : "Collapse file tree"}
          className="shrink-0 rounded p-0.5 text-[#777] transition-colors hover:bg-[var(--m-surface-3)] hover:text-[var(--m-text-muted)]"
        >
          <svg
            className="h-3 w-3"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
            style={{ transform: treeCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.15s ease" }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <span className="flex-1 truncate font-mono text-[11px] font-semibold uppercase tracking-wide text-[var(--m-text)]">{projectName}</span>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={() => startCreate("file")}
            disabled={!workspaceRoot}
            title="New file"
            className="rounded p-0.5 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-3)] hover:text-[var(--m-accent)] disabled:opacity-30"
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
            className="rounded p-0.5 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-3)] hover:text-[var(--m-accent)] disabled:opacity-30"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m-3-3h6m-9 8h12a2 2 0 002-2V8a2 2 0 00-2-2h-5l-2-2H4a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onRefreshFiles}
            title="Refresh"
            className="rounded p-0.5 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-3)] hover:text-[var(--m-accent)]"
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
            className="rounded p-0.5 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-3)] hover:text-[var(--m-accent)] disabled:opacity-30"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
            </svg>
          </button>
        </div>
      </div>

      {/* Inline create input */}
      {creating && (
        <div className="border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-2 py-1">
          <div className="flex items-center gap-1">
            <span className="inline-flex text-[#555]">{creating === "file" ? <FileGlyph /> : <FolderGlyph />}</span>
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
              className="w-full bg-transparent font-mono text-[11px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)]"
            />
          </div>
          {createError && (
            <p className="mt-0.5 font-mono text-[9px] text-red-400">{createError}</p>
          )}
        </div>
      )}

      {/* Tree */}
      {!treeCollapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {tree.length === 0 && (
            <p className="px-3 py-2 text-[10px] text-[var(--m-text-faint)]">No files</p>
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
              onContextMenu={(n, x, y) => setContextMenu({ node: n, x, y })}
            />
          ))}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)] py-1 shadow-xl"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <div className="px-3 py-1 border-b border-[var(--m-border-subtle)] mb-1">
            <span className="truncate font-mono text-[10px] text-[var(--m-text-faint)]">{contextMenu.node.name}</span>
          </div>
          <button
            type="button"
            onClick={() => handleCopy(contextMenu.node)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--m-text)] transition-colors hover:bg-[var(--m-surface-3)]"
          >
            <svg className="h-3.5 w-3.5 shrink-0 text-[var(--m-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => handleCopyPath(contextMenu.node)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--m-text)] transition-colors hover:bg-[var(--m-surface-3)]"
          >
            <svg className="h-3.5 w-3.5 shrink-0 text-[var(--m-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Copy Path
          </button>
          <div className="my-1 border-t border-[var(--m-border-subtle)]" />
          <button
            type="button"
            onClick={() => handleDelete(contextMenu.node)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-400 transition-colors hover:bg-[var(--m-surface-3)]"
          >
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
