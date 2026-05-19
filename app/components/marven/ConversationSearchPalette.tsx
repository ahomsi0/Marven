"use client";

// Cmd+Shift+K palette for searching across every conversation's message
// history. Shows hits as "conversation name → message snippet"; Enter or
// click jumps to that conversation. Independent from the editor's command
// palette so the two don't have to fight over the same shortcut.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Conversation } from "@/types";

interface ConversationSearchPaletteProps {
  conversations: Conversation[];
  onClose: () => void;
  onJump: (conversationId: string, messageId: string) => void;
}

interface SearchHit {
  convId: string;
  convName: string;
  convMode: "chat" | "agent";
  messageId: string;
  role: "user" | "assistant";
  snippet: string;
  match: { start: number; end: number };
  updatedAt: string;
}

const MAX_RESULTS = 50;
const SNIPPET_LEN = 80;

function buildSnippet(content: string, matchIdx: number, queryLen: number): { snippet: string; match: { start: number; end: number } } {
  // Center the match in the snippet. SNIPPET_LEN chars total.
  const half = Math.floor((SNIPPET_LEN - queryLen) / 2);
  const start = Math.max(0, matchIdx - half);
  const end   = Math.min(content.length, start + SNIPPET_LEN);
  const adjustedStart = Math.max(0, end - SNIPPET_LEN);
  const raw = content.slice(adjustedStart, end);
  const prefix = adjustedStart > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return {
    snippet: prefix + raw + suffix,
    match: {
      start: prefix.length + (matchIdx - adjustedStart),
      end:   prefix.length + (matchIdx - adjustedStart) + queryLen,
    },
  };
}

export function ConversationSearchPalette({
  conversations,
  onClose,
  onJump,
}: ConversationSearchPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results: SearchHit[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const hits: SearchHit[] = [];
    // Newest conversation first — more likely to be what the user wants
    const ordered = [...conversations].sort((a, b) =>
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    );
    for (const conv of ordered) {
      for (const msg of conv.messages) {
        const content = msg.content ?? "";
        if (!content) continue;
        const matchIdx = content.toLowerCase().indexOf(q);
        if (matchIdx === -1) continue;
        const { snippet, match } = buildSnippet(content, matchIdx, q.length);
        hits.push({
          convId: conv.id,
          convName: conv.name || "Untitled",
          convMode: conv.mode ?? "chat",
          messageId: msg.id,
          role: msg.role,
          snippet,
          match,
          updatedAt: conv.updatedAt ?? "",
        });
        if (hits.length >= MAX_RESULTS) break;
      }
      if (hits.length >= MAX_RESULTS) break;
    }
    return hits;
  }, [query, conversations]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

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
        setSelectedIndex((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = results[selectedIndex];
        if (hit) {
          onJump(hit.convId, hit.messageId);
          onClose();
        }
      }
    },
    [results, selectedIndex, onJump, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/60" />

      <div className="relative z-10 w-full max-w-2xl rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center border-b border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-2">
          <svg
            className="mr-2 h-4 w-4 shrink-0 text-[var(--m-text-faint)]"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
          </svg>
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search across all conversations…"
            className="flex-1 bg-transparent font-mono text-[12px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)]"
          />
          <span className="ml-2 text-[10px] text-[var(--m-text-faint)]">
            {query.trim().length < 2 ? "" : `${results.length}${results.length >= MAX_RESULTS ? "+" : ""} result${results.length === 1 ? "" : "s"}`}
          </span>
        </div>

        {/* Results list */}
        <div ref={listRef} className="max-h-[440px] overflow-y-auto">
          {query.trim().length < 2 ? (
            <div className="px-4 py-8 text-center font-mono text-[11px] text-[var(--m-text-faint)]">
              Type at least 2 characters to search your conversation history
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-8 text-center font-mono text-[11px] text-[var(--m-text-faint)]">
              No messages match &ldquo;{query}&rdquo;
            </div>
          ) : (
            results.map((hit, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={`${hit.convId}-${hit.messageId}-${idx}`}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => { onJump(hit.convId, hit.messageId); onClose(); }}
                  className={`flex w-full items-start gap-3 px-4 py-2 text-left transition-colors ${
                    isSelected
                      ? "bg-[var(--m-accent)]/15"
                      : "hover:bg-[var(--m-surface-2)]"
                  }`}
                >
                  <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[8px] uppercase tracking-[0.15em] ${
                    hit.convMode === "agent"
                      ? "border border-[var(--m-accent)]/30 text-[var(--m-accent)]"
                      : "border border-[var(--m-border)] text-[var(--m-text-faint)]"
                  }`}>
                    {hit.convMode}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className={`flex items-center gap-2 truncate font-mono text-[11px] ${
                      isSelected ? "text-[var(--m-accent)]" : "text-[var(--m-text)]"
                    }`}>
                      <span className="truncate">{hit.convName}</span>
                      <span className="shrink-0 text-[var(--m-text-faint)]">•</span>
                      <span className="shrink-0 text-[10px] text-[var(--m-text-faint)]">{hit.role}</span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--m-text-muted)]">
                      {hit.snippet.slice(0, hit.match.start)}
                      <mark className="rounded-sm bg-[var(--m-accent)]/30 px-0.5 text-[var(--m-text)]">
                        {hit.snippet.slice(hit.match.start, hit.match.end)}
                      </mark>
                      {hit.snippet.slice(hit.match.end)}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-1 text-[9px] text-[var(--m-text-faint)] flex items-center gap-3">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> jump</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
