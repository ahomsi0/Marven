"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AIProvider,
  AgentMessage,
  Conversation,
  ConversationFolder,
  ConversationMode,
  DocAttachment,
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
import { PROVIDER_LABELS } from "@/app/components/marven/ModelSelector";
import { SidebarIcon } from "@/app/components/marven/Icons";
import { useT } from "@/lib/i18n";
import { SettingsModal } from "@/app/components/marven/SettingsModal";
import { SpeakingWave } from "@/app/components/marven/SpeakingWave";
import { TitleBar } from "@/app/components/marven/TitleBar";
import { AgentWorkspace } from "@/app/components/marven/AgentWorkspace";
import { ConversationSearchPalette } from "@/app/components/marven/ConversationSearchPalette";
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
  ttsProvider: "system" | "elevenlabs";
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
  userName?: string;
  onAgentInputChange: (v: string) => void;
  onAgentSend: (opts?: { mentions?: import("@/types").Mention[] }) => void;
  onAgentRunPrompt?: (prompt: string) => void;
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
  onSaveShortcuts: (shortcuts: CustomShortcut[]) => void;
  promptTemplates: PromptTemplate[];
  mcpServers: MCPServer[];
  onSaveTemplates: (templates: PromptTemplate[]) => void;
  onSaveMCPServers: (servers: MCPServer[]) => void;
  chatAttachments: ImageAttachment[];
  onAttachmentsChange: (attachments: ImageAttachment[]) => void;
  chatDocs?: DocAttachment[];
  onChatDocsChange?: (docs: DocAttachment[]) => void;
  agentAttachments?: ImageAttachment[];
  onAgentAttachmentsChange?: (attachments: ImageAttachment[]) => void;
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
  onApplyWorkspaceEdit?: (edit: import("@/types").LspWorkspaceEdit) => Promise<void>;
  inlineCompletions?: import("@/lib/completion/settingsClient").InlineCompletionSettings | null;
  onSelectTab: (index: number) => void;
  onCloseTab: (index: number) => void;
  onReorderTabs: (from: number, to: number) => void;
  onAgentVoiceClick?: () => void;
  onOpenSettings: () => void;
  agentPlanMode?: boolean;
  onAgentPlanModeChange?: (v: boolean) => void;
  liteAgentMode?: boolean;
  workspaceTrusted?: boolean;
  onWorkspaceTrustChange?: (trusted: boolean) => void;
  conversationId?: string | null;
  folders: ConversationFolder[];
  onCreateFolder: () => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveConversation: (convId: string, folderId: string | null) => void;
  onOpenPreviewTab?: (url: string) => void;
  onOpenRestTab?: () => void;
  /** Persist code editor scroll position for the active agent file tab. */
  onAgentEditorScroll?: (scrollTop: number) => void;
  onEditAgentUserMessage?: (messageId: string, newContent: string) => void | Promise<void>;
}

function TypingRow() {
  return (
    <div className="message-in flex justify-start">
      <div className="border-s border-[var(--m-border)] ps-3 py-2">
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
  ttsProvider,
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
  userName,
  onAgentInputChange,
  onAgentSend,
  onAgentRunPrompt,
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
  onSaveShortcuts,
  promptTemplates,
  mcpServers,
  onSaveTemplates,
  onSaveMCPServers,
  chatAttachments,
  onAttachmentsChange,
  chatDocs,
  onChatDocsChange,
  agentAttachments,
  onAgentAttachmentsChange,
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
  onApplyWorkspaceEdit,
  inlineCompletions,
  onSelectTab,
  onCloseTab,
  onReorderTabs,
  onAgentVoiceClick,
  onOpenSettings,
  agentPlanMode,
  onAgentPlanModeChange,
  liteAgentMode,
  workspaceTrusted,
  onWorkspaceTrustChange,
  conversationId,
  folders,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveConversation,
  onOpenPreviewTab,
  onOpenRestTab,
  onAgentEditorScroll,
  onEditAgentUserMessage,
}: ChatLayoutProps) {
  const { t } = useT();
  const messagesViewportRef = useRef<HTMLElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [convSearchOpen, setConvSearchOpen] = useState(false);

  // ⌘⇧K — open cross-conversation search palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setConvSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  // Auto-scroll only when the user is already near the bottom — otherwise
  // streaming deltas yank the viewport down while they're scrolling up to
  // re-read earlier messages.
  const nearBottomRef = useRef(true);
  useEffect(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const update = () => {
      nearBottomRef.current =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    return () => viewport.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    if (!nearBottomRef.current) return;
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading]);

  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const chatTitle = activeConversation?.name?.trim() || t("sidebar.newChat");

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
          userName={userName}
          providerLabel={PROVIDER_LABELS[provider]}
          appVersion={appVersion}
          folders={folders}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onMoveConversation={onMoveConversation}
          onCloseSidebar={() => setSidebarOpen(false)}
        />

        {/* Main panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-4 sm:px-5">
            {/* The toggle lives in the sidebar; this copy only appears while
                the sidebar is hidden, so it can be reopened. */}
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="shrink-0 rounded-md p-1.5 text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
                aria-label={t("sidebar.openSidebar")}
                title={t("sidebar.openSidebar")}
              >
                <SidebarIcon className="h-[18px] w-[18px] rtl:-scale-x-100" />
              </button>
            )}
            <div className={`mx-auto min-w-0 flex-1 ${mode === "agent" ? "max-w-none" : "max-w-[760px]"}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h1 className="truncate text-[14px] font-medium text-[var(--m-text)]">
                        {mode === "agent" ? t("header.marvenAgent") : chatTitle}
                      </h1>
                      <SpeakingWave active={isSpeakingNow} />
                    </div>
                    {mode === "agent" && (
                      <span className="block text-[11px] leading-tight text-[var(--m-text-faint)]">{t("header.fileAwareWorkspace")}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Export button — only in chat mode, only when there are messages */}
                  {mode === "chat" && messages.length > 0 && (
                    <button
                      type="button"
                      onClick={handleExport}
                      title={t("header.exportMarkdown")}
                      aria-label={t("header.exportConversation")}
                      className="rounded-md p-1.5 text-[var(--m-text-faint)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text-muted)]"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                    </button>
                  )}

                </div>
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
              tokenUsage={tokenUsage}
              speechEnabled={speechEnabled}
              wakeEnabled={wakeEnabled}
              voiceState={voiceState}
              isVoiceSupported={isVoiceSupported}
              voiceError={voiceError}
              sttProvider={sttProvider ?? "local"}
              ttsProvider={ttsProvider}
              isSpeakingNow={isSpeakingNow}
              lastHeard={lastHeard}
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
              onRunAgentPrompt={onAgentRunPrompt}
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
              onApplyWorkspaceEdit={onApplyWorkspaceEdit}
              inlineCompletions={inlineCompletions}
              onSelectTab={onSelectTab}
              onCloseTab={onCloseTab}
              onReorderTabs={onReorderTabs}
              shortcuts={customShortcuts}
              promptTemplates={promptTemplates}
              mcpServers={mcpServers}
              onSaveShortcuts={onSaveShortcuts}
              onSaveTemplates={onSaveTemplates}
              onSaveMCPServers={onSaveMCPServers}
              attachments={agentAttachments}
              onAttachmentsChange={onAgentAttachmentsChange}
              onAgentVoiceClick={onAgentVoiceClick}
              planMode={agentPlanMode}
              onPlanModeChange={onAgentPlanModeChange}
              liteAgentMode={liteAgentMode}
              workspaceTrusted={workspaceTrusted}
              onWorkspaceTrustChange={onWorkspaceTrustChange}
              conversationId={conversationId}
              onOpenPreviewTab={onOpenPreviewTab}
              onOpenRestTab={onOpenRestTab}
              onEditorScroll={onAgentEditorScroll}
              onEditAgentUserMessage={onEditAgentUserMessage}
            />
          ) : (
            <>
              {/* Messages */}
              <main
                ref={messagesViewportRef}
                className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
              >
                <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5">
                  {messages.length === 0 && !isLoading && (
                    <div className="message-in py-12 text-center">
                      <div className="text-[13px] text-[var(--m-text-muted)]">{t("chat.emptyTitle")}</div>
                      <div className="mt-1 text-[11px] text-[var(--m-text-faint)]">{t("chat.emptyHint")}</div>
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
              <footer className="mt-auto bg-[var(--m-bg)] px-4 pb-4 pt-2 sm:px-6">
                <div className="mx-auto w-full max-w-[760px]">
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
                    ttsProvider={ttsProvider}
                    tokenUsage={tokenUsage}
                    voiceError={voiceError}
                    lastHeard={lastHeard}
                    attachments={chatAttachments}
                    onAttachmentsChange={onAttachmentsChange}
                    docs={chatDocs}
                    onDocsChange={onChatDocsChange}
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
          voiceDiagnostics={{
            isVoiceSupported,
            voiceState,
            wakeEnabled,
            speechEnabled,
            sttProvider: sttProvider ?? "local",
            ttsProvider,
            isSpeakingNow,
            voiceError,
            lastHeard,
          }}
        />
      )}

      {/* Cross-conversation search palette (⌘⇧K) */}
      {convSearchOpen && (
        <ConversationSearchPalette
          conversations={conversations}
          onClose={() => setConvSearchOpen(false)}
          onJump={(convId) => {
            onSelectConversation(convId);
            setConvSearchOpen(false);
          }}
        />
      )}
    </div>
  );
}

