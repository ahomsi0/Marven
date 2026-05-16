"use client";

import { useState } from "react";
import type { WorkspaceFile, AgentMessage } from "@/types";
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
  workspaceRoot: string | null;
  files: WorkspaceFile[];
  selectedFilePath: string | null;
  fileContent: string;
  isFileLoading: boolean;
  isFileDirty: boolean;
  terminalOutput: string;
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

function PanelToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
        active
          ? "bg-[#d19a66]/20 text-[#d19a66] border border-[#d19a66]/30"
          : "bg-[#252525] text-[#555] border border-[#333] hover:text-[#888]"
      }`}
    >
      {label}
    </button>
  );
}

export function AgentWorkspace({
  messages,
  input,
  isRunning,
  error,
  provider,
  model,
  workspaceRoot,
  files,
  selectedFilePath,
  fileContent,
  isFileLoading,
  isFileDirty,
  terminalOutput,
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#1a1a1a]">
      {/* Panel toggle toolbar */}
      <div className="flex items-center gap-2 border-b border-[#2a2a2a] bg-[#161616] px-3 py-1.5">
        <span className="text-[9px] uppercase tracking-[0.2em] text-[#444] mr-1">Panels</span>
        <PanelToggle label="Agent" active={showAgent} onClick={() => setShowAgent((v) => !v)} />
        <PanelToggle label="Editor" active={showEditor} onClick={() => setShowEditor((v) => !v)} />
        <PanelToggle label="Terminal" active={showTerminal} onClick={() => setShowTerminal((v) => !v)} />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left — Agent panel */}
        {showAgent && (
          <div className={`flex flex-col border-r border-[#333] ${showEditor ? "w-[320px] min-w-[320px]" : "flex-1"}`}>
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
                onInputChange={onInputChange}
                onSend={onSend}
                onStop={onStop}
                onSlashCommand={onSlashCommand}
              />
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
