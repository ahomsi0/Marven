"use client";

import { useState, useRef, useEffect } from "react";
import type { AIProvider, WorkspaceFile, AgentMessage, OllamaModel } from "@/types";
import type { VoiceState } from "@/hooks/useVoice";
import { WorkspaceBar } from "./WorkspaceBar";
import { AgentPanel } from "./AgentPanel";
import { EditorPanel } from "./EditorPanel";

interface AgentWorkspaceProps {
  messages: AgentMessage[];
  input: string;
  isRunning: boolean;
  error: string | null;
  provider: string;
  model: string;
  models: OllamaModel[];
  modelsLoading: boolean;
  modelsError: string | null;
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
  onRefreshFiles: () => void;
}

function ViewMenu({
  showAgent, showEditor, showTerminal,
  onToggleAgent, onToggleEditor, onToggleTerminal,
}: {
  showAgent: boolean; showEditor: boolean; showTerminal: boolean;
  onToggleAgent: () => void; onToggleEditor: () => void; onToggleTerminal: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const items = [
    { label: "Agent", active: showAgent, toggle: onToggleAgent },
    { label: "Editor", active: showEditor, toggle: onToggleEditor },
    { label: "Terminal", active: showTerminal, toggle: onToggleTerminal },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded border border-[#333] bg-[#252525] px-2 py-1 text-[10px] text-[#888] transition-colors hover:border-[#444] hover:text-[#bbb]"
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        View
        <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-36 rounded-md border border-[#333] bg-[#1e1e1e] py-1 shadow-lg">
          {items.map(({ label, active, toggle }) => (
            <button
              key={label}
              type="button"
              onClick={() => { toggle(); }}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-[11px] transition-colors hover:bg-[#252525]"
            >
              <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${active ? "border-[#d19a66] bg-[#d19a66]/20" : "border-[#444]"}`}>
                {active && (
                  <svg className="h-2 w-2 text-[#d19a66]" fill="currentColor" viewBox="0 0 12 12">
                    <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  </svg>
                )}
              </span>
              <span className={active ? "text-[#ccc]" : "text-[#666]"}>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentWorkspace({
  messages,
  input,
  isRunning,
  error,
  provider,
  model,
  models,
  modelsLoading,
  modelsError,
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
  onRefreshFiles,
}: AgentWorkspaceProps) {
  const [showAgent, setShowAgent] = useState(true);
  const [showEditor, setShowEditor] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);

  const [agentWidth, setAgentWidth] = useState(() => {
    if (typeof window === "undefined") return 320;
    return Math.max(400, Number(localStorage.getItem("marven-agent-width") ?? 320) || 320);
  });
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const next = Math.min(600, Math.max(400, dragStartWidth.current + delta));
      setAgentWidth(next);
    }
    function onMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
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
    localStorage.setItem("marven-agent-width", String(agentWidth));
  }, [agentWidth]);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = agentWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#1a1a1a]">
      {/* Panel toggle toolbar */}
      <div className="flex items-center gap-2 border-b border-[#2a2a2a] bg-[#161616] px-3 py-1">
        <ViewMenu
          showAgent={showAgent}
          showEditor={showEditor}
          showTerminal={showTerminal}
          onToggleAgent={() => setShowAgent((v) => !v)}
          onToggleEditor={() => setShowEditor((v) => !v)}
          onToggleTerminal={() => setShowTerminal((v) => !v)}
        />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left — Agent panel */}
        {showAgent && (
          <div
            className="flex flex-col overflow-hidden border-r border-[#333]"
            style={
              showEditor
                ? { width: agentWidth, minWidth: agentWidth, flexShrink: 0 }
                : { flex: 1 }
            }
          >
            <WorkspaceBar
              workspaceRoot={workspaceRoot}
              provider={provider}
              model={model}
              onOpenFolder={onOpenFolder}
            />
            <div className="min-h-0 flex-1">
              <AgentPanel
                messages={messages}
                input={input}
                isRunning={isRunning}
                error={error}
                provider={provider as import("@/types").AIProvider}
                models={models}
                selectedModel={model}
                modelsLoading={modelsLoading}
                modelsError={modelsError}
                onProviderChange={onProviderChange}
                onModelChange={onModelChange}
                onInputChange={onInputChange}
                onSend={onSend}
                onStop={onStop}
                onSlashCommand={onSlashCommand}
              />
            </div>
          </div>
        )}

        {/* Drag handle — only when both panels visible */}
        {showAgent && showEditor && (
          <div
            onMouseDown={startDrag}
            className="group relative z-10 -ml-px w-1 cursor-col-resize bg-transparent hover:bg-[#d19a66]/30 active:bg-[#d19a66]/50 transition-colors"
          >
            <div className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="h-8 w-0.5 rounded-full bg-[#d19a66]/60" />
            </div>
          </div>
        )}

        {/* Right — Editor panel */}
        {showEditor && (
          <div className="min-h-0 min-w-0 flex-1">
            <EditorPanel
              files={files}
              workspaceRoot={workspaceRoot}
              selectedFilePath={selectedFilePath}
              fileContent={fileContent}
              isFileLoading={isFileLoading}
              isFileDirty={isFileDirty}
              terminalOutput={terminalOutput}
              showTerminal={showTerminal}
              onToggleTerminal={() => setShowTerminal((v) => !v)}
              onSelectFile={onSelectFile}
              onFileContentChange={onFileContentChange}
              onSaveFile={onSaveFile}
              onRefreshFiles={onRefreshFiles}
            />
          </div>
        )}
      </div>
    </div>
  );
}
