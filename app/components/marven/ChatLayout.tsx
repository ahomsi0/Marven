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
import { PROVIDER_LABELS, shortModelName } from "@/app/components/marven/ModelSelector";
import { GlobeIcon, SidebarIcon } from "@/app/components/marven/Icons";
import { BrowserPanel } from "@/app/components/marven/browser/BrowserPanel";
import { useT } from "@/lib/i18n";
import { SettingsModal } from "@/app/components/marven/SettingsModal";
import { SpeakingWave } from "@/app/components/marven/SpeakingWave";
import { TitleBar } from "@/app/components/marven/TitleBar";
import { AgentWorkspace } from "@/app/components/marven/AgentWorkspace";
import { ConversationSearchPalette } from "@/app/components/marven/ConversationSearchPalette";
import { CommandPalette, type PaletteCommand } from "@/app/components/marven/CommandPalette";
import { LanguageModal } from "@/app/components/marven/LanguageModal";
import { generateMarkdown } from "@/lib/chatHelpers";
import { getStoredTheme, isDarkTheme, setStoredTheme, type Theme } from "@/lib/theme";
import { useProviderModels } from "@/hooks/useProviderModels";
import { eventMatchesCombo, formatBinding, getBindingCombo, isMacPlatform, loadKeybindings } from "@/lib/keybindings";
import { getBrowserBridge } from "@/lib/inAppBrowser";
import { versionControls } from "@/lib/messageVersions";
import { OPEN_SETTINGS_EVENT, openSettingsPage } from "@/lib/settingsNav";

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
  /** Stop the chat reply streaming into the active conversation. */
  onStop?: () => void;
  onVoiceClick: () => void;
  onModelSelect: (provider: AIProvider, model: string) => void;
  onToggleWakeWord: () => void;
  onToggleSpeech: () => void;
  onNewChat: () => void;
  onNewAgent: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onPinConversation: (id: string, pinned: boolean) => void;
  onRenameConversation: (id: string, name: string) => void;
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
  /** Regenerate a reply; `override` answers with another model for this reply only. */
  onRetryMessage: (id: string, override?: { provider: AIProvider; model: string }) => void;
  onSwitchVersion?: (userMessageId: string, version: number) => void;
  onBranchFromMessage?: (messageId: string) => void;
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

const BROWSER_WIDTH_KEY = "marven-browser-width";
const THEMES: Theme[] = ["dark", "light", "midnight", "aurora"];
// The browser panel's minimum width, and the space the chat always keeps.
const BROWSER_MIN_WIDTH = 360;

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
  onStop,
  onVoiceClick,
  onModelSelect,
  onToggleWakeWord,
  onToggleSpeech,
  onNewChat,
  onNewAgent,
  onSelectConversation,
  onDeleteConversation,
  onPinConversation,
  onRenameConversation,
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
  onSwitchVersion,
  onBranchFromMessage,
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
  // In-app browser panel beside the chat (globe button in the header).
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserExpanded, setBrowserExpanded] = useState(false);
  // Browser panel width in px, set by dragging its edge; null = half the row.
  const [browserWidth, setBrowserWidth] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = Number(localStorage.getItem(BROWSER_WIDTH_KEY));
      return saved >= BROWSER_MIN_WIDTH ? saved : null;
    } catch {
      return null;
    }
  });
  const [browserResizing, setBrowserResizing] = useState(false);
  const browserRowRef = useRef<HTMLDivElement>(null);
  const browserAsideRef = useRef<HTMLElement>(null);

  // The chat keeps at least BROWSER_MIN_WIDTH next to the browser.
  function clampBrowserWidth(width: number) {
    const row = browserRowRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const max = Math.max(BROWSER_MIN_WIDTH, row - BROWSER_MIN_WIDTH);
    return Math.round(Math.min(Math.max(width, BROWSER_MIN_WIDTH), max));
  }

  function saveBrowserWidth(width: number | null) {
    setBrowserWidth(width);
    try {
      if (width === null) localStorage.removeItem(BROWSER_WIDTH_KEY);
      else localStorage.setItem(BROWSER_WIDTH_KEY, String(width));
    } catch { /* best effort */ }
  }

  function startBrowserResize(e: React.PointerEvent<HTMLDivElement>) {
    const row = browserRowRef.current;
    if (e.button !== 0 || !row) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rtl = document.documentElement.dir === "rtl";
    let latest: number | null = null;
    setBrowserResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      const r = row.getBoundingClientRect();
      latest = clampBrowserWidth(rtl ? ev.clientX - r.left : r.right - ev.clientX);
      setBrowserWidth(latest);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setBrowserResizing(false);
      if (latest !== null) saveBrowserWidth(latest);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function nudgeBrowserWidth(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const rtl = document.documentElement.dir === "rtl";
    // The handle sits on the browser's start edge: moving it outward widens it.
    const grow = (e.key === "ArrowLeft") !== rtl;
    const current = browserWidth ?? browserAsideRef.current?.getBoundingClientRect().width ?? BROWSER_MIN_WIDTH;
    saveBrowserWidth(clampBrowserWidth(current + (grow ? 24 : -24)));
  }
  const [convSearchOpen, setConvSearchOpen] = useState(false);
  // App-wide command palette (⌘⇧P by default, remappable in Settings → Keyboard).
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  // Agent mode publishes its workspace commands here for the palette.
  const agentPaletteCommandsRef = useRef<PaletteCommand[]>([]);
  const providerModels = useProviderModels();
  const { enabledList: enabledProviderList, loadModels } = providerModels;
  // Set once the palette's model list is first opened; loads every enabled provider.
  const [paletteModelsWanted, setPaletteModelsWanted] = useState(false);
  const enabledProvidersKey = enabledProviderList.join(",");
  useEffect(() => {
    if (!paletteModelsWanted) return;
    for (const p of enabledProviderList) void loadModels(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteModelsWanted, enabledProvidersKey, loadModels]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey && !e.altKey) return;
      const combo = getBindingCombo("command-palette", isMacPlatform(), loadKeybindings());
      if (combo && eventMatchesCombo(e, combo)) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Picking another chat while the browser is expanded would leave the chat
  // hidden behind it; collapse the browser back beside the chat instead.
  useEffect(() => {
    setBrowserExpanded(false);
  }, [activeConversationId]);

  // "Report a problem" / "Manage memory" from anywhere (palette, memory toast):
  // open the real Settings window in chat mode; the modal picks up the pending
  // page when it mounts (see lib/settingsNav.ts).
  useEffect(() => {
    if (mode !== "chat") return;
    const onOpenSettings = () => setSettingsOpen(true);
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpenSettings);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpenSettings);
  }, [mode]);

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

  function buildPaletteCommands(): PaletteCommand[] {
    const isMac = isMacPlatform();
    // Read when the palette renders: Settings changes the theme through its own hook.
    const theme = getStoredTheme();
    const general = t("palette.groups.general");
    const bridge = getBrowserBridge();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = (window as any).marvenElectron;

    // Models from every enabled provider, the one in use first.
    const modelProviders = [provider, ...enabledProviderList.filter((p) => p !== provider)];
    const modelItems: PaletteCommand[] = modelProviders.flatMap((p) =>
      providerModels.models[p].map((m) => ({
        id: `${p}:${m}`,
        label: shortModelName(m),
        hint: PROVIDER_LABELS[p],
        keywords: [m],
        active: p === provider && m === selectedModel,
        action: () => onModelSelect(p, m),
      })),
    );

    const commands: PaletteCommand[] = [
      { id: "new-chat", group: general, label: t("palette.commands.newChat"), action: onNewChat },
      { id: "new-agent", group: general, label: t("palette.commands.newAgent"), action: onNewAgent },
      {
        id: "search-conversations",
        group: general,
        label: t("palette.commands.searchConversations"),
        keybinding: isMac ? "⇧⌘K" : "Ctrl+Shift+K",
        action: () => setConvSearchOpen(true),
      },
      {
        id: "switch-model",
        group: general,
        label: t("palette.commands.switchModel"),
        hint: selectedModel ? shortModelName(selectedModel) : undefined,
        children: modelItems,
        childrenLoading:
          modelProviders.some((p) => providerModels.loading.has(p)) || (!paletteModelsWanted && modelItems.length === 0),
        emptyText: t("palette.commands.noModels"),
        onEnter: () => {
          providerModels.refreshEnabled();
          setPaletteModelsWanted(true);
          void loadModels(provider);
        },
      },
      {
        id: "toggle-theme",
        group: general,
        label: t("palette.commands.toggleTheme"),
        action: () => setStoredTheme(isDarkTheme(theme) ? "light" : "dark"),
      },
      {
        id: "pick-theme",
        group: general,
        label: t("palette.commands.pickTheme"),
        hint: t(`settings.general.theme_${theme}`),
        children: THEMES.map((id) => ({
          id,
          label: t(`settings.general.theme_${id}`),
          active: theme === id,
          action: () => setStoredTheme(id),
        })),
      },
      { id: "language", group: general, label: t("palette.commands.language"), action: () => setLanguageOpen(true) },
      {
        id: "open-settings",
        group: general,
        label: t("palette.commands.openSettings"),
        // ⌘, is only wired up inside the agent workspace.
        keybinding: mode === "agent" ? formatBinding("open-settings", isMac) : undefined,
        action: () => setSettingsOpen(true),
      },
      { id: "toggle-sidebar", group: general, label: t("palette.commands.toggleSidebar"), action: () => setSidebarOpen((v) => !v) },
    ];

    // The in-app browser lives beside the chat, and only in the desktop app.
    if (mode === "chat" && bridge) {
      commands.push(
        {
          id: "toggle-browser",
          group: general,
          label: browserOpen ? t("palette.commands.closeBrowser") : t("palette.commands.openBrowser"),
          action: () => {
            setBrowserOpen((v) => !v);
            setBrowserExpanded(false);
          },
        },
        {
          id: "new-browser-tab",
          group: general,
          label: t("palette.commands.newBrowserTab"),
          action: () => {
            setBrowserOpen(true);
            setBrowserExpanded(false);
            // Let the panel mount (and show its native view) before adding the tab.
            requestAnimationFrame(() => void bridge.newTab().catch(() => {}));
          },
        },
      );
    }

    if (mode === "chat" && messages.length > 0) {
      commands.push({ id: "export-chat", group: general, label: t("palette.commands.exportChat"), action: handleExport });
    }
    if (typeof electron?.checkForUpdates === "function") {
      commands.push({
        id: "check-updates",
        group: general,
        label: t("palette.commands.checkUpdates"),
        action: () => void Promise.resolve(electron.checkForUpdates()).catch(() => {}),
      });
    }
    commands.push({
      id: "report-problem",
      group: general,
      label: t("palette.commands.reportProblem"),
      action: () => window.dispatchEvent(new CustomEvent("marven:report-problem")),
    });
    commands.push({
      id: "manage-memory",
      group: general,
      label: t("palette.commands.manageMemory"),
      action: () => openSettingsPage({ page: "memory" }),
    });

    if (mode === "agent" && agentPaletteCommandsRef.current.length > 0) {
      const workspace = t("palette.groups.workspace");
      const agentCommands = agentPaletteCommandsRef.current.map((c) => ({ ...c, id: `agent:${c.id}`, group: workspace }));
      // In the agent workspace its own commands come first.
      return [...agentCommands, ...commands];
    }
    return commands;
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
  // Where to draw ‹ n/m › switchers for edited / retried messages.
  const versionSwitchers = versionControls(messages);
  const agentHasOwnHeader =
    mode === "agent" && (!!workspaceRoot || openTabs.some((tab) => tab.kind === "settings"));
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
          onRenameConversation={onRenameConversation}
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
          {/* In agent mode the workspace draws its own header (except on its
              start screen), so the page has a single top bar. */}
          {!agentHasOwnHeader && (
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
            {/* Full width: the chat name sits at the far left, actions at the far right. */}
            <div className="min-w-0 flex-1">
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
                  {mode === "chat" && (
                    <button
                      type="button"
                      onClick={() => {
                        setBrowserOpen((v) => !v);
                        setBrowserExpanded(false);
                      }}
                      aria-pressed={browserOpen}
                      title={t("browser.open")}
                      aria-label={t("browser.open")}
                      className={`rounded-md p-1.5 transition-colors ${
                        browserOpen
                          ? "bg-[var(--m-surface-3)] text-[var(--m-text)]"
                          : "text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
                      }`}
                    >
                      <GlobeIcon className="h-[18px] w-[18px]" />
                    </button>
                  )}
                </div>
              </div>

            </div>
          </header>
          )}

          {mode === "agent" ? (
            <AgentWorkspace
              sidebarOpen={sidebarOpen}
              onOpenSidebar={() => setSidebarOpen(true)}
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
              onModelSelect={onModelSelect}
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
              onOpenCommandPalette={() => setPaletteOpen(true)}
              paletteCommandsRef={agentPaletteCommandsRef}
            />
          ) : (
            <div ref={browserRowRef} className="flex min-h-0 flex-1 overflow-hidden">
            <div className={`flex min-w-0 flex-1 flex-col ${browserOpen && browserExpanded ? "hidden" : ""}`}>
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
                  {messages.map((message) => {
                    const switcher = versionSwitchers.get(message.id);
                    return (
                      <Message
                        key={message.id}
                        message={message}
                        disabled={isLoading}
                        onEdit={message.role === "user" ? (content) => onEditMessage(message.id, content) : undefined}
                        onRetry={message.role === "assistant" ? () => onRetryMessage(message.id) : undefined}
                        onRetryWith={
                          message.role === "assistant" ? (p, m) => onRetryMessage(message.id, { provider: p, model: m }) : undefined
                        }
                        currentProvider={provider}
                        currentModel={selectedModel}
                        onBranch={onBranchFromMessage && !message.isStreaming ? () => onBranchFromMessage(message.id) : undefined}
                        version={
                          switcher && onSwitchVersion
                            ? {
                                index: switcher.index,
                                total: switcher.total,
                                onSelect: (v) => onSwitchVersion(switcher.ownerId, v),
                              }
                            : undefined
                        }
                      />
                    );
                  })}
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
                    onStop={onStop}
                    onVoiceClick={onVoiceClick}
                    onSlashCommand={handleSlashCommand}
                    onModelSelect={onModelSelect}
                    onToggleSpeech={onToggleSpeech}
                    onToggleWakeWord={onToggleWakeWord}
                  />
                </div>
              </footer>
            </div>
            {browserOpen && !browserExpanded && (
              // A sibling of the aside, not inside it: the native page covers
              // the aside's interior and would take the pointer.
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t("browser.resize")}
                aria-valuemin={BROWSER_MIN_WIDTH}
                aria-valuenow={browserWidth ?? undefined}
                title={t("browser.resize")}
                tabIndex={0}
                onPointerDown={startBrowserResize}
                onDoubleClick={() => saveBrowserWidth(null)}
                onKeyDown={nudgeBrowserWidth}
                className="relative z-10 -me-px w-1 shrink-0 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-[var(--m-accent)]/70 focus-visible:after:bg-[var(--m-accent)] active:after:bg-[var(--m-accent)]"
              />
            )}
            {browserOpen && (
              <aside
                ref={browserAsideRef}
                className={
                  browserExpanded
                    ? "flex min-w-0 flex-1 flex-col"
                    : `flex min-w-[360px] flex-col border-s border-[var(--m-border)] ${browserWidth === null ? "w-1/2" : "shrink-0"}`
                }
                style={
                  browserExpanded || browserWidth === null
                    ? undefined
                    : { width: browserWidth, maxWidth: `calc(100% - ${BROWSER_MIN_WIDTH}px)` }
                }
              >
                <BrowserPanel
                  expanded={browserExpanded}
                  resizing={browserResizing}
                  onToggleExpand={() => setBrowserExpanded((v) => !v)}
                  onClose={() => {
                    setBrowserOpen(false);
                    setBrowserExpanded(false);
                  }}
                />
              </aside>
            )}
            </div>
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

      {/* App-wide command palette (⌘⇧P) */}
      {paletteOpen && (
        <CommandPalette commands={buildPaletteCommands()} onClose={() => setPaletteOpen(false)} />
      )}

      {languageOpen && <LanguageModal onClose={() => setLanguageOpen(false)} />}

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

