"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AIProvider,
  AgentMessage,
  Conversation,
  ConversationMode,
  Message as ChatMessage,
  OllamaModel,
  TokenUsage,
  CustomShortcut,
  WorkspaceFile,
} from "@/types";
import type { VoiceState } from "@/hooks/useVoice";
import { Message } from "@/app/components/marven/Message";
import { InputBar } from "@/app/components/marven/InputBar";
import { Sidebar } from "@/app/components/marven/Sidebar";
import { SettingsModal } from "@/app/components/marven/SettingsModal";
import { SpeakingWave } from "@/app/components/marven/SpeakingWave";
import { TitleBar } from "@/app/components/marven/TitleBar";
import { AgentWorkspace } from "@/app/components/marven/AgentWorkspace";

interface ChatLayoutProps {
  mode: ConversationMode;
  messages: ChatMessage[];
  conversations: Conversation[];
  activeConversationId: string | null;
  isLoading: boolean;
  input: string;
  provider: AIProvider;
  models: OllamaModel[];
  selectedModel: string;
  modelsLoading: boolean;
  modelsError: string | null;
  wakeEnabled: boolean;
  voiceError: string | null;
  lastHeard: string;
  isVoiceSupported: boolean;
  voiceState: VoiceState;
  speechEnabled: boolean;
  isSpeakingNow: boolean;
  tokenUsage: TokenUsage;
  customShortcuts: CustomShortcut[];
  agentFiles: WorkspaceFile[];
  workspaceRoot: string | null;
  selectedAgentFilePath: string | null;
  selectedAgentFileContent: string;
  isAgentFileLoading: boolean;
  isAgentFileDirty: boolean;
  agentMessages: AgentMessage[];
  agentInput: string;
  isAgentRunning: boolean;
  agentError: string | null;
  agentTerminalOutput: string;
  onAgentInputChange: (v: string) => void;
  onAgentSend: () => void;
  onAgentStop: () => void;
  onOpenFolder: () => void;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onVoiceClick: () => void;
  onProviderChange: (provider: AIProvider) => void;
  onModelChange: (model: string) => void;
  onToggleWakeWord: () => void;
  onToggleSpeech: () => void;
  onNewChat: () => void;
  onNewAgent: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onSaveShortcuts: (shortcuts: CustomShortcut[]) => void;
  onSlashCommand: (cmd: string) => void;
  onSelectAgentFile: (path: string) => void;
  onAgentFileContentChange: (value: string) => void;
  onSaveAgentFile: () => void;
  onRefreshAgentFiles: () => void;
}

function formatSize(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1_000_000).toFixed(0)} MB`;
}

function TypingRow() {
  return (
    <div className="message-in flex justify-start">
      <div className="border-l border-[#333] pl-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#666]">
            Thinking
          </span>
          <span className="dot-1 inline-block h-1.5 w-1.5 rounded-full bg-[#555]" />
          <span className="dot-2 inline-block h-1.5 w-1.5 rounded-full bg-[#555]" />
          <span className="dot-3 inline-block h-1.5 w-1.5 rounded-full bg-[#555]" />
        </div>
      </div>
    </div>
  );
}

export function ChatLayout({
  mode,
  messages,
  conversations,
  activeConversationId,
  isLoading,
  input,
  provider,
  models,
  selectedModel,
  modelsLoading,
  modelsError,
  wakeEnabled,
  voiceError,
  lastHeard,
  isVoiceSupported,
  voiceState,
  speechEnabled,
  isSpeakingNow,
  tokenUsage,
  customShortcuts,
  agentFiles,
  workspaceRoot,
  selectedAgentFilePath,
  selectedAgentFileContent,
  isAgentFileLoading,
  isAgentFileDirty,
  agentMessages,
  agentInput,
  isAgentRunning,
  agentError,
  agentTerminalOutput,
  onAgentInputChange,
  onAgentSend,
  onAgentStop,
  onOpenFolder,
  onInputChange,
  onSend,
  onVoiceClick,
  onProviderChange,
  onModelChange,
  onToggleWakeWord,
  onToggleSpeech,
  onNewChat,
  onNewAgent,
  onSelectConversation,
  onDeleteConversation,
  onSaveShortcuts,
  onSlashCommand,
  onSelectAgentFile,
  onAgentFileContentChange,
  onSaveAgentFile,
  onRefreshAgentFiles,
}: ChatLayoutProps) {
  const messagesViewportRef = useRef<HTMLElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  function handleSlashCommand(cmd: string) {
    if (cmd === "/shortcuts") {
      setSettingsOpen(true);
      return;
    }
    onSlashCommand(cmd);
  }

  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#1a1a1a] text-[#d4d4d4]">
      {/* TitleBar — draggable, frameless window controls */}
      <TitleBar />

      {/* Main row: sidebar + content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          isOpen={sidebarOpen}
          onNewChat={onNewChat}
          onNewAgent={onNewAgent}
          onSelectConversation={onSelectConversation}
          onDeleteConversation={onDeleteConversation}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* Main panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="bg-[#1e1e1e] border-b border-[#333] px-6 pb-3 pt-3 sm:px-8">
            <div className={`mx-auto w-full space-y-2.5 ${mode === "agent" ? "max-w-none" : "max-w-[920px]"}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {/* Toggle sidebar */}
                  <button
                    type="button"
                    onClick={() => setSidebarOpen((v) => !v)}
                    className="rounded-lg p-1.5 text-[#666] transition-colors hover:bg-[#2a2a2a] hover:text-[#999]"
                    aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
                    title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                    </svg>
                  </button>

                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <h1 className="text-[17px] font-semibold text-[#d4d4d4]">
                        {mode === "agent" ? "Marven Agent" : "Marven"}
                      </h1>
                      <SpeakingWave active={isSpeakingNow} />
                    </div>
                    <span className="text-[12px] text-[#666]">
                      {mode === "agent" ? "File-aware workspace" : "AI Interface"}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-[#666]">
                  {tokenUsage.totalTokens.toLocaleString()} tokens
                </div>
              </div>

              {/* Controls row */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Provider toggle */}
                <div className="inline-flex rounded-lg bg-[#252525] border border-[#383838] p-0.5">
                  <button
                    type="button"
                    onClick={() => onProviderChange("groq")}
                    className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                      provider === "groq"
                        ? "bg-[#333] text-[#d4d4d4]"
                        : "text-[#777] hover:text-[#ccc]"
                    }`}
                  >
                    Cloud
                  </button>
                  <button
                    type="button"
                    onClick={() => onProviderChange("ollama")}
                    className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                      provider === "ollama"
                        ? "bg-[#333] text-[#d4d4d4]"
                        : "text-[#777] hover:text-[#ccc]"
                    }`}
                  >
                    Ollama
                  </button>
                </div>

                {/* Model selector */}
                <div className="relative min-w-[200px]">
                  {modelsLoading ? (
                    <div className="rounded-lg border border-[#383838] px-3 py-1.5 text-[12px] text-[#666]">
                      Loading models...
                    </div>
                  ) : modelsError ? (
                    <div
                      className="rounded-lg border border-[#383838] px-3 py-1.5 text-[12px] text-[#666]"
                      title={modelsError}
                    >
                      Models unavailable
                    </div>
                  ) : models.length === 0 ? (
                    <div className="rounded-lg border border-[#383838] px-3 py-1.5 text-[12px] text-[#666]">
                      No models found
                    </div>
                  ) : (
                    <>
                      <select
                        value={selectedModel}
                        onChange={(event) => onModelChange(event.target.value)}
                        className="w-full appearance-none rounded-lg bg-transparent border border-[#383838] px-3 py-1.5 pr-8 text-[12px] text-[#ccc] outline-none focus:border-[#555]"
                      >
                        {models.map((model) => (
                          <option key={model.name} value={model.name}>
                            {model.name}
                            {model.size > 0 ? ` · ${formatSize(model.size)}` : ""}
                          </option>
                        ))}
                      </select>
                      <svg
                        className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-[#666]"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.2}
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </>
                  )}
                </div>

                {/* Speech toggle */}
                <button
                  type="button"
                  onClick={onToggleSpeech}
                  className={`rounded-lg px-2.5 py-1 text-[11px] transition-colors border ${
                    speechEnabled
                      ? "bg-[rgba(91,156,246,0.12)] border-[rgba(91,156,246,0.3)] text-[#5b9cf6]"
                      : "bg-[#252525] border-[#383838] text-[#888] hover:text-[#d4d4d4] hover:bg-[#2a2a2a]"
                  }`}
                >
                  {speechEnabled ? "Speech on" : "Speech off"}
                </button>

                {/* Wake word toggle */}
                <button
                  type="button"
                  onClick={onToggleWakeWord}
                  disabled={!isVoiceSupported}
                  title={voiceError ? `Voice error: ${voiceError}` : undefined}
                  className={`rounded-lg px-2.5 py-1 text-[11px] transition-colors border disabled:cursor-not-allowed disabled:opacity-30 ${
                    wakeEnabled
                      ? voiceState === "command-listening"
                        ? "bg-[rgba(239,68,68,0.1)] border-[rgba(239,68,68,0.3)] text-[#f87171]"
                        : "bg-[rgba(91,156,246,0.12)] border-[rgba(91,156,246,0.3)] text-[#5b9cf6]"
                      : "bg-[#252525] border-[#383838] text-[#888] hover:text-[#d4d4d4] hover:bg-[#2a2a2a]"
                  }`}
                >
                  {isVoiceSupported
                    ? wakeEnabled
                      ? '"Hey Marven" on'
                      : '"Hey Marven" off'
                    : "Voice unavailable"}
                </button>
                {voiceError && (
                  <span className="text-[10px] text-red-500/70" title={voiceError}>
                    mic: {voiceError}
                  </span>
                )}
                {wakeEnabled && lastHeard && (
                  <span
                    className="max-w-[220px] truncate text-[10px] text-[#666]"
                    title={`Last heard: "${lastHeard}"`}
                  >
                    heard: &ldquo;{lastHeard}&rdquo;
                  </span>
                )}
              </div>
            </div>
          </header>

          {mode === "agent" ? (
            <AgentWorkspace
              messages={agentMessages}
              input={agentInput}
              isRunning={isAgentRunning}
              error={agentError}
              provider={provider}
              model={selectedModel}
              workspaceRoot={workspaceRoot}
              files={agentFiles}
              selectedFilePath={selectedAgentFilePath ?? null}
              fileContent={selectedAgentFileContent ?? ""}
              isFileLoading={isAgentFileLoading ?? false}
              isFileDirty={isAgentFileDirty ?? false}
              terminalOutput={agentTerminalOutput}
              onInputChange={onAgentInputChange}
              onSend={onAgentSend}
              onStop={onAgentStop}
              onOpenFolder={onOpenFolder}
              onSelectFile={onSelectAgentFile}
              onFileContentChange={onAgentFileContentChange}
              onSaveFile={onSaveAgentFile}
              onRefreshFiles={onRefreshAgentFiles}
            />
          ) : (
            <>
              {/* Messages */}
              <main
                ref={messagesViewportRef}
                className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-10"
              >
                <div className="mx-auto flex w-full max-w-[920px] flex-col gap-5">
                  {messages.length === 0 && !isLoading && (
                    <div className="message-in py-16 text-center text-[13px] text-[#555]">
                      Start a conversation
                    </div>
                  )}
                  {messages.map((message) => (
                    <Message key={message.id} message={message} />
                  ))}
                  {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
                    <TypingRow />
                  )}
                </div>
              </main>

              {/* Input bar */}
              <footer className="bg-[#1e1e1e] border-t border-[#333] mt-auto px-6 pb-10 pt-3 sm:px-10 sm:pb-12">
                <div className="mx-auto w-full max-w-[720px]">
                  <InputBar
                    value={input}
                    isLoading={isLoading}
                    isVoiceSupported={isVoiceSupported}
                    voiceState={voiceState}
                    onChange={onInputChange}
                    onSend={onSend}
                    onVoiceClick={onVoiceClick}
                    onSlashCommand={handleSlashCommand}
                  />
                  <p className="mt-2 text-center text-[10px] text-[#444]">
                    Enter to send · Shift + Enter for new line
                  </p>
                </div>
              </footer>
            </>
          )}
        </div>
      </div>

      {/* Settings modal */}
      {settingsOpen && (
        <SettingsModal
          shortcuts={customShortcuts}
          onSave={onSaveShortcuts}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
