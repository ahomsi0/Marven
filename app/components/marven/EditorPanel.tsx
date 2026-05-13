"use client";

import { useState } from "react";
import type { WorkspaceFile } from "@/types";

interface EditorPanelProps {
  files: WorkspaceFile[];
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  fileContent: string;
  isFileLoading: boolean;
  isFileDirty: boolean;
  terminalOutput: string;
  onSelectFile: (path: string) => void;
  onFileContentChange: (value: string) => void;
  onSaveFile: () => void;
  onRefreshFiles: () => void;
}

export function EditorPanel({
  files,
  workspaceRoot,
  selectedFilePath,
  fileContent,
  isFileLoading,
  isFileDirty,
  terminalOutput,
  onSelectFile,
  onFileContentChange,
  onSaveFile,
  onRefreshFiles,
}: EditorPanelProps) {
  const [showTerminal, setShowTerminal] = useState(true);
  const activeFileName = selectedFilePath?.split("/").pop() ?? null;
  const projectName = workspaceRoot?.split("/").filter(Boolean).pop() ?? "workspace";

  return (
    <div className="flex h-full min-w-0 flex-col bg-[#0d0d0d]">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-[220px] min-w-[220px] flex-col border-r border-[#1a1a1a] bg-[#0a0a0a]">
          <div className="flex items-center justify-between border-b border-[#1a1a1a] px-3 py-2">
            <span className="text-[9px] uppercase tracking-[0.2em] text-[#2a2a2a]">{projectName}</span>
            <button
              type="button"
              onClick={onRefreshFiles}
              className="text-[9px] text-[#333] hover:text-[#555] transition-colors"
            >
              ↻
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {files.length === 0 && (
              <p className="px-3 py-2 text-[10px] text-[#222]">No files</p>
            )}
            {files.map((file) => {
              const isActive = file.path === selectedFilePath;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => onSelectFile(file.path)}
                  title={file.path}
                  className={`flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left transition-colors ${
                    isActive
                      ? "border-[#d19a66] bg-[rgba(209,154,102,0.05)] text-[#d19a66]"
                      : "border-transparent text-[#444] hover:bg-[#111] hover:text-[#666]"
                  }`}
                >
                  <span className="truncate text-[11px] font-mono">{file.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-stretch border-b border-[#1a1a1a] bg-[#0a0a0a]">
            {activeFileName ? (
              <div className="flex items-center gap-2 border-r border-[#1a1a1a] bg-[#0d0d0d] px-4 py-2 text-[11px] font-mono text-[#666]">
                {activeFileName}
                {isFileDirty && <span className="text-[#d19a66] text-[10px]">●</span>}
              </div>
            ) : (
              <div className="px-4 py-2 text-[11px] text-[#222]">No file open</div>
            )}
            <div className="ml-auto flex items-center gap-2 px-3">
              {isFileDirty && (
                <button
                  type="button"
                  onClick={onSaveFile}
                  className="rounded border border-[#1a1a1a] px-2 py-1 text-[10px] text-[#444] transition-colors hover:border-[#2a2a2a] hover:text-[#666]"
                >
                  Save
                </button>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="w-10 shrink-0 select-none border-r border-[#141414] bg-[#0a0a0a] py-3 text-right font-mono text-[11px] leading-7 text-[#222] pr-2">
              {fileContent.split("\n").slice(0, 50).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              value={isFileLoading ? "Loading..." : fileContent}
              onChange={(e) => onFileContentChange(e.target.value)}
              disabled={!selectedFilePath || isFileLoading}
              spellCheck={false}
              className="agent-editor h-full min-h-full w-full resize-none border-0 bg-[#0d0d0d] px-4 py-3 font-mono text-[12px] leading-7 text-[#888] outline-none disabled:opacity-40"
            />
          </div>
        </div>
      </div>

      <div className={`border-t border-[#1a1a1a] bg-[#080808] ${showTerminal ? "h-[120px]" : "h-7"} flex flex-col shrink-0 transition-all`}>
        <div
          className="flex h-7 cursor-pointer items-center gap-3 border-b border-[#141414] px-3"
          onClick={() => setShowTerminal((v) => !v)}
        >
          <span className="text-[9px] uppercase tracking-[0.2em] text-[#2a2a2a]">Terminal</span>
          <span className="text-[9px] text-[#1a1a1a]">{showTerminal ? "▾" : "▸"}</span>
        </div>
        {showTerminal && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-6 text-[#444] whitespace-pre-wrap">
            {terminalOutput || <span className="text-[#1a1a1a]">No output yet.</span>}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-[#1a1a1a] bg-[#0a0a0a] px-3 py-1 font-mono text-[9px] text-[#222]">
        <span>{projectName}</span>
        <div className="flex gap-4">
          <span>{activeFileName ?? "—"}</span>
          <span className="text-[#d19a66]/30">TypeScript</span>
        </div>
      </div>
    </div>
  );
}
