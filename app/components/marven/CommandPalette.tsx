"use client";

// ⌘⇧P palette, available in chat and agent mode. Commands can open a sub-list
// (models, themes); typing filters with fuzzy matching and highlights the
// matched characters.

import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import { useOverlayGuard } from "@/lib/overlays";
import { fuzzyRank, matchRanges } from "@/lib/fuzzy";
import { CheckIcon } from "./Icons";

export interface PaletteCommand {
  /** Stable id, unique among its siblings. */
  id: string;
  label: string;
  /** Secondary text shown after the label (e.g. a model's provider). */
  hint?: string;
  keybinding?: string;
  /** Section heading shown while the query is empty. */
  group?: string;
  /** Extra words that also find this command (no highlight). */
  keywords?: string[];
  /** Shows a check mark (current theme, model in use). */
  active?: boolean;
  action?: () => void;
  /** Choosing the command opens this list instead of running an action. */
  children?: PaletteCommand[];
  childrenLoading?: boolean;
  /** Shown when `children` is empty and not loading. */
  emptyText?: string;
  /** Called when the sub-list opens — e.g. to start loading it. */
  onEnter?: () => void;
}

interface CommandPaletteProps {
  commands: PaletteCommand[];
  onClose: () => void;
}

function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of matchRanges(indices)) {
    if (start > at) parts.push(text.slice(at, start));
    // Colour only (no weight change) so Arabic letters keep joining across the span.
    parts.push(
      <span key={start} className="text-[var(--m-accent)]">
        {text.slice(start, end)}
      </span>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  useOverlayGuard();
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Ids of the sub-lists opened so far, outermost first.
  const [stack, setStack] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Walk the stack against the live command tree (children update as models load).
  const { list, parent } = useMemo(() => {
    let current = commands;
    let parentCmd: PaletteCommand | null = null;
    for (const id of stack) {
      const next = current.find((c) => c.id === id);
      if (!next?.children) break;
      parentCmd = next;
      current = next.children;
    }
    return { list: current, parent: parentCmd };
  }, [commands, stack]);

  const ranked = useMemo(
    () => fuzzyRank(query, list, (c) => c.label, (c) => [...(c.keywords ?? []), ...(c.hint ? [c.hint] : [])]),
    [query, list],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, stack]);

  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function run(cmd: PaletteCommand) {
    if (cmd.children) {
      setStack((s) => [...s, cmd.id]);
      setQuery("");
      cmd.onEnter?.();
      inputRef.current?.focus();
      return;
    }
    onClose();
    cmd.action?.();
  }

  function goBack() {
    setStack((s) => s.slice(0, -1));
    setQuery("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (stack.length > 0) goBack();
      else onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (ranked.length === 0 ? 0 : (i + 1) % ranked.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (ranked.length === 0 ? 0 : (i - 1 + ranked.length) % ranked.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = ranked[selectedIndex];
      if (hit) run(hit.item);
    } else if (e.key === "Backspace" && query === "" && stack.length > 0) {
      e.preventDefault();
      goBack();
    }
  }

  const showGroups = !query.trim() && !parent;
  const placeholder = parent ? t("palette.filterPlaceholder", { name: parent.label.replace(/…$/, "") }) : t("palette.placeholder");

  let emptyMessage: string | null = null;
  if (ranked.length === 0) {
    if (query.trim()) emptyMessage = t("palette.noMatches", { query });
    else if (parent?.childrenLoading) emptyMessage = t("palette.loading");
    else emptyMessage = parent?.emptyText ?? t("palette.empty");
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[15vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-black/50" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.title")}
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-[var(--m-border)] bg-[var(--m-surface)] shadow-2xl"
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-2.5">
          {parent ? (
            <button
              type="button"
              onClick={goBack}
              aria-label={t("palette.back")}
              title={t("palette.back")}
              className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--m-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--m-text-muted)] transition-colors hover:text-[var(--m-text)]"
            >
              <svg className="h-3 w-3 rtl:-scale-x-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              <span className="max-w-[10rem] truncate">{parent.label.replace(/…$/, "")}</span>
            </button>
          ) : (
            <svg className="h-4 w-4 shrink-0 text-[var(--m-text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
            </svg>
          )}
          <input
            ref={inputRef}
            autoFocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={ranked[selectedIndex] ? `palette-item-${selectedIndex}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            dir="auto"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)]"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label={t("palette.close")}
            title={t("palette.close")}
            className="shrink-0 rounded p-0.5 text-[var(--m-text-faint)] transition-colors hover:text-[var(--m-text-muted)]"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Command list */}
        <div ref={listRef} id="command-palette-list" role="listbox" className="max-h-[min(400px,60vh)] overflow-y-auto py-1">
          {emptyMessage !== null ? (
            <div className="px-4 py-6 text-center text-[12px] text-[var(--m-text-faint)]">{emptyMessage}</div>
          ) : (
            ranked.map(({ item: cmd, match }, idx) => {
              const isSelected = idx === selectedIndex;
              const prevGroup = idx > 0 ? ranked[idx - 1].item.group : undefined;
              const header = showGroups && cmd.group && cmd.group !== prevGroup ? cmd.group : null;
              return (
                <Fragment key={cmd.id}>
                  {header && (
                    <div className="px-4 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--m-text-faint)] first:pt-1.5">
                      {header}
                    </div>
                  )}
                  <button
                    id={`palette-item-${idx}`}
                    data-index={idx}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseMove={() => {
                      if (!isSelected) setSelectedIndex(idx);
                    }}
                    onClick={() => run(cmd)}
                    className={`flex w-full items-center gap-3 px-4 py-1.5 text-start transition-colors ${
                      isSelected ? "bg-[var(--m-accent-soft)]" : ""
                    }`}
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[var(--m-accent)]">
                      {cmd.active && <CheckIcon className="h-3 w-3" />}
                    </span>
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span dir="auto" className="truncate text-[13px] text-[var(--m-text)]">
                        <Highlighted text={cmd.label} indices={match.indices} />
                      </span>
                      {cmd.hint && <span className="shrink-0 text-[11px] text-[var(--m-text-faint)]">{cmd.hint}</span>}
                    </span>
                    {cmd.keybinding && (
                      <kbd dir="ltr" className="shrink-0 rounded border border-[var(--m-border-subtle)] bg-[var(--m-surface-2)] px-1.5 py-px font-mono text-[10px] text-[var(--m-text-muted)]">
                        {cmd.keybinding}
                      </kbd>
                    )}
                    {cmd.children && (
                      <svg className="h-3 w-3 shrink-0 text-[var(--m-text-faint)] rtl:-scale-x-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </button>
                </Fragment>
              );
            })
          )}
          {parent?.childrenLoading && ranked.length > 0 && (
            <div className="px-4 py-1.5 text-[11px] text-[var(--m-text-faint)]">{t("palette.loading")}</div>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 border-t border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-1 text-[10px] text-[var(--m-text-faint)]">
          <span><kbd className="font-mono">↑↓</kbd> {t("palette.navigate")}</span>
          <span><kbd className="font-mono">↵</kbd> {t("palette.run")}</span>
          {parent && <span><kbd className="font-mono">⌫</kbd> {t("palette.goBack")}</span>}
          <span><kbd className="font-mono">esc</kbd> {t("palette.dismiss")}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
