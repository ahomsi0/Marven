"use client";

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
  onOpenFolder: () => void;
  onSelectFile: (path: string) => void;
  onFileContentChange: (value: string) => void;
  onSaveFile: () => void;
  onRefreshFiles: () => void;
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
  onOpenFolder,
  onSelectFile,
  onFileContentChange,
  onSaveFile,
  onRefreshFiles,
}: AgentWorkspaceProps) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[#1a1a1a]">
      {/* Left — Agent panel */}
      <div className="flex w-[320px] min-w-[320px] flex-col border-r border-[#333]">
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
          />
        </div>
      </div>

      {/* Right — Editor panel */}
      <div className="min-h-0 min-w-0 flex-1">
        <EditorPanel
          files={files}
          workspaceRoot={workspaceRoot}
          selectedFilePath={selectedFilePath}
          fileContent={fileContent}
          isFileLoading={isFileLoading}
          isFileDirty={isFileDirty}
          terminalOutput={terminalOutput}
          onSelectFile={onSelectFile}
          onFileContentChange={onFileContentChange}
          onSaveFile={onSaveFile}
          onRefreshFiles={onRefreshFiles}
        />
      </div>
    </div>
  );
}
