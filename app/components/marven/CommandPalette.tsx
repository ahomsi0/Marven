"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface PaletteCommand {
  label: string;
  keybinding?: string;
  action: () => void;
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
  onClose: () => void;
}

function scoreMatch(query: string, label: string): number {
  const q = query.toLowerCase();
  const l = label.toLowerCase();
  if (l.includes(q)) return q.length / l.length;
  return -1;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? commands
        .map((c) => ({ cmd: c, score: scoreMatch(query, c.label) }))
        .filter(({ score }) => score >= 0)
        .sort((a, b) => b.score - a.score)
        .map(({ cmd }) => cmd)
    : commands;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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
        const cmd = filtered[selectedIndex];
        if (cmd) {
          onClose();
          cmd.action();
        }
      }
    },
    [filtered, selectedIndex, onClose],
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
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
          </svg>
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command…"
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

        {/* Command list */}
        <div ref={listRef} className="max-h-[400px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center font-mono text-[11px] text-[#444]">
              No commands match "{query}"
            </div>
          ) : (
            filtered.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={cmd.label}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => { onClose(); cmd.action(); }}
                  className={`flex w-full items-center justify-between gap-4 px-4 py-1.5 text-left transition-colors ${
                    isSelected ? "bg-[#d19a66]/20" : "hover:bg-[#252525]"
                  }`}
                >
                  <span
                    className={`font-mono text-[12px] ${isSelected ? "text-[#d19a66]" : "text-[#d4d4d4]"}`}
                  >
                    {cmd.label}
                  </span>
                  {cmd.keybinding && (
                    <kbd
                      className={`shrink-0 font-mono text-[10px] ${isSelected ? "text-[#d19a66]/70" : "text-[#555]"}`}
                    >
                      {cmd.keybinding}
                    </kbd>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
