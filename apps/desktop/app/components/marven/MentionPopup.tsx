"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import type { Mention } from "@/types";
import { FileIcon, FolderIcon, SearchIcon, GlobeIcon } from "./Icons";

type Mode = "category" | "file" | "folder" | "codebase" | "web";

const CATEGORIES: Array<{
  id: Exclude<Mode, "category">;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  hint: string;
}> = [
  { id: "file",     label: "File",     Icon: FileIcon,   hint: "Add a file" },
  { id: "folder",   label: "Folder",   Icon: FolderIcon, hint: "Add a folder" },
  { id: "codebase", label: "Codebase", Icon: SearchIcon, hint: "Semantic search" },
  { id: "web",      label: "Web",      Icon: GlobeIcon,  hint: "Fetch a URL" },
];

interface MentionPopupProps {
  /** Anchor position (caret coords relative to viewport). */
  anchor: { x: number; y: number };
  query: string;
  workspaceFiles: string[];
  onPick: (mention: Mention) => void;
  onClose: () => void;
}

function deriveFolders(files: string[]): string[] {
  const set = new Set<string>();
  for (const p of files) {
    const segs = p.split("/");
    for (let i = 1; i < segs.length; i++) {
      set.add(segs.slice(0, i).join("/"));
    }
  }
  return Array.from(set).sort();
}

function fuzzyMatch(items: string[], q: string, limit = 50): string[] {
  if (!q) return items.slice(0, limit);
  const lq = q.toLowerCase();
  return items.filter((i) => i.toLowerCase().includes(lq)).slice(0, limit);
}

export function MentionPopup({
  anchor,
  query,
  workspaceFiles,
  onPick,
  onClose,
}: MentionPopupProps) {
  const [mode, setMode] = useState<Mode>("category");
  const [highlighted, setHighlighted] = useState(0);
  const [textInput, setTextInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const folders = useMemo(() => deriveFolders(workspaceFiles), [workspaceFiles]);

  const visibleCategories = useMemo(
    () =>
      query
        ? CATEGORIES.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
        : CATEGORIES,
    [query],
  );

  const fileMatches = useMemo(
    () => fuzzyMatch(workspaceFiles, query),
    [workspaceFiles, query],
  );

  const folderMatches = useMemo(
    () => fuzzyMatch(folders, query),
    [folders, query],
  );

  // Reset highlighted when mode/query changes so it never points off the end.
  useEffect(() => { setHighlighted(0); }, [mode, query]);

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (mode === "codebase" || mode === "web") {
      inputRef.current?.focus();
    }
  }, [mode]);

  // ── keyboard handling ───────────────────────────────────────────────────
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (mode !== "category") {
          setMode("category");
          setTextInput("");
          setError(null);
        } else {
          onClose();
        }
        return;
      }
      if (mode === "codebase" || mode === "web") return; // input handles keys
      const items =
        mode === "category" ? visibleCategories.map((c) => c.id) :
        mode === "file"     ? fileMatches :
        mode === "folder"   ? folderMatches : [];
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((i) => Math.min(items.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        commitHighlight();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, highlighted, visibleCategories, fileMatches, folderMatches]);

  function commitHighlight() {
    if (mode === "category") {
      const cat = visibleCategories[highlighted];
      if (cat) setMode(cat.id);
    } else if (mode === "file") {
      const p = fileMatches[highlighted];
      if (p) onPick({ kind: "file", path: p });
    } else if (mode === "folder") {
      const p = folderMatches[highlighted];
      if (p) onPick({ kind: "folder", path: p });
    }
  }

  function commitText() {
    const v = textInput.trim();
    if (mode === "codebase") {
      if (!v) { setError("Search query required."); return; }
      onPick({ kind: "codebase", query: v });
    } else if (mode === "web") {
      if (!/^https?:\/\//i.test(v)) { setError("Invalid URL."); return; }
      onPick({ kind: "web", url: v });
    }
  }

  // ── render ──────────────────────────────────────────────────────────────
  const baseStyle: React.CSSProperties = {
    position: "fixed",
    left: Math.max(8, Math.min(anchor.x, (typeof window !== "undefined" ? window.innerWidth : 800) - 320)),
    top: Math.max(8, anchor.y - 8),
    transform: "translateY(-100%)",
    width: 320,
    maxHeight: 320,
    overflowY: "auto",
    background: "var(--m-surface, #fff)",
    border: "1px solid var(--m-border, rgba(127,127,127,0.3))",
    borderRadius: 8,
    boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
    fontSize: 13,
    zIndex: 1000,
    padding: 6,
  };

  const rowStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 10px",
    borderRadius: 4,
    cursor: "pointer",
    background: active ? "var(--m-accent-bg, rgba(99,102,241,0.15))" : "transparent",
    display: "flex",
    alignItems: "center",
    gap: 8,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  });

  return (
    <div role="dialog" aria-label="Mention picker" style={baseStyle}>
      {mode === "category" && (
        <>
          <div style={{ fontSize: 11, opacity: 0.6, padding: "4px 8px" }}>Mention type</div>
          {visibleCategories.length === 0 && (
            <div style={{ padding: 8, opacity: 0.6 }}>No matches</div>
          )}
          {visibleCategories.map((c, i) => (
            <div
              key={c.id}
              role="option"
              aria-selected={i === highlighted}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => setMode(c.id)}
              style={rowStyle(i === highlighted)}
            >
              <span style={{ display: "inline-flex", width: 12 }}><c.Icon /></span>
              <strong style={{ minWidth: 70 }}>{c.label}</strong>
              <span style={{ opacity: 0.6 }}>{c.hint}</span>
            </div>
          ))}
        </>
      )}

      {mode === "file" && (
        <>
          <div style={{ fontSize: 11, opacity: 0.6, padding: "4px 8px" }}>File · type to filter</div>
          {fileMatches.length === 0 && (
            <div style={{ padding: 8, opacity: 0.6 }}>No matching files</div>
          )}
          {fileMatches.map((p, i) => (
            <div
              key={p}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => onPick({ kind: "file", path: p })}
              style={rowStyle(i === highlighted)}
            >
              <span style={{ display: "inline-flex", width: 12 }}><FileIcon /></span> {p}
            </div>
          ))}
        </>
      )}

      {mode === "folder" && (
        <>
          <div style={{ fontSize: 11, opacity: 0.6, padding: "4px 8px" }}>Folder · type to filter</div>
          {folderMatches.length === 0 && (
            <div style={{ padding: 8, opacity: 0.6 }}>No matching folders</div>
          )}
          {folderMatches.map((p, i) => (
            <div
              key={p}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => onPick({ kind: "folder", path: p })}
              style={rowStyle(i === highlighted)}
            >
              <span style={{ display: "inline-flex", width: 12 }}><FolderIcon /></span> {p}
            </div>
          ))}
        </>
      )}

      {(mode === "codebase" || mode === "web") && (
        <div style={{ padding: 8 }}>
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6 }}>
            {mode === "codebase" ? "Search:" : "URL:"}
          </div>
          <input
            ref={inputRef}
            value={textInput}
            onChange={(e) => { setTextInput(e.target.value); setError(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitText(); }
              else if (e.key === "Escape") { e.preventDefault(); setMode("category"); setTextInput(""); setError(null); }
            }}
            placeholder={mode === "codebase" ? "e.g. jwt validation" : "https://…"}
            style={{
              width: "100%",
              padding: "6px 8px",
              borderRadius: 4,
              border: "1px solid var(--m-border, rgba(127,127,127,0.3))",
              background: "transparent",
              color: "inherit",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
          {error && (
            <div style={{ color: "var(--m-error, #c33)", marginTop: 6, fontSize: 12 }}>{error}</div>
          )}
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 6 }}>
            Press Enter to add · Esc to go back
          </div>
        </div>
      )}
    </div>
  );
}
