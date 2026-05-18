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
  MCPServer,
  PromptTemplate,
  ImageAttachment,
  EditorTab,
} from "@/types";
import type { VoiceState } from "@/hooks/useVoice";
import { Message } from "@/app/components/marven/Message";
import { InputBar } from "@/app/components/marven/InputBar";
import { Sidebar } from "@/app/components/marven/Sidebar";
import { SettingsModal } from "@/app/components/marven/SettingsModal";
import { SpeakingWave } from "@/app/components/marven/SpeakingWave";
import { TitleBar } from "@/app/components/marven/TitleBar";
import { AgentWorkspace } from "@/app/components/marven/AgentWorkspace";
import { generateMarkdown } from "@/lib/chatHelpers";

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
  sttProvider: "local" | "groq" | null;
  isSpeakingNow: boolean;
  tokenUsage: TokenUsage;
  customShortcuts: CustomShortcut[];
  agentFiles: WorkspaceFile[];
  workspaceRoot: string | null;
  selectedAgentFilePath: string | null;
  selectedAgentFileContent: string;
  selectedAgentFileError?: string | null;
  isAgentFileLoading: boolean;
  isAgentFileDirty: boolean;
  agentMessages: AgentMessage[];
  agentInput: string;
  isAgentRunning: boolean;
  agentError: string | null;
  agentTerminalOutput: string;
  liveTerminalOutput?: string;
  checkpoints?: string[];
  onApproveToolCall?: (callId: string, accept: boolean) => void;
  recentWorkspaces?: string[];
  onSelectRecent?: (path: string) => void;
  appVersion?: string;
  onAgentInputChange: (v: string) => void;
  onAgentSend: () => void;
  onAgentStop: () => void;
  onAgentSlashCommand: (cmd: string) => void;
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
  onPinConversation: (id: string, pinned: boolean) => void;
  conversationSystemPrompt: string;
  onSystemPromptChange: (value: string) => void;
  onSaveShortcuts: (shortcuts: CustomShortcut[]) => void;
  promptTemplates: PromptTemplate[];
  mcpServers: MCPServer[];
  onSaveTemplates: (templates: PromptTemplate[]) => void;
  onSaveMCPServers: (servers: MCPServer[]) => void;
  chatAttachments: ImageAttachment[];
  onAttachmentsChange: (attachments: ImageAttachment[]) => void;
  onSlashCommand: (cmd: string) => void;
  onSelectAgentFile: (path: string) => void;
  onAgentFileContentChange: (value: string) => void;
  onSaveAgentFile: () => void;
  onCloseAgentFile?: () => void;
  onRefreshAgentFiles: () => void;
  onEditMessage: (id: string, newContent: string) => void;
  onRetryMessage: (id: string) => void;
  // Multi-tab props
  openTabs: EditorTab[];
  activeTabIndex: number;
  fileBuffers: Map<string, { content: string; dirty: boolean; loading: boolean }>;
  onSelectTab: (index: number) => void;
  onCloseTab: (index: number) => void;
  onReorderTabs: (from: number, to: number) => void;
  onOpenSettings: () => void;
}

function TypingRow() {
  return (
    <div className="message-in flex justify-start">
      <div className="border-l border-[var(--m-border)] pl-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--m-text-muted)]">
            Thinking
          </span>
          <span className="dot-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--m-text-faint)]" />
          <span className="dot-2 inline-block h-1.5 w-1.5 rounded-full bg-[var(--m-text-faint)]" />
          <span className="dot-3 inline-block h-1.5 w-1.5 rounded-full bg-[var(--m-text-faint)]" />
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
  sttProvider,
  isSpeakingNow,
  tokenUsage,
  customShortcuts,
  agentFiles,
  workspaceRoot,
  selectedAgentFilePath,
  selectedAgentFileContent,
  selectedAgentFileError,
  isAgentFileLoading,
  isAgentFileDirty,
  agentMessages,
  agentInput,
  isAgentRunning,
  agentError,
  agentTerminalOutput,
  liveTerminalOutput,
  checkpoints,
  onApproveToolCall,
  recentWorkspaces,
  onSelectRecent,
  appVersion,
  onAgentInputChange,
  onAgentSend,
  onAgentStop,
  onAgentSlashCommand,
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
  onPinConversation,
  conversationSystemPrompt,
  onSystemPromptChange,
  onSaveShortcuts,
  promptTemplates,
  mcpServers,
  onSaveTemplates,
  onSaveMCPServers,
  chatAttachments,
  onAttachmentsChange,
  onSlashCommand,
  onSelectAgentFile,
  onAgentFileContentChange,
  onSaveAgentFile,
  onCloseAgentFile,
  onRefreshAgentFiles,
  onEditMessage,
  onRetryMessage,
  openTabs,
  activeTabIndex,
  fileBuffers,
  onSelectTab,
  onCloseTab,
  onReorderTabs,
  onOpenSettings,
}: ChatLayoutProps) {
  const messagesViewportRef = useRef<HTMLElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);

  useEffect(() => {
    setSystemPromptOpen(false);
  }, [activeConversationId]);

  function handleSlashCommand(cmd: string) {
    if (cmd === "/shortcuts") {
      setSettingsOpen(true);
      return;
    }
    onSlashCommand(cmd);
  }

  function handleExport() {
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv || conv.messages.length === 0) return;
    const md = generateMarkdown(conv);
    const slug = (conv.name || "conversation")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    const blob = new Blob([md], { type: "text/markdown; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    <div className="flex h-dvh flex-col overflow-hidden bg-[var(--m-bg)] text-[var(--m-text)]">
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
          onPinConversation={onPinConversation}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* Main panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="gold-gradient bg-[var(--m-surface)] border-b border-[var(--m-border)] px-6 pb-3 pt-3 sm:px-8">
            <div className={`mx-auto w-full space-y-2.5 ${mode === "agent" ? "max-w-none" : "max-w-[920px]"}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {/* Toggle sidebar */}
                  <button
                    type="button"
                    onClick={() => setSidebarOpen((v) => !v)}
                    className="rounded-lg p-1.5 text-[var(--m-text-faint)] transition-colors hover:bg-[var(--m-surface-3)] hover:text-[var(--m-text-muted)]"
                    aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
                    title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                    </svg>
                  </button>

                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <h1 className="text-[17px] font-semibold text-[var(--m-text)]">
                        {mode === "agent" ? "Marven Agent" : "Marven"}
                      </h1>
                      <SpeakingWave active={isSpeakingNow} />
                    </div>
                    <span className="text-[12px] text-[var(--m-text-faint)]">
                      {mode === "agent" ? "File-aware workspace" : "AI Interface"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Export button — only in chat mode, only when there are messages */}
                  {mode === "chat" && messages.length > 0 && (
                    <button
                      type="button"
                      onClick={handleExport}
                      title="Export as Markdown"
                      aria-label="Export conversation as Markdown"
                      className="rounded-lg p-1.5 text-[var(--m-text-faint)] transition-colors hover:bg-[var(--m-surface-3)] hover:text-[var(--m-text-muted)]"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                    </button>
                  )}

                  {/* System prompt toggle — only in chat mode */}
                  {mode === "chat" && (
                    <button
                      type="button"
                      onClick={() => setSystemPromptOpen((v) => !v)}
                      title="System prompt"
                      aria-label="Edit system prompt"
                      className={`rounded-lg p-1.5 transition-colors hover:bg-[var(--m-surface-3)] ${
                        conversationSystemPrompt
                          ? "text-[var(--m-accent)]"
                          : systemPromptOpen
                          ? "text-[var(--m-text-muted)]"
                          : "text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
                      }`}
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                      </svg>
                    </button>
                  )}

                  <div className="text-[11px] text-[var(--m-text-muted)]">
                    {tokenUsage.totalTokens.toLocaleString()} tokens
                  </div>
                </div>
              </div>

              {/* System prompt panel */}
              {mode === "chat" && systemPromptOpen && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="conv-system-prompt" className="text-[10px] uppercase tracking-wider text-[var(--m-text-faint)]">
                    System prompt for this conversation
                  </label>
                  <textarea
                    id="conv-system-prompt"
                    rows={3}
                    placeholder="Give this conversation a persona or set of instructions… (e.g. 'Answer only in French' or 'You are a Python expert')"
                    value={conversationSystemPrompt}
                    onChange={(e) => onSystemPromptChange(e.target.value)}
                    className="w-full resize-none rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-2 text-[12px] text-[var(--m-text)] placeholder-[var(--m-text-faint)] outline-none focus:border-[var(--m-border)]"
                  />
                </div>
              )}

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
              speechEnabled={speechEnabled}
              wakeEnabled={wakeEnabled}
              voiceState={voiceState}
              isVoiceSupported={isVoiceSupported}
              voiceError={voiceError}
              workspaceRoot={workspaceRoot}
              files={agentFiles}
              selectedFilePath={selectedAgentFilePath ?? null}
              fileContent={selectedAgentFileContent ?? ""}
              fileError={selectedAgentFileError ?? null}
              isFileLoading={isAgentFileLoading ?? false}
              isFileDirty={isAgentFileDirty ?? false}
              terminalOutput={agentTerminalOutput}
              liveTerminalOutput={liveTerminalOutput}
              checkpoints={checkpoints}
              onApproveToolCall={onApproveToolCall}
              recentWorkspaces={recentWorkspaces}
              onSelectRecent={onSelectRecent}
              // Agent mode now opens Settings as a full-page overlay (same as chat),
              // not as an editor tab. Override the page.tsx-supplied handler.
              onOpenSettings={() => setSettingsOpen(true)}
              appVersion={appVersion}
              onProviderChange={onProviderChange}
              onModelChange={onModelChange}
              onToggleSpeech={onToggleSpeech}
              onToggleWakeWord={onToggleWakeWord}
              onInputChange={onAgentInputChange}
              onSend={onAgentSend}
              onStop={onAgentStop}
              onSlashCommand={onAgentSlashCommand}
              onOpenFolder={onOpenFolder}
              onSelectFile={onSelectAgentFile}
              onFileContentChange={onAgentFileContentChange}
              onSaveFile={onSaveAgentFile}
              onCloseFile={onCloseAgentFile}
              onRefreshFiles={onRefreshAgentFiles}
              openTabs={openTabs}
              activeTabIndex={activeTabIndex}
              fileBuffers={fileBuffers}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseTab}
              onReorderTabs={onReorderTabs}
              shortcuts={customShortcuts}
              promptTemplates={promptTemplates}
              mcpServers={mcpServers}
              onSaveShortcuts={onSaveShortcuts}
              onSaveTemplates={onSaveTemplates}
              onSaveMCPServers={onSaveMCPServers}
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
                    <div className="message-in py-16 text-center text-[13px] text-[var(--m-text-faint)]">
                      Start a conversation
                    </div>
                  )}
                  {messages.map((message) => (
                    <Message
                      key={message.id}
                      message={message}
                      disabled={isLoading}
                      onEdit={message.role === "user" ? (content) => onEditMessage(message.id, content) : undefined}
                      onRetry={message.role === "assistant" ? () => onRetryMessage(message.id) : undefined}
                    />
                  ))}
                  {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
                    <TypingRow />
                  )}
                </div>
              </main>

              {/* Input bar */}
              <footer className="bg-[var(--m-surface)] border-t border-[var(--m-border)] mt-auto px-6 pb-10 pt-3 sm:px-10 sm:pb-12">
                <div className="mx-auto w-full max-w-[720px]">
                  <InputBar
                    value={input}
                    isLoading={isLoading}
                    isVoiceSupported={isVoiceSupported}
                    voiceState={voiceState}
                    provider={provider}
                    selectedModel={selectedModel}
                    speechEnabled={speechEnabled}
                    wakeEnabled={wakeEnabled}
                    sttProvider={sttProvider}
                    voiceError={voiceError}
                    lastHeard={lastHeard}
                    attachments={chatAttachments}
                    onAttachmentsChange={onAttachmentsChange}
                    promptTemplates={promptTemplates}
                    onChange={onInputChange}
                    onSend={onSend}
                    onVoiceClick={onVoiceClick}
                    onSlashCommand={handleSlashCommand}
                    onProviderChange={onProviderChange}
                    onModelChange={onModelChange}
                    onToggleSpeech={onToggleSpeech}
                    onToggleWakeWord={onToggleWakeWord}
                  />
                  <p className="mt-2 text-center text-[10px] text-[var(--m-text-faint)]">
                    Enter to send · Shift + Enter for new line
                  </p>
                </div>
              </footer>
            </>
          )}
        </div>
      </div>

      {/* Settings popup — chat mode only (agent mode renders it as a tab) */}
      {settingsOpen && (
        <SettingsModal
          shortcuts={customShortcuts}
          promptTemplates={promptTemplates}
          mcpServers={mcpServers}
          onSave={onSaveShortcuts}
          onSaveTemplates={onSaveTemplates}
          onSaveMCPServers={onSaveMCPServers}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
