"use client";

import { useState, useRef, useEffect } from "react";
import type { AIProvider, WorkspaceFile, AgentMessage, EditorTab, CustomShortcut, MCPServer, PromptTemplate } from "@/types";
import type { VoiceState } from "@/hooks/useVoice";
import { AgentPanel } from "./AgentPanel";
import { EditorPanel } from "./EditorPanel";
import { DiffPanel } from "./DiffPanel";
import { FileExplorer } from "./FileExplorer";
import { WorkspaceLanding } from "./WorkspaceLanding";
import { SettingsModal } from "./SettingsModal";
import { QuickOpenModal } from "./QuickOpenModal";
import { CommandPalette } from "./CommandPalette";
import type { PaletteCommand } from "./CommandPalette";
import { useEditorShortcuts } from "@/hooks/useEditorShortcuts";

// Memory popover — uses position:fixed with viewport coordinates so it can
// extend past the workspace's overflow-hidden bounds. Anchors at the LEFT edge
// of the trigger button and drops down to the right.
function MemoryPopover({
  anchor,
  memory,
  onClear,
}: {
  anchor: HTMLElement | null;
  memory: string;
  onClear: () => void;
}) {
  const rect = anchor?.getBoundingClientRect();
  if (!rect) return null;
  const width = 340;
  // Left-align with the button; clamp so the right edge stays on-screen.
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left));
  const top = rect.bottom + 6;

  // Parse memory entries — each starts with "- [ISO timestamp] content"
  const entries = memory
    .split(/\n\s*\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((entry) => {
      const m = entry.match(/^-\s*\[([^\]]+)\]\s*([\s\S]*)$/);
      return m
        ? { timestamp: m[1], content: m[2].trim() }
        : { timestamp: null, content: entry.replace(/^-\s*/, "") };
    });

  return (
    <div
      className="fixed z-[60] overflow-hidden rounded-lg border border-[#333] bg-[#1a1a1a] shadow-2xl"
      style={{ left, top, width }}
    >
      <div className="flex items-center justify-between border-b border-[#2a2a2a] bg-[#1e1e1e] px-3 py-2.5">
        <span className="text-[10px] font-medium uppercase tracking-widest text-[#888]">
          Agent Memory
        </span>
        <button
          type="button"
          onClick={onClear}
          className="rounded px-1.5 py-0.5 text-[10px] text-[#666] transition-colors hover:bg-red-500/10 hover:text-red-400"
        >
          Clear all
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto divide-y divide-[#252525]">
        {entries.length === 0 ? (
          <p className="p-4 text-center text-[11px] text-[#555]">No memories yet.</p>
        ) : (
          entries.map((e, i) => (
            <div key={i} className="px-3 py-2.5">
              {e.timestamp && (
                <div className="mb-1 text-[9px] uppercase tracking-wider text-[#555]">
                  {formatRelativeTime(e.timestamp)}
                </div>
              )}
              <div className="text-[12px] leading-relaxed text-[#d4d4d4] break-words">
                {e.content}
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
      className="fixed z-[60] overflow-hidden rounded-md border border-[#333] bg-[#1c1c1c] py-0.5 shadow-2xl"
      style={{ right, top, width }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          disabled={it.disabled}
          onClick={() => { it.onClick(); onClose(); }}
          className="flex w-full items-center gap-2 px-2 py-1 text-left text-[10px] text-[#d4d4d4] transition-colors hover:bg-[#252525] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span className="relative flex h-3 w-3 shrink-0 items-center justify-center text-[#aaa]">
            {it.icon}
            {it.badge && <span className="absolute -right-0.5 -top-0.5 h-1 w-1 rounded-full bg-[#5b9cf6]" />}
          </span>
          <span className="flex-1">{it.label}</span>
          {it.hint && <span className="font-mono text-[8px] text-[#666]">{it.hint}</span>}
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
  onSend: () => void;
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
}

export function AgentWorkspace({
  messages,
  input,
  isRunning,
  error,
  provider,
  model,
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
  onSelectTab,
  onCloseTab,
  onReorderTabs,
  shortcuts,
  promptTemplates,
  mcpServers,
  onSaveShortcuts,
  onSaveTemplates,
  onSaveMCPServers,
}: AgentWorkspaceProps) {
  const [showExplorer, setShowExplorer] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("marven-show-explorer") !== "false";
  });
  const [showTerminal, setShowTerminal] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("marven-show-right") !== "false";
  });
  const [showDiff, setShowDiff] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [commandPalette, setCommandPalette] = useState(false);

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

  const [memory, setMemory] = useState("");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const memoryRef = useRef<HTMLDivElement>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
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

  function refreshMemory() {
    fetch("/api/memory")
      .then((r) => r.json())
      .then((d) => setMemory(d.memory ?? ""))
      .catch(() => {});
  }

  useEffect(() => {
    refreshMemory();
  }, []);

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

  const memoryLineCount = memory ? memory.split("\n").filter((l) => l.trim()).length : 0;

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
    return Math.min(700, Math.max(280, Number(localStorage.getItem("marven-right-width") ?? 380) || 380));
  });
  const isRightDragging = useRef(false);
  const rightDragStartX = useRef(0);
  const rightDragStartWidth = useRef(0);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isRightDragging.current) return;
      const delta = rightDragStartX.current - e.clientX;
      const next = Math.min(700, Math.max(280, rightDragStartWidth.current + delta));
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
  });

  // ── Command Palette commands list ────────────────────────────────────────
  const paletteCommands: PaletteCommand[] = [
    { label: "Save File", keybinding: "⌘S", action: onSaveFile },
    { label: "Close Tab", keybinding: "⌘W", action: () => onCloseTab(activeTabIndex) },
    { label: "Toggle Sidebar", keybinding: "⌘B", action: () => setShowExplorer((v) => !v) },
    { label: "Toggle Terminal", keybinding: "⌃`", action: () => setShowTerminal((v) => !v) },
    { label: "Toggle Chat", keybinding: "⌃⌘I", action: () => setShowRightPanel((v) => !v) },
    { label: "Open Quick File", keybinding: "⌘P", action: () => setQuickOpen(true) },
    { label: "Open Settings", action: () => onOpenSettings?.() },
    { label: "Open Folder", action: onOpenFolder },
    { label: "Toggle Diff Panel", action: () => setShowDiff((v) => !v) },
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#1a1a1a]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-[#2a2a2a] bg-[#161616] px-3 py-1">
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

        {checkpoints.length > 0 && showRightPanel && (
          <button
            type="button"
            onClick={() => setShowDiff((v) => !v)}
            className={`ml-1 rounded px-2 py-0.5 text-[10px] transition-colors ${
              showDiff ? "text-[#d19a66] bg-[#d19a66]/10" : "text-[#666] hover:text-[#ccc]"
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
                  : "border-[#333] bg-[#252525] text-[#999] hover:border-[#444] hover:text-[#ccc]"
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
                memory={memory}
                onClear={async () => {
                  await fetch("/api/memory", { method: "DELETE" });
                  setMemory("");
                  setMemoryOpen(false);
                }}
              />
            )}
          </div>
        )}

        {/* View menu — top-right kebab */}
        <div ref={viewMenuRef} className="ml-auto">
          <button
            type="button"
            onClick={() => setViewMenuOpen((v) => !v)}
            title="View menu"
            className={`flex h-7 items-center gap-0.5 rounded px-1.5 transition-colors ${
              viewMenuOpen ? "bg-[#252525] text-[#d4d4d4]" : "text-[#888] hover:bg-[#252525] hover:text-[#d4d4d4]"
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
                  hint: "⇧⌘P",
                  icon: (
                    <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <polygon points="6 4 20 12 6 20 6 4" />
                    </svg>
                  ),
                  onClick: () => onSlashCommand?.("/preview"),
                },
                {
                  key: "diff",
                  label: "Diff" + (checkpoints.length > 0 ? ` (${checkpoints.length})` : ""),
                  hint: "⇧⌘D",
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
                  hint: "⌃`",
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
                  hint: "⇧⌘F",
                  icon: (
                    <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25" />
                    </svg>
                  ),
                  onClick: () => setShowExplorer((v) => !v),
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
                  onClick: () => onSlashCommand?.("/tasks"),
                },
                {
                  key: "plan",
                  label: "Plan",
                  icon: (
                    <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l1.5 1.5L13 4M9 12l1.5 1.5L13 11M9 19l1.5 1.5L13 18M17 5h4M17 12h4M17 19h4M4 5h.01M4 12h.01M4 19h.01" />
                    </svg>
                  ),
                  onClick: () => onSlashCommand?.("/plan"),
                },
              ]}
            />
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left — File Explorer */}
        {showExplorer && (
          <>
            <div
              className="flex flex-col border-r border-[#333]"
              style={{ width: explorerWidth, minWidth: explorerWidth, flexShrink: 0 }}
            >
              <FileExplorer
                files={files}
                workspaceRoot={workspaceRoot}
                selectedFilePath={selectedFilePath}
                onSelectFile={onSelectFile}
                onRefreshFiles={onRefreshFiles}
                onOpenFolder={onOpenFolder}
              />
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
              className="flex flex-col border-l border-[#333]"
              style={{ width: rightWidth, minWidth: rightWidth, flexShrink: 0 }}
            >
          {showDiff ? (
            <DiffPanel checkpoints={checkpoints} onClose={() => setShowDiff(false)} />
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-[#333] bg-[#1a1a1a] px-3 py-3">
                <span className="rounded border border-[#333] bg-[#252525] px-2 py-1 text-[9px] uppercase tracking-wider text-[#888]">
                  {provider}
                </span>
                <span className="truncate text-[10px] text-[#666]">{model}</span>
              </div>
              <div className="min-h-0 flex-1">
                <AgentPanel
                  messages={messages}
                  input={input}
                  isRunning={isRunning}
                  error={error}
                  provider={provider as import("@/types").AIProvider}
                  selectedModel={model}
                  onProviderChange={onProviderChange}
                  onModelChange={onModelChange}
                  onInputChange={onInputChange}
                  onSend={onSend}
                  onStop={onStop}
                  onSlashCommand={onSlashCommand}
                  onApproveToolCall={onApproveToolCall}
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
