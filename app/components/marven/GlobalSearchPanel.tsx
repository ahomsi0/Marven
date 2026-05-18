"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Shape mirrors /api/workspace/search response.
interface SearchMatch {
  line: number;
  text: string;
  col: number;
}
interface FileResult {
  path: string;
  matches: SearchMatch[];
}
interface SearchResponse {
  results: FileResult[];
  totalMatches: number;
  truncated: boolean;
}
interface SearchError {
  error: string;
}

interface GlobalSearchPanelProps {
  /** Called when the panel should close (Escape, ✕ button, or shortcut toggle). */
  onClose: () => void;
  /** Called when the user clicks a match line. The parent opens the file and
   * jumps the editor to `line` (1-based). `col` is 1-based. */
  onSelectMatch: (path: string, line: number, col: number) => void;
}

// Render a line's text with the query highlighted. Case-aware so highlights
// only appear where grep actually matched. For regex queries we skip the
// highlight (regex matching client-side is tricky and we'd risk mismatching
// what grep found server-side).
function HighlightedLine({
  text,
  query,
  caseSensitive,
  regex,
}: {
  text: string;
  query: string;
  caseSensitive: boolean;
  regex: boolean;
}) {
  if (!query || regex) {
    return <span className="truncate font-mono text-[11px] text-[var(--m-text)]">{text}</span>;
  }
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const parts: Array<{ text: string; match: boolean }> = [];
  let i = 0;
  // Cap iterations as a safety net against pathological inputs.
  let iter = 0;
  while (i <= hay.length && iter < 50) {
    iter += 1;
    const idx = hay.indexOf(needle, i);
    if (idx === -1) {
      if (i < text.length) parts.push({ text: text.slice(i), match: false });
      break;
    }
    if (idx > i) parts.push({ text: text.slice(i, idx), match: false });
    parts.push({ text: text.slice(idx, idx + needle.length), match: true });
    i = idx + needle.length;
    if (needle.length === 0) break;
  }
  return (
    <span className="truncate font-mono text-[11px] text-[var(--m-text)]">
      {parts.map((part, idx) =>
        part.match ? (
          <mark key={idx} className="rounded-sm bg-[var(--m-accent)]/30 text-[var(--m-text)]">
            {part.text}
          </mark>
        ) : (
          <span key={idx}>{part.text}</span>
        )
      )}
    </span>
  );
}

// Cap matches shown per file before requiring expansion.
const MATCHES_PER_FILE_PREVIEW = 5;

export function GlobalSearchPanel({ onClose, onSelectMatch }: GlobalSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState<FileResult[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedAll, setExpandedAll] = useState<Set<string>>(new Set());

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-focus on mount so the user can start typing immediately.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Debounced fetch — 300ms after the last keystroke, run the search.
  useEffect(() => {
    // Tear down any in-flight request when inputs change.
    abortRef.current?.abort();

    if (query.trim().length < 2) {
      setResults([]);
      setTotalMatches(0);
      setTruncated(false);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      fetch("/api/workspace/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, caseSensitive, regex }),
        signal: controller.signal,
      })
        .then(async (r) => {
          const data = (await r.json().catch(() => ({}))) as SearchResponse | SearchError;
          if (!r.ok) {
            const msg = (data as SearchError).error ?? `Search failed (${r.status})`;
            throw new Error(msg);
          }
          return data as SearchResponse;
        })
        .then((data) => {
          if (controller.signal.aborted) return;
          setResults(data.results);
          setTotalMatches(data.totalMatches);
          setTruncated(data.truncated);
          setCollapsed(new Set());
          setExpandedAll(new Set());
          setLoading(false);
        })
        .catch((err: unknown) => {
          // AbortError fires when a newer query supersedes this request — that
          // isn't a real error, just a cancellation.
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          const msg = err instanceof Error ? err.message : "Search failed";
          setError(msg);
          setResults([]);
          setTotalMatches(0);
          setTruncated(false);
          setLoading(false);
        });
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, caseSensitive, regex]);

  // Escape closes the panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggleFile(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function showAllMatches(path: string) {
    setExpandedAll((prev) => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }

  const statusText = useMemo(() => {
    if (loading) return "Searching…";
    if (error) return null;
    if (query.trim().length < 2) {
      return "Type at least 2 characters to search.";
    }
    if (results.length === 0) return "No matches.";
    const filesLabel = results.length === 1 ? "file" : "files";
    const matchesLabel = totalMatches === 1 ? "match" : "matches";
    const suffix = truncated ? " (truncated)" : "";
    return `Found ${totalMatches} ${matchesLabel} in ${results.length} ${filesLabel}${suffix}`;
  }, [loading, error, query, results.length, totalMatches, truncated]);

  return (
    <div className="flex h-full flex-col bg-[var(--m-bg)]">
      {/* Header — search input + close button */}
      <div className="border-b border-[var(--m-border-subtle)] px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2.5 py-1.5 focus-within:border-[var(--m-accent)]/60">
            <svg
              className="h-3.5 w-3.5 shrink-0 text-[var(--m-text-muted)]"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files..."
              className="flex-1 bg-transparent text-[12px] text-[var(--m-text)] placeholder:text-[var(--m-text-faint)] focus:outline-none"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="rounded p-1 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>
        {/* Toggles — case sensitive + regex */}
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCaseSensitive((v) => !v)}
            title="Case sensitive"
            className={`flex h-6 w-6 items-center justify-center rounded border text-[10px] font-mono transition-colors ${
              caseSensitive
                ? "border-[var(--m-accent)]/60 bg-[var(--m-accent)]/15 text-[var(--m-accent)]"
                : "border-[var(--m-border)] bg-[var(--m-surface-2)] text-[var(--m-text-muted)] hover:text-[var(--m-text)]"
            }`}
          >
            aA
          </button>
          <button
            type="button"
            onClick={() => setRegex((v) => !v)}
            title="Use regular expression"
            className={`flex h-6 w-6 items-center justify-center rounded border text-[10px] font-mono transition-colors ${
              regex
                ? "border-[var(--m-accent)]/60 bg-[var(--m-accent)]/15 text-[var(--m-accent)]"
                : "border-[var(--m-border)] bg-[var(--m-surface-2)] text-[var(--m-text-muted)] hover:text-[var(--m-text)]"
            }`}
          >
            .*
          </button>
        </div>
      </div>

      {/* Status line */}
      <div className="border-b border-[var(--m-border-subtle)] px-3 py-2 text-[10px] text-[var(--m-text-muted)]">
        {error ? <span className="text-red-400">{error}</span> : statusText}
      </div>

      {/* Results — scrollable list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {results.map((file) => {
          const isCollapsed = collapsed.has(file.path);
          const showAll = expandedAll.has(file.path);
          const visibleMatches = showAll
            ? file.matches
            : file.matches.slice(0, MATCHES_PER_FILE_PREVIEW);
          const hiddenCount = file.matches.length - visibleMatches.length;
          const matchCountLabel = file.matches.length === 1 ? "match" : "matches";
          return (
            <div key={file.path} className="border-b border-[var(--m-border-subtle)]">
              <button
                type="button"
                onClick={() => toggleFile(file.path)}
                className="group flex w-full items-center gap-1 px-2 py-1 text-left transition-colors hover:bg-[var(--m-surface-3)]"
              >
                <svg
                  className="h-3 w-3 shrink-0 text-[var(--m-text-faint)] transition-transform duration-100"
                  style={{ transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)" }}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="flex-1 truncate font-mono text-[11px] text-[var(--m-text)]">
                  {file.path}
                </span>
                <span className="shrink-0 rounded-full bg-[var(--m-surface-3)] px-1.5 py-0.5 text-[9px] text-[var(--m-text-muted)]">
                  {file.matches.length} {matchCountLabel}
                </span>
              </button>
              {!isCollapsed && (
                <div className="pb-1">
                  {visibleMatches.map((match, idx) => (
                    <button
                      key={`${file.path}:${match.line}:${idx}`}
                      type="button"
                      onClick={() => onSelectMatch(file.path, match.line, match.col)}
                      className="flex w-full items-start gap-2 py-[2px] pl-6 pr-2 text-left transition-colors hover:bg-[var(--m-surface-3)]"
                    >
                      <span className="w-8 shrink-0 text-right font-mono text-[10px] text-[var(--m-text-faint)] tabular-nums">
                        {match.line}
                      </span>
                      <HighlightedLine
                        text={match.text}
                        query={query}
                        caseSensitive={caseSensitive}
                        regex={regex}
                      />
                    </button>
                  ))}
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => showAllMatches(file.path)}
                      className="ml-6 mt-0.5 rounded px-1.5 py-0.5 text-[10px] text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-3)] hover:text-[var(--m-text)]"
                    >
                      +{hiddenCount} more
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
