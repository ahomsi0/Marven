"use client";

import { useState, useRef, useEffect } from "react";
import type { AIProvider, WorkspaceFile, AgentMessage, EditorTab, CustomShortcut, MCPServer, PromptTemplate, ImageAttachment } from "@/types";
import type { VoiceState } from "@/hooks/useVoice";
import { AgentPanel } from "./AgentPanel";
import { EditorPanel } from "./EditorPanel";
import { DiffPanel } from "./DiffPanel";
import { FileExplorer } from "./FileExplorer";
import { GlobalSearchPanel } from "./GlobalSearchPanel";
import { GitPanel } from "./GitPanel";
import { WorkspaceLanding } from "./WorkspaceLanding";
import { SettingsModal } from "./SettingsModal";
import { QuickOpenModal } from "./QuickOpenModal";
import { CommandPalette } from "./CommandPalette";
import type { PaletteCommand } from "./CommandPalette";
import type { CodeEditorActions } from "./CodeEditor";
import { useEditorShortcuts } from "@/hooks/useEditorShortcuts";
import { SymbolOutline } from "./SymbolOutline";

// Background tasks popover — mirrors MemoryPopover's position:fixed pattern so
// it can extend past the workspace's overflow-hidden bounds. Anchors at the
// LEFT edge of the trigger and drops down to the right.
function BackgroundTasksPopover({
  anchor,
  isRunning,
  startedAt,
  onStop,
}: {
  anchor: HTMLElement | null;
  isRunning: boolean;
  startedAt: number | null;
  onStop: () => void;
}) {
  // Re-render every second while open so the elapsed clock advances.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const rect = anchor?.getBoundingClientRect();
  if (!rect) return null;
  const width = 280;
  const right = Math.max(8, window.innerWidth - rect.right);
  const top = rect.bottom + 6;

  const elapsedSec =
    isRunning && startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  const elapsedLabel = formatElapsed(elapsedSec);

  return (
    <div
      className="fixed z-[60] overflow-hidden rounded-lg border border-[var(--m-border)] bg-[var(--m-bg)] shadow-2xl"
      style={{ right, top, width }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-3 py-2.5">
        <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--m-text-muted)]">
          Background tasks
        </span>
      </div>
      <div className="divide-y divide-[var(--m-surface-2)]">
        {isRunning ? (
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--m-accent)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--m-accent)]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-[var(--m-text)]">Agent run in progress</div>
              <div className="font-mono text-[10px] text-[var(--m-text-muted)]">{elapsedLabel}</div>
            </div>
            <button
              type="button"
              onClick={onStop}
              className="shrink-0 rounded-md border border-[var(--m-border)] px-2 py-0.5 text-[10px] text-[var(--m-text-muted)] transition-colors hover:border-red-400/40 hover:text-red-400"
            >
              Stop
            </button>
          </div>
        ) : (
          <p className="p-4 text-center text-[11px] text-[var(--m-text-faint)]">
            No active background tasks.
          </p>
        )}
      </div>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

// Memory popover — uses position:fixed with viewport coordinates so it can
// extend past the workspace's overflow-hidden bounds. Anchors at the LEFT edge
// of the trigger button and drops down to the right.
function MemoryPopover({
  anchor,
  scopes,
  onClear,
}: {
  anchor: HTMLElement | null;
  scopes: { global: string[]; project: string[]; conversation: string[] };
  onClear: (scope?: "global" | "project" | "conversation") => void;
}) {
  const rect = anchor?.getBoundingClientRect();
  if (!rect) return null;
  const width = 340;
  // Left-align with the button; clamp so the right edge stays on-screen.
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left));
  const top = rect.bottom + 6;

  const sections = [
    { key: "global", label: "Global", entries: scopes.global },
    { key: "project", label: "Project", entries: scopes.project },
    { key: "conversation", label: "Conversation", entries: scopes.conversation },
  ] as const;
  const visibleSections = sections.filter((section) => section.entries.length > 0);

  return (
    <div
      className="fixed z-[60] overflow-hidden rounded-lg border border-[var(--m-border)] bg-[var(--m-bg)] shadow-2xl"
      style={{ left, top, width }}
    >
      <div className="flex items-center justify-between border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-3 py-2.5">
        <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--m-text-muted)]">
          Agent Memory
        </span>
        <button
          type="button"
          onClick={() => onClear()}
          className="rounded px-1.5 py-0.5 text-[10px] text-[var(--m-text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-400"
        >
          Clear all
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto divide-y divide-[var(--m-surface-2)]">
        {visibleSections.length === 0 ? (
          <p className="p-4 text-center text-[11px] text-[var(--m-text-faint)]">No memories yet.</p>
        ) : (
          visibleSections.map((section) => (
            <div key={section.key} className="px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[9px] uppercase tracking-wider text-[var(--m-text-faint)]">
                  {section.label}
                </div>
                <button
                  type="button"
                  onClick={() => onClear(section.key)}
                  className="rounded px-1.5 py-0.5 text-[9px] text-[var(--m-text-faint)] transition-colors hover:bg-red-500/10 hover:text-red-400"
                >
                  Clear
                </button>
              </div>
              <div className="space-y-2">
                {section.entries.map((entry, i) => (
                  <div key={`${section.key}-${i}`} className="text-[12px] leading-relaxed text-[var(--m-text)] break-words">
                    {entry}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// View menu (top-right kebab) — quick access to panels, preview, tasks, plan.
interface ViewMenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  hint?: string;
  badge?: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function ViewMenu({ anchor, items, onClose }: { anchor: HTMLElement | null; items: ViewMenuItem[]; onClose: () => void }) {
  const rect = anchor?.getBoundingClientRect();
  if (!rect) return null;
  const width = 180;
  const right = Math.max(8, window.innerWidth - rect.right);
  const top = rect.bottom + 4;
  return (
    <div
      className="fixed z-[60] overflow-hidden rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] py-0.5 shadow-2xl"
      style={{ right, top, width }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          disabled={it.disabled}
          onClick={() => { it.onClick(); onClose(); }}
          className="flex w-full items-center gap-2 px-2 py-1 text-left text-[10px] text-[var(--m-text)] transition-colors hover:bg-[var(--m-surface-2)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="relative flex h-3 w-3 shrink-0 items-center justify-center text-[var(--m-text-muted)]">
            {it.icon}
            {it.badge && <span className="absolute -right-0.5 -top-0.5 h-1 w-1 rounded-full bg-[#5b9cf6]" />}
          </span>
          <span className="flex-1">{it.label}</span>
          {it.hint && <span className="font-mono text-[8px] text-[var(--m-text-muted)]">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (isNaN(then)) return iso;
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.round(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface AgentWorkspaceProps {
  messages: AgentMessage[];
  input: string;
  isRunning: boolean;
  error: string | null;
  provider: string;
  model: string;
  tokenUsage: import("@/types").TokenUsage;
  speechEnabled: boolean;
  wakeEnabled: boolean;
  voiceState: VoiceState;
  isVoiceSupported: boolean;
  voiceError: string | null;
  workspaceRoot: string | null;
  files: WorkspaceFile[];
  selectedFilePath: string | null;
  fileContent: string;
  fileError?: string | null;
  isFileLoading: boolean;
  isFileDirty: boolean;
  terminalOutput: string;
  onProviderChange: (p: AIProvider) => void;
  onModelChange: (m: string) => void;
  onToggleSpeech: () => void;
  onToggleWakeWord: () => void;
  onInputChange: (value: string) => void;
  onSend: (opts?: { mentions?: import("@/types").Mention[] }) => void;
  onStop: () => void;
  onSlashCommand: (cmd: string) => void;
  onOpenFolder: () => void;
  onSelectFile: (path: string) => void;
  onFileContentChange: (value: string) => void;
  onSaveFile: () => void;
  onCloseFile?: () => void;
  onRefreshFiles: () => void;
  checkpoints?: string[];
  liveTerminalOutput?: string;
  onApproveToolCall?: (callId: string, accept: boolean) => void;
  recentWorkspaces?: string[];
  onSelectRecent?: (path: string) => void;
  onOpenSettings?: () => void;
  appVersion?: string;
  // Multi-tab props
  openTabs: EditorTab[];
  activeTabIndex: number;
  fileBuffers: Map<string, { content: string; dirty: boolean; loading: boolean }>;
  onApplyWorkspaceEdit?: (edit: import("@/types").LspWorkspaceEdit) => Promise<void>;
  inlineCompletions?: import("@/lib/completion/settingsClient").InlineCompletionSettings | null;
  onSelectTab: (index: number) => void;
  onCloseTab: (index: number) => void;
  onReorderTabs: (from: number, to: number) => void;
  // Settings tab props (needed when settings tab is active)
  shortcuts: CustomShortcut[];
  promptTemplates: PromptTemplate[];
  mcpServers: MCPServer[];
  onSaveShortcuts: (shortcuts: CustomShortcut[]) => void;
  onSaveTemplates: (templates: PromptTemplate[]) => void;
  onSaveMCPServers: (servers: MCPServer[]) => void;
  attachments?: ImageAttachment[];
  onAttachmentsChange?: (attachments: ImageAttachment[]) => void;
  onAgentVoiceClick?: () => void;
  planMode?: boolean;
  onPlanModeChange?: (v: boolean) => void;
  liteAgentMode?: boolean;
  onEditPrompt?: (messageId: string) => void;
  onOpenPreviewTab?: (url: string) => void;
  onOpenRestTab?: () => void;
  onJumpToLine?: (path: string, line: number) => void;
  conversationId?: string | null;
}

export function AgentWorkspace({
  messages,
  input,
  isRunning,
  error,
  provider,
  model,
  tokenUsage,
  speechEnabled,
  wakeEnabled,
  voiceState,
  isVoiceSupported,
  voiceError,
  workspaceRoot,
  files,
  selectedFilePath,
  fileContent,
  fileError,
  isFileLoading,
  isFileDirty,
  terminalOutput,
  onProviderChange,
  onModelChange,
  onToggleSpeech,
  onToggleWakeWord,
  onInputChange,
  onSend,
  onStop,
  onSlashCommand,
  onOpenFolder,
  onSelectFile,
  onFileContentChange,
  onSaveFile,
  onCloseFile,
  onRefreshFiles,
  checkpoints = [],
  liveTerminalOutput,
  onApproveToolCall,
  recentWorkspaces = [],
  onSelectRecent,
  onOpenSettings,
  appVersion,
  openTabs,
  activeTabIndex,
  fileBuffers,
  onApplyWorkspaceEdit,
  inlineCompletions,
  onSelectTab,
  onCloseTab,
  onReorderTabs,
  shortcuts,
  promptTemplates,
  mcpServers,
  onSaveShortcuts,
  onSaveTemplates,
  onSaveMCPServers,
  attachments,
  onAttachmentsChange,
  onAgentVoiceClick,
  planMode,
  onPlanModeChange,
  liteAgentMode,
  onEditPrompt,
  onOpenPreviewTab,
  onOpenRestTab,
  onJumpToLine,
  conversationId,
}: AgentWorkspaceProps) {
  const [showExplorer, setShowExplorer] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("marven-show-explorer") !== "false";
  });
  const [showOutline, setShowOutline] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("marven-show-right") !== "false";
  });
  const [showDiff, setShowDiff] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [commandPalette, setCommandPalette] = useState(false);
  // Find / Replace bar state — lives here so ⌘F / ⌘⌥F shortcuts registered via
  // useEditorShortcuts can drive it. EditorPanel reads the props and renders
  // the bar + highlight overlay; navigation/replace actions stay inside the
  // panel via a ref-exposed action set.
  const [findOpen, setFindOpen] = useState(false);
  const [replaceVisible, setReplaceVisible] = useState(false);
  const findActionsRef = useRef<{
    next: () => void;
    prev: () => void;
    focus: () => void;
    triggerInlineEdit: () => void;
  } | null>(null);
  // Global search (⌘⇧F) — when true, the left column shows GlobalSearchPanel
  // instead of FileExplorer. We restore the explorer when closed.
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  // Git panel (⌥G) — when true, the left column shows GitPanel instead of
  // FileExplorer/GlobalSearch. Persisted across sessions.
  const [showGitPanel, setShowGitPanel] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("marven-show-git") === "true";
  });
  // Handle on the underlying CodeEditor so we can scroll to a specific line
  // after the global-search panel triggers a file open.
  const editorActionsRef = useRef<CodeEditorActions | null>(null);
  const [isWindows, setIsWindows] = useState(false);
  useEffect(() => {
    const el = (window as unknown as { marvenElectron?: { platform?: string } }).marvenElectron;
    setIsWindows(el?.platform === "win32");
  }, []);
  // Pending jump from a global-search click. Held in state (not just a ref) so
  // that re-clicking a match in the SAME file fires the effect again — refs
  // don't trigger re-renders. The token bumps on each request to force the
  // effect to re-evaluate even when path/line/col are identical.
  const [pendingJump, setPendingJump] = useState<
    { path: string; line: number; col: number; token: number } | null
  >(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("marven-show-explorer", String(showExplorer));
    }
  }, [showExplorer]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("marven-show-right", String(showRightPanel));
    }
  }, [showRightPanel]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("marven-show-git", String(showGitPanel));
    }
  }, [showGitPanel]);

  const [memoryScopes, setMemoryScopes] = useState<{ global: string[]; project: string[]; conversation: string[] }>({
    global: [],
    project: [],
    conversation: [],
  });
  const [memoryOpen, setMemoryOpen] = useState(false);
  const memoryRef = useRef<HTMLDivElement>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const tasksRef = useRef<HTMLDivElement>(null);
  const agentRunStartedAtRef = useRef<number | null>(null);
  const wasRunningRef = useRef(false);

  // Track the start time of an agent run so the Background tasks popover can
  // display elapsed time. Flip false → true: stamp now. Flip true → false:
  // clear. (We don't reset when transitioning false→false.)
  useEffect(() => {
    if (isRunning && !wasRunningRef.current) {
      agentRunStartedAtRef.current = Date.now();
    } else if (!isRunning && wasRunningRef.current) {
      agentRunStartedAtRef.current = null;
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    if (!viewMenuOpen) return;
    function handleOutside(e: MouseEvent) {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) {
        setViewMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [viewMenuOpen]);

  useEffect(() => {
    if (!tasksOpen) return;
    function handleOutside(e: MouseEvent) {
      if (tasksRef.current && !tasksRef.current.contains(e.target as Node)) {
        setTasksOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [tasksOpen]);

  function refreshMemory() {
    const params = new URLSearchParams();
    if (workspaceRoot) params.set("workspaceRoot", workspaceRoot);
    if (conversationId) params.set("conversationId", conversationId);
    fetch(`/api/memory${params.toString() ? `?${params.toString()}` : ""}`)
      .then((r) => r.json())
      .then((d) => setMemoryScopes({
        global: Array.isArray(d?.scopes?.global) ? d.scopes.global : [],
        project: Array.isArray(d?.scopes?.project) ? d.scopes.project : [],
        conversation: Array.isArray(d?.scopes?.conversation) ? d.scopes.conversation : [],
      }))
      .catch(() => {});
  }

  useEffect(() => {
    refreshMemory();
  }, [workspaceRoot, conversationId]);

  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    if (!isRunning) {
      refreshMemory();
    }
  }, [isRunning]);

  useEffect(() => {
    if (!memoryOpen) return;
    function handleOutside(e: MouseEvent) {
      if (memoryRef.current && !memoryRef.current.contains(e.target as Node)) {
        setMemoryOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [memoryOpen]);

  const memoryLineCount = memoryScopes.global.length + memoryScopes.project.length + memoryScopes.conversation.length;

  // ── Explorer panel (left) drag ────────────────────────────────────────────
  const [explorerWidth, setExplorerWidth] = useState(() => {
    if (typeof window === "undefined") return 240;
    return Math.min(500, Math.max(180, Number(localStorage.getItem("marven-explorer-width") ?? 240) || 240));
  });
  const isExplorerDragging = useRef(false);
  const explorerDragStartX = useRef(0);
  const explorerDragStartWidth = useRef(0);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isExplorerDragging.current) return;
      const delta = e.clientX - explorerDragStartX.current;
      const next = Math.min(500, Math.max(180, explorerDragStartWidth.current + delta));
      setExplorerWidth(next);
    }
    function onMouseUp() {
      if (!isExplorerDragging.current) return;
      isExplorerDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("marven-explorer-width", String(explorerWidth));
  }, [explorerWidth]);

  function startExplorerDrag(e: React.MouseEvent) {
    e.preventDefault();
    isExplorerDragging.current = true;
    explorerDragStartX.current = e.clientX;
    explorerDragStartWidth.current = explorerWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  // ── Right panel drag ──────────────────────────────────────────────────────
  const [rightWidth, setRightWidth] = useState(() => {
    if (typeof window === "undefined") return 380;
    return Math.min(700, Math.max(380, Number(localStorage.getItem("marven-right-width") ?? 380) || 380));
  });
  const isRightDragging = useRef(false);
  const rightDragStartX = useRef(0);
  const rightDragStartWidth = useRef(0);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isRightDragging.current) return;
      const delta = rightDragStartX.current - e.clientX;
      const next = Math.min(700, Math.max(380, rightDragStartWidth.current + delta));
      setRightWidth(next);
    }
    function onMouseUp() {
      if (!isRightDragging.current) return;
      isRightDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("marven-right-width", String(rightWidth));
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [rightWidth]);

  function startRightDrag(e: React.MouseEvent) {
    e.preventDefault();
    isRightDragging.current = true;
    rightDragStartX.current = e.clientX;
    rightDragStartWidth.current = rightWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEditorShortcuts({
    onSave: onSaveFile,
    onCloseTab: () => onCloseTab(activeTabIndex),
    onToggleExplorer: () => setShowExplorer((v) => !v),
    onToggleTerminal: () => setShowTerminal((v) => !v),
    onToggleChat: () => setShowRightPanel((v) => !v),
    onQuickOpen: () => setQuickOpen(true),
    onCommandPalette: () => setCommandPalette(true),
    onOpenSettings: () => onOpenSettings?.(),
    onFind: () => {
      setFindOpen(true);
      setReplaceVisible(false);
      // If already open, refocus the search input + select its text. Schedule
      // after state updates flush so the EditorPanel's ref is hooked up.
      requestAnimationFrame(() => findActionsRef.current?.focus());
    },
    onFindAndReplace: () => {
      setFindOpen(true);
      setReplaceVisible(true);
      requestAnimationFrame(() => findActionsRef.current?.focus());
    },
    onFindNext: () => findActionsRef.current?.next(),
    onFindPrev: () => findActionsRef.current?.prev(),
    onInlineEdit: () => findActionsRef.current?.triggerInlineEdit(),
    onGlobalSearch: () => {
      // Toggle the panel. Also force the explorer column visible when opening
      // so the panel has somewhere to render.
      setGlobalSearchOpen((v) => {
        const next = !v;
        if (next) setShowExplorer(true);
        return next;
      });
    },
    onGitPanel: () => {
      setShowGitPanel((v) => {
        const next = !v;
        if (next) setShowExplorer(true);
        return next;
      });
    },
  });

  // ── Global-search match-click flow ───────────────────────────────────────
  // When the user clicks a search result, we (1) open the file via the
  // existing onSelectFile prop and (2) stash the target line in state. The
  // effect below watches selectedFilePath + the buffer's loading state and
  // fires scrollToLine once both line up. The `token` field ensures repeat
  // clicks on the SAME line still trigger the effect.
  const jumpTokenRef = useRef(0);
  function handleSelectMatch(relPath: string, line: number, col: number) {
    jumpTokenRef.current += 1;
    setPendingJump({ path: relPath, line, col, token: jumpTokenRef.current });
    onSelectFile(relPath);
  }

  // selectedFilePath is the absolute or workspace-relative path stored by the
  // parent; the search panel emits the relative path it got from grep. We
  // compare by suffix so either form matches.
  const isPendingPathActive =
    pendingJump && selectedFilePath
      ? selectedFilePath === pendingJump.path ||
        selectedFilePath.endsWith("/" + pendingJump.path) ||
        (workspaceRoot && selectedFilePath === workspaceRoot + "/" + pendingJump.path)
      : false;

  // Look up the loading state of the active buffer. The Map's key is the same
  // path that appears in openTabs — either the workspace-relative form or the
  // absolute form depending on how the file was opened.
  const activeBufferKey = selectedFilePath ?? "";
  const activeBuffer = fileBuffers.get(activeBufferKey);
  const isActiveBufferLoading = activeBuffer?.loading ?? false;

  useEffect(() => {
    if (!pendingJump) return;
    if (!isPendingPathActive) return;
    if (isActiveBufferLoading) return;
    // Defer one frame so the CodeEditor's value-update effect has dispatched
    // its setState into the view.
    const id = requestAnimationFrame(() => {
      editorActionsRef.current?.scrollToLine(pendingJump.line, pendingJump.col);
      editorActionsRef.current?.focus();
      setPendingJump(null);
    });
    return () => cancelAnimationFrame(id);
  }, [pendingJump, isPendingPathActive, isActiveBufferLoading]);

  // ── Command Palette commands list ────────────────────────────────────────
  const W = isWindows;
  const paletteCommands: PaletteCommand[] = [
    { label: "Save File", keybinding: W ? "Ctrl+S" : "⌘S", action: onSaveFile },
    { label: "Close Tab", keybinding: W ? "Ctrl+W" : "⌘W", action: () => onCloseTab(activeTabIndex) },
    { label: "Toggle Sidebar", keybinding: W ? "Ctrl+B" : "⌘B", action: () => setShowExplorer((v) => !v) },
    { label: "Toggle Terminal", keybinding: W ? "Ctrl+`" : "⌃`", action: () => setShowTerminal((v) => !v) },
    { label: "Toggle Chat", keybinding: W ? "Ctrl+Alt+I" : "⌃⌘I", action: () => setShowRightPanel((v) => !v) },
    { label: "Open Quick File", keybinding: W ? "Ctrl+P" : "⌘P", action: () => setQuickOpen(true) },
    { label: "Find", keybinding: W ? "Ctrl+F" : "⌘F", action: () => { setFindOpen(true); setReplaceVisible(false); requestAnimationFrame(() => findActionsRef.current?.focus()); } },
    { label: "Find and Replace", keybinding: W ? "Ctrl+Alt+F" : "⌘⌥F", action: () => { setFindOpen(true); setReplaceVisible(true); requestAnimationFrame(() => findActionsRef.current?.focus()); } },
    { label: "Search files", keybinding: W ? "Ctrl+Shift+F" : "⇧⌘F", action: () => { setGlobalSearchOpen(true); setShowExplorer(true); } },
    { label: "Inline AI Edit (selection)", keybinding: W ? "Ctrl+K" : "⌘K", action: () => findActionsRef.current?.triggerInlineEdit() },
    { label: "Git panel", keybinding: W ? "Alt+G" : "⌥G", action: () => { setShowGitPanel((v) => { const next = !v; if (next) setShowExplorer(true); return next; }); } },
    { label: "Open Settings", action: () => onOpenSettings?.() },
    { label: "Open Folder", action: onOpenFolder },
    { label: "Toggle Diff Panel", action: () => setShowDiff((v) => !v) },
    { label: "New REST request", action: () => onOpenRestTab?.() },
  ];

  // Landing page when no workspace is open AND no settings tab is open
  const hasSettingsTab = openTabs.some((t) => t.kind === "settings");
  if (!workspaceRoot && !hasSettingsTab) {
    return (
      <WorkspaceLanding
        recentWorkspaces={recentWorkspaces}
        version={appVersion}
        onOpenFolder={onOpenFolder}
        onSelectRecent={(p) => onSelectRecent?.(p)}
        onOpenSettings={() => onOpenSettings?.()}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--m-bg)]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-1">
        {/* Panel toggles — VS Code style */}
        <button
          type="button"
          onClick={() => setShowExplorer((v) => !v)}
          className={`rounded p-1 transition-colors ${
            showExplorer ? "text-[#d19a66]" : "text-[#555] hover:text-[#aaa]"
          }`}
          title={showExplorer ? "Hide file explorer" : "Show file explorer"}
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="1.5" y="2.5" width="4" height="11" fill="currentColor" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => setShowTerminal((v) => !v)}
          className={`rounded p-1 transition-colors ${
            showTerminal ? "text-[#d19a66]" : "text-[#555] hover:text-[#aaa]"
          }`}
          title={showTerminal ? "Hide terminal" : "Show terminal"}
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="1.5" y="10" width="13" height="3.5" fill="currentColor" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => setShowRightPanel((v) => !v)}
          className={`rounded p-1 transition-colors ${
            showRightPanel ? "text-[#d19a66]" : "text-[#555] hover:text-[#aaa]"
          }`}
          title={showRightPanel ? "Hide chat panel" : "Show chat panel"}
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <rect x="10.5" y="2.5" width="4" height="11" fill="currentColor" />
          </svg>
        </button>

        {/* Git panel toggle */}
        {workspaceRoot && (
          <button
            type="button"
            onClick={() => {
              setShowGitPanel((v) => {
                const next = !v;
                if (next) setShowExplorer(true);
                return next;
              });
            }}
            className={`rounded p-1 transition-colors ${
              showGitPanel ? "text-[var(--m-accent)]" : "text-[#555] hover:text-[#aaa]"
            }`}
            title={showGitPanel ? "Hide git panel" : "Show git panel (⌥G)"}
          >
            {/* Git branch icon: two-path fork */}
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <circle cx="6" cy="5" r="2" />
              <circle cx="18" cy="5" r="2" />
              <circle cx="6" cy="19" r="2" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 7v10M6 7c0 4 12 5 12-2" />
            </svg>
          </button>
        )}

        {/* REST client button */}
        <button
          type="button"
          onClick={() => onOpenRestTab?.()}
          className="rounded p-1 transition-colors text-[#555] hover:text-[#aaa]"
          title="New REST request"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </button>

        {checkpoints.length > 0 && showRightPanel && (
          <button
            type="button"
            onClick={() => setShowDiff((v) => !v)}
            className={`ml-1 rounded px-2 py-0.5 text-[10px] transition-colors ${
              showDiff ? "text-[#d19a66] bg-[#d19a66]/10" : "text-[var(--m-text-muted)] hover:text-[var(--m-text)]"
            }`}
            title="Toggle diff panel"
          >
            Diff ({checkpoints.length})
          </button>
        )}

        {memoryLineCount > 0 && (
          <div ref={memoryRef}>
            <button
              type="button"
              onClick={() => setMemoryOpen((v) => !v)}
              title="Agent memory"
              className={`flex items-center gap-1 rounded border px-2 py-1 text-[10px] transition-colors ${
                memoryOpen
                  ? "border-[#d19a66]/40 bg-[#d19a66]/10 text-[#d19a66]"
                  : "border-[var(--m-border)] bg-[var(--m-surface-2)] text-[var(--m-text-muted)] hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)]"
              }`}
            >
              {/* Three connected nodes — echoes the Marven logo's Y-shape */}
              <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round">
                <line x1="2.5" y1="3" x2="6" y2="6" />
                <line x1="9.5" y1="3" x2="6" y2="6" />
                <line x1="6" y1="6" x2="6" y2="10" />
                <circle cx="2.5" cy="3" r="1.4" fill="currentColor" />
                <circle cx="9.5" cy="3" r="1.4" fill="currentColor" />
                <circle cx="6" cy="10" r="1.4" fill="currentColor" />
                <circle cx="6" cy="6" r="1.4" fill="currentColor" />
              </svg>
              <span>{memoryLineCount}</span>
            </button>

            {memoryOpen && (
              <MemoryPopover
                anchor={memoryRef.current}
                scopes={memoryScopes}
                onClear={async (scope) => {
                  await fetch("/api/memory", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ scope, workspaceRoot, conversationId }),
                  });
                  if (scope) {
                    setMemoryScopes((prev) => ({ ...prev, [scope]: [] }));
                  } else {
                    setMemoryScopes({ global: [], project: [], conversation: [] });
                  }
                  setMemoryOpen(false);
                }}
              />
            )}
          </div>
        )}

        {/* View menu — top-right kebab */}
        <div ref={viewMenuRef} className="ml-auto">
          <div ref={tasksRef}>
          <button
            type="button"
            onClick={() => setViewMenuOpen((v) => !v)}
            title="View menu"
            className={`flex h-7 items-center gap-0.5 rounded px-1.5 transition-colors ${
              viewMenuOpen ? "bg-[var(--m-surface-2)] text-[var(--m-text)]" : "text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
            }`}
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <line x1="5.5" y1="3.5" x2="5.5" y2="12.5" stroke="currentColor" strokeWidth="1.2" />
            </svg>
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 6 8 10 12 6" />
            </svg>
          </button>
          {viewMenuOpen && (
            <ViewMenu
              anchor={viewMenuRef.current}
              onClose={() => setViewMenuOpen(false)}
              items={[
                {
                  key: "preview",
                  label: "Preview",
                  icon: (
                    <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <polygon points="6 4 20 12 6 20 6 4" />
                    </svg>
                  ),
                  onClick: () => {
                    // Open the active file in the external browser via file://
                    // for previewable kinds (HTML, Markdown, common image formats,
                    // SVG). Browsers handle .md inconsistently but at least the
                    // user sees something. Anything else is a silent no-op.
                    const tab = activeTabIndex >= 0 ? openTabs[activeTabIndex] : null;
                    if (tab?.kind !== "file") return;
                    const ext = tab.path.split(".").pop()?.toLowerCase();
                    const previewable = new Set([
                      "html",
                      "htm",
                      "md",
                      "mdx",
                      "png",
                      "jpg",
                      "jpeg",
                      "gif",
                      "webp",
                      "svg",
                      "ico",
                    ]);
                    if (!ext || !previewable.has(ext)) return;
                    const abs = tab.path.startsWith("/") ? tab.path : `${workspaceRoot ?? ""}/${tab.path}`;
                    const url = `file://${abs}`;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const el = (window as any).marvenElectron;
                    if (el?.openExternal) el.openExternal(url, "default");
                    else window.open(url, "_blank", "noopener,noreferrer");
                  },
                },
                {
                  key: "diff",
                  label: "Diff" + (checkpoints.length > 0 ? ` (${checkpoints.length})` : ""),
                  hint: W ? "Ctrl+Shift+D" : "⇧⌘D",
                  icon: (
                    <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <rect x="3" y="4" width="7" height="16" rx="1" />
                      <rect x="14" y="4" width="7" height="16" rx="1" />
                    </svg>
                  ),
                  disabled: !showRightPanel,
                  onClick: () => { setShowDiff((v) => !v); if (!showRightPanel) setShowRightPanel(true); },
                },
                {
                  key: "terminal",
                  label: "Terminal",
                  hint: W ? "Ctrl+`" : "⌃`",
                  icon: (
                    <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 8l4 4-4 4M11 16h7" />
                    </svg>
                  ),
                  onClick: () => setShowTerminal((v) => !v),
                },
                {
                  key: "files",
                  label: "Files",
                  hint: W ? "Ctrl+B" : "⌘B",
                  icon: (
                    <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25" />
                    </svg>
                  ),
                  onClick: () => setShowExplorer((v) => !v),
                },
                {
                  key: "search",
                  label: "Search files",
                  hint: W ? "Ctrl+Shift+F" : "⇧⌘F",
                  icon: (
                    <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <circle cx="11" cy="11" r="7" />
                      <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
                    </svg>
                  ),
                  onClick: () => {
                    setViewMenuOpen(false);
                    setGlobalSearchOpen(true);
                    setShowExplorer(true);
                  },
                },
                {
                  key: "git",
                  label: "Git panel",
                  hint: "⌥G",
                  icon: (
                    <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <circle cx="6" cy="5" r="2" />
                      <circle cx="18" cy="5" r="2" />
                      <circle cx="6" cy="19" r="2" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 7v10M6 7c0 4 12 5 12-2" />
                    </svg>
                  ),
                  disabled: !workspaceRoot,
                  onClick: () => {
                    setShowGitPanel((v) => {
                      const next = !v;
                      if (next) setShowExplorer(true);
                      return next;
                    });
                  },
                },
                {
                  key: "tasks",
                  label: "Background tasks",
                  badge: isRunning,
                  icon: (
                    <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  ),
                  onClick: () => {
                    setViewMenuOpen(false);
                    setTasksOpen(true);
                  },
                },
                {
                  key: "rest",
                  label: "New REST request",
                  hint: "",
                  icon: (
                    <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  ),
                  onClick: () => {
                    setViewMenuOpen(false);
                    onOpenRestTab?.();
                  },
                },
              ]}
            />
          )}
          {tasksOpen && (
            <BackgroundTasksPopover
              anchor={tasksRef.current}
              isRunning={isRunning}
              startedAt={agentRunStartedAtRef.current}
              onStop={() => {
                onStop();
                setTasksOpen(false);
              }}
            />
          )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left — File Explorer OR Global Search (mutually exclusive in
            the explorer column). Search panel takes over when ⌘⇧F is
            active; closing it (Esc / ✕) restores the explorer. */}
        {showExplorer && (
          <>
            <div
              className="flex flex-col border-r border-[var(--m-border)]"
              style={{ width: explorerWidth, minWidth: explorerWidth, flexShrink: 0 }}
            >
              {showGitPanel && workspaceRoot ? (
                <GitPanel
                  workspaceRoot={workspaceRoot}
                  provider={provider as AIProvider}
                  model={model}
                  onClose={() => setShowGitPanel(false)}
                />
              ) : globalSearchOpen ? (
                <GlobalSearchPanel
                  workspaceRoot={workspaceRoot}
                  onClose={() => setGlobalSearchOpen(false)}
                  onSelectMatch={handleSelectMatch}
                />
              ) : (
                <>
                  <FileExplorer
                    files={files}
                    workspaceRoot={workspaceRoot}
                    selectedFilePath={selectedFilePath}
                    onSelectFile={onSelectFile}
                    onRefreshFiles={onRefreshFiles}
                    onOpenFolder={onOpenFolder}
                  />
                  {/* Symbol Outline — shown only when a code file is active */}
                  {selectedFilePath && fileContent && (
                    <div className="border-t border-[var(--m-border-subtle)] shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowOutline((v) => !v)}
                        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
                      >
                        <svg
                          className={`h-2.5 w-2.5 transition-transform ${showOutline ? "" : "-rotate-90"}`}
                          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
                        </svg>
                        Outline
                      </button>
                      {showOutline && (
                        <SymbolOutline
                          content={fileContent}
                          filePath={selectedFilePath}
                          onJumpToLine={(line) => {
                            if (onJumpToLine) {
                              onJumpToLine(selectedFilePath, line);
                            } else {
                              // Fallback: use the pendingJump mechanism directly
                              jumpTokenRef.current += 1;
                              setPendingJump({ path: selectedFilePath, line, col: 1, token: jumpTokenRef.current });
                            }
                          }}
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
            {/* Drag handle 1 — between Explorer and Editor */}
            <div
              onMouseDown={startExplorerDrag}
              className="group relative z-10 -ml-px w-1 cursor-col-resize bg-transparent hover:bg-[#d19a66]/40 active:bg-[#d19a66]/60 transition-colors"
              title="Drag to resize"
            >
              <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="h-8 w-0.5 rounded-full bg-[#d19a66]/60" />
              </div>
            </div>
          </>
        )}

        {/* Middle — Editor (always shown, flexes to fill) */}
        <div className="min-h-0 min-w-0 flex-1">
          <EditorPanel
            workspaceRoot={workspaceRoot}
            selectedFilePath={selectedFilePath}
            fileContent={fileContent}
            fileError={fileError ?? null}
            isFileLoading={isFileLoading}
            isFileDirty={isFileDirty}
            terminalOutput={liveTerminalOutput ?? terminalOutput}
            showTerminal={showTerminal}
            onToggleTerminal={() => setShowTerminal((v) => !v)}
            onFileContentChange={onFileContentChange}
            onSaveFile={onSaveFile}
            onCloseFile={onCloseFile}
            openTabs={openTabs}
            activeTabIndex={activeTabIndex}
            fileBuffers={fileBuffers}
            onApplyWorkspaceEdit={onApplyWorkspaceEdit}
            inlineCompletions={inlineCompletions}
            onSelectTab={onSelectTab}
            onCloseTab={onCloseTab}
            onReorderTabs={onReorderTabs}
            shortcuts={shortcuts}
            promptTemplates={promptTemplates}
            mcpServers={mcpServers}
            onSaveShortcuts={onSaveShortcuts}
            onSaveTemplates={onSaveTemplates}
            onSaveMCPServers={onSaveMCPServers}
            onToggleChat={() => setShowRightPanel((v) => !v)}
            onCommandPalette={() => setCommandPalette(true)}
            findOpen={findOpen}
            replaceVisible={replaceVisible}
            onCloseFind={() => { setFindOpen(false); setReplaceVisible(false); }}
            onToggleReplace={() => setReplaceVisible((v) => !v)}
            findActionsRef={findActionsRef}
            editorActionsRef={editorActionsRef}
            provider={provider as import("@/types").AIProvider}
            model={model}
            onOpenPreview={onOpenPreviewTab}
          />
        </div>

        {/* Right — Chat or Diff */}
        {showRightPanel && (
          <>
            {/* Drag handle 2 — between Editor and Right panel */}
            <div
              onMouseDown={startRightDrag}
              className="group relative z-10 -ml-px w-1 cursor-col-resize bg-transparent hover:bg-[#d19a66]/40 active:bg-[#d19a66]/60 transition-colors"
              title="Drag to resize"
            >
              <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="h-8 w-0.5 rounded-full bg-[#d19a66]/60" />
              </div>
            </div>
            <div
              className="flex flex-col border-l border-[var(--m-border)]"
              style={{ width: rightWidth, minWidth: rightWidth, flexShrink: 0 }}
            >
          {showDiff ? (
            <DiffPanel checkpoints={checkpoints} onClose={() => setShowDiff(false)} />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-[var(--m-border)] bg-[var(--m-bg)] px-3 py-3">
                <span className="rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2 py-1 text-[9px] uppercase tracking-wider text-[var(--m-text-muted)]">
                  {provider}
                </span>
                <span className="truncate text-[10px] text-[var(--m-text-muted)]">{model}</span>
              </div>
              <div className="min-h-0 flex-1">
                <AgentPanel
                  messages={messages}
                  input={input}
                  isRunning={isRunning}
                  error={error}
                  provider={provider as import("@/types").AIProvider}
                  selectedModel={model}
                  tokenUsage={tokenUsage}
                  onProviderChange={onProviderChange}
                  onModelChange={onModelChange}
                  onInputChange={onInputChange}
                  onSend={onSend}
                  onStop={onStop}
                  onSlashCommand={onSlashCommand}
                  onApproveToolCall={onApproveToolCall}
                  attachments={attachments}
                  onAttachmentsChange={onAttachmentsChange}
                  isVoiceSupported={isVoiceSupported}
                  voiceState={voiceState}
                  onVoiceClick={onAgentVoiceClick}
                  planMode={planMode}
                  onPlanModeChange={onPlanModeChange}
                  liteAgentMode={liteAgentMode}
                  onEditPrompt={onEditPrompt}
                  workspaceFiles={files}
                />
              </div>
            </>
          )}
            </div>
          </>
        )}
      </div>

      {/* Quick Open modal */}
      {quickOpen && (
        <QuickOpenModal
          files={files}
          onOpen={(path) => { onSelectFile(path); }}
          onClose={() => setQuickOpen(false)}
        />
      )}

      {/* Command Palette modal */}
      {commandPalette && (
        <CommandPalette
          commands={paletteCommands}
          onClose={() => setCommandPalette(false)}
        />
      )}
    </div>
  );
}
