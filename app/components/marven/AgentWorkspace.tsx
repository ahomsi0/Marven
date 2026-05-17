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
          <div className="relative" ref={memoryRef}>
            <button
              type="button"
              onClick={() => setMemoryOpen((v) => !v)}
              title="Agent memory"
              className="flex items-center gap-1 rounded border border-[#333] bg-[#252525] px-2 py-1 text-[10px] text-[#888] transition-colors hover:border-[#444] hover:text-[#bbb]"
            >
              🧠
              <span className="text-[#666]">{memoryLineCount}</span>
            </button>

            {memoryOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-[#333] bg-[#1e1e1e] shadow-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-widest text-[#555]">Agent Memory</span>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch("/api/memory", { method: "DELETE" });
                      setMemory("");
                      setMemoryOpen(false);
                    }}
                    className="text-[10px] text-[#555] hover:text-red-400"
                  >
                    Clear
                  </button>
                </div>
                <pre className="font-mono text-[10px] text-[#888] whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                  {memory}
                </pre>
              </div>
            )}
          </div>
        )}
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
    </div>
  );
}
