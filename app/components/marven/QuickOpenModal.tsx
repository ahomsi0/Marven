"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { WorkspaceFile } from "@/types";

interface QuickOpenModalProps {
  files: WorkspaceFile[];
  onOpen: (path: string) => void;
  onClose: () => void;
}

function getFileExt(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function FileTypeBadge({ name }: { name: string }) {
  const ext = getFileExt(name);
  const map: Record<string, { label: string; color: string }> = {
    ts: { label: "TS", color: "#3b82f6" },
    tsx: { label: "TS", color: "#3b82f6" },
    js: { label: "JS", color: "#eab308" },
    jsx: { label: "JS", color: "#eab308" },
    html: { label: "<>", color: "#e67e22" },
    css: { label: "#", color: "#ec4899" },
    scss: { label: "#", color: "#ec4899" },
    json: { label: "{}", color: "#eab308" },
    md: { label: "MD", color: "#5b9cf6" },
    mdx: { label: "MD", color: "#5b9cf6" },
    py: { label: "PY", color: "#3b82f6" },
  };
  const entry = map[ext];
  return (
    <span
      className="shrink-0 font-mono text-[9px] font-bold"
      style={{ color: entry?.color ?? "#888" }}
    >
      {entry?.label ?? (ext ? ext.toUpperCase().slice(0, 3) : "·")}
    </span>
  );
}

function scoreMatch(query: string, file: WorkspaceFile): number {
  const q = query.toLowerCase();
  const name = file.name.toLowerCase();
  const path = file.path.toLowerCase();
  if (name.includes(q)) return q.length / name.length;
  if (path.includes(q)) return q.length / path.length / 2;
  return -1;
}

export function QuickOpenModal({ files, onOpen, onClose }: QuickOpenModalProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? files
        .map((f) => ({ file: f, score: scoreMatch(query, f) }))
        .filter(({ score }) => score >= 0)
        .sort((a, b) => b.score - a.score)
        .map(({ file }) => file)
    : files.slice(0, 50);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const f = filtered[selectedIndex];
        if (f) {
          onOpen(f.path);
          onClose();
        }
      }
    },
    [filtered, selectedIndex, onOpen, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-xl rounded-md border border-[#333] bg-[#1a1a1a] shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center border-b border-[#333] bg-[#252525] px-3 py-2">
          <svg
            className="mr-2 h-4 w-4 shrink-0 text-[#555]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="11" cy="11" r="8" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Go to file…"
            className="flex-1 bg-transparent font-mono text-[12px] text-[#d4d4d4] outline-none placeholder-[#555]"
          />
          <button
            type="button"
            onClick={onClose}
            className="ml-2 text-[#555] hover:text-[#888]"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* File list */}
        <div
          ref={listRef}
          className="max-h-[400px] overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center font-mono text-[11px] text-[#444]">
              No files match "{query}"
            </div>
          ) : (
            filtered.map((f, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={f.path}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => { onOpen(f.path); onClose(); }}
                  className={`flex w-full items-center gap-3 px-4 py-1.5 text-left transition-colors ${
                    isSelected ? "bg-[#d19a66]/20" : "hover:bg-[#252525]"
                  }`}
                >
                  <FileTypeBadge name={f.name} />
                  <span
                    className={`font-mono text-[12px] ${isSelected ? "text-[#d19a66]" : "text-[#d4d4d4]"}`}
                  >
                    {f.name}
                  </span>
                  <span className="truncate font-mono text-[10px] text-[#555]">{f.path}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
