"use client";

import { useRef, useEffect, useCallback, useState, useMemo, type MutableRefObject } from "react";
import type { EditorTab, CustomShortcut, MCPServer, PromptTemplate, AIProvider } from "@/types";
import { MarvenLogo } from "./MarvenLogo";
import { SettingsModal } from "./SettingsModal";
import { InlineEditPrompt } from "./InlineEditPrompt";
import { CodeEditor, type CodeEditorActions } from "./CodeEditor";
import { useTheme } from "@/lib/theme";

interface EditorPanelProps {
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  fileContent: string;
  fileError?: string | null;
  isFileLoading: boolean;
  isFileDirty: boolean;
  terminalOutput: string;
  showTerminal: boolean;
  onToggleTerminal: () => void;
  onFileContentChange: (value: string) => void;
  onSaveFile: () => void;
  onCloseFile?: () => void;
  // Multi-tab props
  openTabs: EditorTab[];
  activeTabIndex: number;
  fileBuffers: Map<string, { content: string; dirty: boolean; loading: boolean }>;
  onSelectTab: (index: number) => void;
  onCloseTab: (index: number) => void;
  onReorderTabs: (from: number, to: number) => void;
  // Settings tab props
  shortcuts?: CustomShortcut[];
  promptTemplates?: PromptTemplate[];
  mcpServers?: MCPServer[];
  onSaveShortcuts?: (shortcuts: CustomShortcut[]) => void;
  onSaveTemplates?: (templates: PromptTemplate[]) => void;
  onSaveMCPServers?: (servers: MCPServer[]) => void;
  // Empty state action props
  onToggleChat?: () => void;
  onCommandPalette?: () => void;
  // Find / Replace bar — state lifted to AgentWorkspace so ⌘F shortcuts can
  // drive it. The ref lets the parent invoke navigation/focus.
  findOpen?: boolean;
  replaceVisible?: boolean;
  onCloseFind?: () => void;
  onToggleReplace?: () => void;
  // editorActionsRef — same ref as the old findActionsRef but with inline-edit
  // trigger added. Renamed via interface but kept name on the prop for
  // backward compat with callers.
  findActionsRef?: MutableRefObject<{
    next: () => void;
    prev: () => void;
    focus: () => void;
    triggerInlineEdit: () => void;
  } | null>;
  // ⌘K inline edit — provider/model are needed to drive the API call.
  provider?: AIProvider;
  model?: string;
}

// ── Tab type icon ──────────────────────────────────────────────────────────────

function TabFileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "html") {
    return <span className="font-mono text-[12px] font-bold text-[#e67e22]">&lt;&gt;</span>;
  }
  if (ext === "css" || ext === "scss") {
    return <span className="font-mono text-[12px] font-bold text-[#ec4899]">#</span>;
  }
  if (ext === "json") {
    return <span className="font-mono text-[12px] font-bold text-[#eab308]">{"{}"}</span>;
  }
  if (ext === "md" || ext === "mdx") {
    return <span className="font-mono text-[10px] font-bold text-[#5b9cf6]">MD</span>;
  }
  if (ext === "ts" || ext === "tsx") {
    return <span className="font-mono text-[10px] font-bold text-[#3b82f6]">TS</span>;
  }
  if (ext === "js" || ext === "jsx") {
    return <span className="font-mono text-[10px] font-bold text-[#eab308]">JS</span>;
  }
  if (ext === "py") {
    return <span className="font-mono text-[10px] font-bold text-[#3b82f6]">PY</span>;
  }
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"].includes(ext)) {
    return <span className="font-mono text-[10px] font-bold text-[#a855f7]">IMG</span>;
  }
  return <span className="font-mono text-[10px] font-bold text-[#888]">{ext ? ext.toUpperCase().slice(0, 3) : "·"}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────

export function EditorPanel({
  workspaceRoot,
  selectedFilePath,
  fileContent,
  fileError,
  isFileLoading,
  isFileDirty,
  terminalOutput,
  showTerminal,
  onToggleTerminal,
  onFileContentChange,
  onSaveFile,
  openTabs,
  activeTabIndex,
  fileBuffers,
  onSelectTab,
  onCloseTab,
  onReorderTabs,
  shortcuts = [],
  promptTemplates = [],
  mcpServers = [],
  onSaveShortcuts,
  onSaveTemplates,
  onSaveMCPServers,
  onToggleChat,
  onCommandPalette,
  findOpen = false,
  replaceVisible = false,
  onCloseFind,
  onToggleReplace,
  findActionsRef,
  provider = "groq",
  model = "",
}: EditorPanelProps) {
  const { theme } = useTheme();
  const editorActionsRef = useRef<CodeEditorActions | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Find / Replace state — query strings and current active match index.
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);

  // ⌘K Inline AI edit state. We capture the selection's character offsets at
  // trigger time so that even if the editor loses focus to the prompt input,
  // we still know what range to splice.
  const [inlineEdit, setInlineEdit] = useState<{
    selection: string;
    start: number;
    end: number;
  } | null>(null);
  // Brief floating tooltip when the user presses ⌘K without a selection.
  const [noSelectionHint, setNoSelectionHint] = useState(false);
  useEffect(() => {
    if (!noSelectionHint) return;
    const t = setTimeout(() => setNoSelectionHint(false), 3000);
    return () => clearTimeout(t);
  }, [noSelectionHint]);

  const activeFileName = selectedFilePath?.split("/").pop() ?? null;
  const fileExt = activeFileName?.split(".").pop()?.toLowerCase() ?? "";
  const projectName = workspaceRoot?.split("/").filter(Boolean).pop() ?? "workspace";
  const relativeFilePath = workspaceRoot && selectedFilePath
    ? selectedFilePath.startsWith(workspaceRoot)
      ? selectedFilePath.slice(workspaceRoot.length).replace(/^\//, "")
      : activeFileName ?? ""
    : activeFileName ?? "";

  // Breadcrumb path segments — project name + relative file path slices.
  const breadcrumbSegments = useMemo(() => {
    if (!selectedFilePath) return [] as string[];
    const parts = relativeFilePath ? relativeFilePath.split("/").filter(Boolean) : [];
    return [projectName, ...parts];
  }, [selectedFilePath, relativeFilePath, projectName]);

  // ── Find / Replace ───────────────────────────────────────────────────────
  // Compute substring matches case-insensitively. Empty query → no matches.
  // We do NOT use regex on the user input — treat the query as literal text.
  const matches = useMemo<Array<{ start: number; end: number }>>(() => {
    if (!findQuery || isFileLoading) return [];
    const hay = fileContent.toLowerCase();
    const needle = findQuery.toLowerCase();
    if (!needle) return [];
    const out: Array<{ start: number; end: number }> = [];
    let i = 0;
    while (i <= hay.length - needle.length) {
      const idx = hay.indexOf(needle, i);
      if (idx === -1) break;
      out.push({ start: idx, end: idx + needle.length });
      i = idx + needle.length;
      // Cap to avoid pathological cases (e.g. searching "a" in a huge buffer).
      if (out.length >= 5000) break;
    }
    return out;
  }, [findQuery, fileContent, isFileLoading]);
  const totalMatches = matches.length;

  // Clamp activeMatch when the matches array shrinks.
  useEffect(() => {
    if (totalMatches === 0) {
      if (activeMatch !== 0) setActiveMatch(0);
    } else if (activeMatch >= totalMatches) {
      setActiveMatch(totalMatches - 1);
    }
  }, [totalMatches, activeMatch]);

  // Scroll the active match into view via the CodeMirror actions API.
  const scrollMatchIntoView = useCallback((index: number) => {
    if (index < 0 || index >= matches.length) return;
    const offset = matches[index].start;
    editorActionsRef.current?.scrollToPos(offset);
  }, [matches]);

  const goToNext = useCallback(() => {
    if (totalMatches === 0) return;
    const next = (activeMatch + 1) % totalMatches;
    setActiveMatch(next);
    scrollMatchIntoView(next);
  }, [totalMatches, activeMatch, scrollMatchIntoView]);

  const goToPrev = useCallback(() => {
    if (totalMatches === 0) return;
    const prev = (activeMatch - 1 + totalMatches) % totalMatches;
    setActiveMatch(prev);
    scrollMatchIntoView(prev);
  }, [totalMatches, activeMatch, scrollMatchIntoView]);

  const replaceOne = useCallback(() => {
    if (totalMatches === 0) return;
    const m = matches[activeMatch];
    const newContent = fileContent.slice(0, m.start) + replaceQuery + fileContent.slice(m.end);
    onFileContentChange(newContent);
    // Stay on the same index — what was at N+1 slots into N after splice. The
    // clamp effect handles the case where we replaced the last match. The
    // recomputed `matches` array (via the fileContent change) will refresh
    // the overlay highlight to the new active position.
  }, [totalMatches, matches, activeMatch, replaceQuery, fileContent, onFileContentChange]);

  const replaceAll = useCallback(() => {
    if (totalMatches === 0) return;
    // Walk backwards so earlier indices stay valid as we splice.
    let next = fileContent;
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      next = next.slice(0, m.start) + replaceQuery + next.slice(m.end);
    }
    onFileContentChange(next);
    setActiveMatch(0);
  }, [totalMatches, matches, replaceQuery, fileContent, onFileContentChange]);

  // Accept the AI rewrite — splice `replacement` into `fileContent` at the
  // captured offsets. We deliberately do NOT manipulate trailing newlines:
  // the spec calls for preserving the file's existing trailing-newline
  // behavior, which means treating the replacement as a verbatim substitution
  // for the selected range.
  const acceptInlineEdit = useCallback((replacement: string) => {
    if (!inlineEdit) return;
    const next =
      fileContent.slice(0, inlineEdit.start) +
      replacement +
      fileContent.slice(inlineEdit.end);
    onFileContentChange(next);
    setInlineEdit(null);
    requestAnimationFrame(() => editorActionsRef.current?.focus());
  }, [inlineEdit, fileContent, onFileContentChange]);

  const rejectInlineEdit = useCallback(() => {
    setInlineEdit(null);
    requestAnimationFrame(() => editorActionsRef.current?.focus());
  }, []);

  // ⌘K Inline edit trigger — reads the CodeMirror selection. If empty (no
  // actual range highlighted), surface the "Select code first" hint and bail.
  // Otherwise capture the [start, end) range + text and open the bar.
  const triggerInlineEdit = useCallback(() => {
    if (!selectedFilePath || isFileLoading) return;
    const sel = editorActionsRef.current?.getSelection();
    if (!sel || sel.text.length === 0) {
      setNoSelectionHint(true);
      return;
    }
    setNoSelectionHint(false);
    setInlineEdit({ selection: sel.text, start: sel.from, end: sel.to });
  }, [selectedFilePath, isFileLoading]);

  // Publish actions for the parent (AgentWorkspace) to drive via shortcuts.
  useEffect(() => {
    if (!findActionsRef) return;
    findActionsRef.current = {
      next: goToNext,
      prev: goToPrev,
      focus: () => {
        const el = findInputRef.current;
        if (!el) return;
        el.focus();
        el.select();
      },
      triggerInlineEdit,
    };
    return () => {
      if (findActionsRef) findActionsRef.current = null;
    };
  }, [findActionsRef, goToNext, goToPrev, triggerInlineEdit]);

  // When the find bar opens, focus its input. When it closes, clear the
  // active match index so subsequent re-opens start from the top.
  useEffect(() => {
    if (findOpen) {
      requestAnimationFrame(() => {
        const el = findInputRef.current;
        if (el) {
          el.focus();
          el.select();
        }
      });
    } else {
      setActiveMatch(0);
    }
  }, [findOpen]);

  // When activeMatch changes (e.g. via ⌘G outside the bar), scroll it in view.
  useEffect(() => {
    if (findOpen && totalMatches > 0) {
      scrollMatchIntoView(activeMatch);
    }
    // We only want this to fire on activeMatch changes, not on every match
    // recomputation — otherwise typing in the find input would force-scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatch]);

  function closeFindAndReturnFocus() {
    onCloseFind?.();
    requestAnimationFrame(() => editorActionsRef.current?.focus());
  }

  // Detect language label for status bar
  const langLabel = ["ts", "tsx"].includes(fileExt)
    ? "TypeScript"
    : ["js", "jsx"].includes(fileExt)
    ? "JavaScript"
    : fileExt.toUpperCase() || "Plain Text";

  const activeTab = activeTabIndex >= 0 && activeTabIndex < openTabs.length ? openTabs[activeTabIndex] : null;
  const isSettingsTabActive = activeTab?.kind === "settings";

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--m-surface)]">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Editor */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Multi-tab strip */}
          {openTabs.length > 0 && (
            <div
              className="flex items-stretch border-b border-[var(--m-border)] bg-[var(--m-bg)] overflow-x-auto"
              onDragLeave={(e) => {
                // Only clear if leaving the tab strip entirely (not entering a child)
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragOverIndex(null);
                }
              }}
            >
              {openTabs.map((tab, i) => {
                const isActive = i === activeTabIndex;
                const label = tab.kind === "settings" ? "Settings" : tab.path.split("/").pop() ?? tab.path;
                const buffer = tab.kind === "file" ? fileBuffers.get(tab.path) : null;
                const isDirty = buffer?.dirty ?? false;
                return (
                  <div
                    key={tab.kind === "file" ? `file:${tab.path}` : "settings"}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", String(i));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverIndex(i);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverIndex(null);
                      const from = Number(e.dataTransfer.getData("text/plain"));
                      if (!isNaN(from)) onReorderTabs(from, i);
                    }}
                    onDragEnd={() => setDragOverIndex(null)}
                    onClick={() => onSelectTab(i)}
                    className={`group relative flex shrink-0 cursor-pointer items-center gap-2 border-r border-[var(--m-border)] px-3 py-2 transition-colors ${
                      isActive ? "bg-[var(--m-surface)]" : "bg-[var(--m-bg)] hover:bg-[var(--m-surface)]/50"
                    }`}
                    title={tab.kind === "file" ? tab.path : "Settings"}
                  >
                    {/* Drop indicator — vertical gold line on left edge */}
                    {dragOverIndex === i && (
                      <span className="pointer-events-none absolute left-0 top-0 bottom-0 w-[2px] bg-[#d19a66]" />
                    )}
                    {tab.kind === "file" ? (
                      <TabFileIcon name={label} />
                    ) : (
                      <svg className="h-3.5 w-3.5 text-[#d19a66]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                    <span className={`italic text-[12px] ${isActive ? "text-[var(--m-text)]" : "text-[var(--m-text-muted)]"}`}>{label}</span>
                    {isDirty && <span className="text-[#d19a66] text-[10px]">●</span>}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onCloseTab(i); }}
                      aria-label={`Close ${label}`}
                      className="ml-1 flex h-4 w-4 items-center justify-center rounded text-[var(--m-text-faint)] transition-colors hover:bg-[var(--m-border)] hover:text-[var(--m-text)]"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    {isActive && <span className="absolute top-0 left-0 right-0 h-[2px] bg-[#d19a66]" />}
                  </div>
                );
              })}
              {/* Save button lives in tab bar header area — shown when active file is dirty */}
              {isFileDirty && !isSettingsTabActive && (
                <div className="ml-auto flex items-center gap-2 px-3">
                  <button
                    type="button"
                    onClick={onSaveFile}
                    className="rounded border border-[var(--m-border)] px-2 py-1 text-[10px] text-[var(--m-text-muted)] transition-colors hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)]"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Breadcrumbs — between tab strip and find bar, when a file is open. */}
          {selectedFilePath && !isSettingsTabActive && breadcrumbSegments.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-4 py-1.5 font-mono text-[10px] text-[var(--m-text-muted)]">
              {breadcrumbSegments.map((seg, i) => {
                const isLast = i === breadcrumbSegments.length - 1;
                return (
                  <span key={`${i}-${seg}`} className="flex items-center gap-1 whitespace-nowrap">
                    <span className={isLast ? "text-[var(--m-text)]" : "text-[var(--m-text-muted)]"}>
                      {seg}
                    </span>
                    {!isLast && (
                      <svg
                        className="h-2.5 w-2.5 text-[#d19a66]/60"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="6 4 10 8 6 12" />
                      </svg>
                    )}
                  </span>
                );
              })}
            </div>
          )}

          {/* Find / Replace bar — slides in above the editor when active */}
          {findOpen && selectedFilePath && !isSettingsTabActive && (
            <div className="flex flex-col gap-1.5 border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-3 py-2">
              {/* Find row */}
              <div className="flex items-center gap-1.5">
                {/* Toggle for replace row — chevron */}
                <button
                  type="button"
                  onClick={onToggleReplace}
                  title={replaceVisible ? "Hide replace" : "Show replace"}
                  className="rounded p-0.5 text-[var(--m-text-faint)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text-muted)]"
                >
                  <svg className="h-3 w-3 transition-transform" style={{ transform: replaceVisible ? "rotate(90deg)" : "rotate(0deg)" }} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 4 10 8 6 12" />
                  </svg>
                </button>

                <input
                  ref={findInputRef}
                  value={findQuery}
                  onChange={(e) => setFindQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (e.shiftKey) goToPrev();
                      else goToNext();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      closeFindAndReturnFocus();
                    }
                  }}
                  placeholder="Find"
                  spellCheck={false}
                  className="w-48 rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1 font-mono text-[11px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-accent)]/60"
                />
                <button
                  type="button"
                  onClick={goToPrev}
                  disabled={totalMatches === 0}
                  title="Previous match (Shift+Enter / ⇧⌘G)"
                  className="rounded p-1 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 10 8 6 12 10" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={goToNext}
                  disabled={totalMatches === 0}
                  title="Next match (Enter / ⌘G)"
                  className="rounded p-1 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 6 8 10 12 6" />
                  </svg>
                </button>
                <span className="min-w-[64px] font-mono text-[10px] text-[var(--m-text-muted)] tabular-nums">
                  {totalMatches > 0
                    ? `${activeMatch + 1} of ${totalMatches}`
                    : findQuery
                    ? "No matches"
                    : ""}
                </span>

                <button
                  type="button"
                  onClick={closeFindAndReturnFocus}
                  title="Close (Esc)"
                  className="ml-auto rounded p-1 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Replace row */}
              {replaceVisible && (
                <div className="flex items-center gap-1.5">
                  <div className="w-[18px]" />{/* spacer to align with chevron above */}
                  <input
                    value={replaceQuery}
                    onChange={(e) => setReplaceQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        replaceOne();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        closeFindAndReturnFocus();
                      }
                    }}
                    placeholder="Replace"
                    spellCheck={false}
                    className="w-48 rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1 font-mono text-[11px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-accent)]/60"
                  />
                  <button
                    type="button"
                    onClick={replaceOne}
                    disabled={totalMatches === 0}
                    title="Replace current match"
                    className="rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1 text-[10px] text-[var(--m-text-muted)] transition-colors hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)] disabled:opacity-30 disabled:hover:border-[var(--m-border)] disabled:hover:text-[var(--m-text-muted)]"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={replaceAll}
                    disabled={totalMatches === 0}
                    title="Replace all matches"
                    className="rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1 text-[10px] text-[var(--m-text-muted)] transition-colors hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)] disabled:opacity-30 disabled:hover:border-[var(--m-border)] disabled:hover:text-[var(--m-text-muted)]"
                  >
                    All
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Content area — depends on active tab */}
          {isSettingsTabActive ? (
            /* Settings tab content */
            <div className="min-h-0 flex-1 overflow-hidden bg-[var(--m-bg)]">
              <SettingsModal
                inline
                shortcuts={shortcuts}
                promptTemplates={promptTemplates}
                mcpServers={mcpServers}
                onSave={onSaveShortcuts ?? (() => {})}
                onSaveTemplates={onSaveTemplates ?? (() => {})}
                onSaveMCPServers={onSaveMCPServers ?? (() => {})}
                onClose={() => {
                  const settingsIdx = openTabs.findIndex((t) => t.kind === "settings");
                  if (settingsIdx >= 0) onCloseTab(settingsIdx);
                }}
              />
            </div>
          ) : selectedFilePath ? (
            /* File editor */
            <>
              {fileError && (
                <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 font-mono text-[11px] text-red-400">
                  File error: {fileError}
                </div>
              )}
              <div className="relative flex min-h-0 flex-1 overflow-hidden">
                {isFileLoading ? (
                  <div className="flex h-full w-full items-center justify-center font-mono text-[11px] text-[var(--m-text-faint)]">
                    Loading…
                  </div>
                ) : (
                  <CodeEditor
                    value={fileContent}
                    onChange={onFileContentChange}
                    language={fileExt}
                    theme={theme}
                    onSave={onSaveFile}
                    onReady={(actions) => {
                      editorActionsRef.current = actions;
                    }}
                  />
                )}
                {/* "Select code first" hint — floating chip top-right of the
                    editor area, dismisses after 3s. */}
                {noSelectionHint && (
                  <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] px-2.5 py-1 text-[10px] text-[var(--m-text-muted)] shadow-lg">
                    Select code first, then press <kbd className="font-mono">⌘K</kbd>
                  </div>
                )}
              </div>
              {/* Inline edit prompt bar — anchored at the bottom of the editor
                  area (above the terminal). Renders only when a selection has
                  been captured. */}
              {inlineEdit && (
                <InlineEditPrompt
                  selection={inlineEdit.selection}
                  language={fileExt}
                  provider={provider}
                  model={model}
                  onAccept={acceptInlineEdit}
                  onReject={rejectInlineEdit}
                />
              )}
            </>
          ) : (
            /* Empty editor state — watermark + shortcuts */
            <div className="flex flex-1 flex-col items-center justify-center gap-8 bg-[var(--m-surface)]">
              <div className="opacity-15">
                <MarvenLogo size={160} />
              </div>
              <div className="space-y-2 text-[12px] text-[var(--m-text-faint)]">
                <button
                  type="button"
                  onClick={onToggleChat}
                  className="flex w-full items-center justify-between gap-12 rounded px-2 py-1 transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text-muted)]"
                >
                  <span>Open Chat</span>
                  <kbd className="font-mono text-[10px]">⌃⌘I</kbd>
                </button>
                <button
                  type="button"
                  onClick={onCommandPalette}
                  className="flex w-full items-center justify-between gap-12 rounded px-2 py-1 transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text-muted)]"
                >
                  <span>Show All Commands</span>
                  <kbd className="font-mono text-[10px]">⇧⌘P</kbd>
                </button>
                <button
                  type="button"
                  onClick={onToggleTerminal}
                  className="flex w-full items-center justify-between gap-12 rounded px-2 py-1 transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text-muted)]"
                >
                  <span>Toggle Terminal</span>
                  <kbd className="font-mono text-[10px]">⌃`</kbd>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div className={`border-t border-[var(--m-border)] bg-[var(--m-bg)] ${showTerminal ? "h-[120px]" : "h-7"} flex flex-col shrink-0 transition-all`}>
        <div
          className="flex h-7 cursor-pointer items-center gap-3 border-b border-[var(--m-border-subtle)] px-3"
          onClick={onToggleTerminal}
        >
          <span className="text-[9px] uppercase tracking-[0.2em] text-[var(--m-text-faint)]">Terminal</span>
          <span className="text-[9px] text-[var(--m-text-faint)]">{showTerminal ? "▾" : "▸"}</span>
        </div>
        {showTerminal && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-6 text-[var(--m-text-muted)] whitespace-pre-wrap">
            {terminalOutput || <span className="text-[var(--m-text-faint)]">No output yet.</span>}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-[var(--m-border)] bg-[var(--m-bg)] px-3 py-1 font-mono text-[9px] text-[var(--m-text-faint)]">
        <span>{projectName}</span>
        <div className="flex gap-4">
          <span>{activeFileName ?? "—"}</span>
          <span className="text-[#d19a66]/50">{langLabel}</span>
        </div>
      </div>
    </div>
  );
}
