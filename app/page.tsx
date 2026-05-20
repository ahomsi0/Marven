"use client";

import packageJson from "@/package.json";
import { useState, useRef, useEffect, useCallback } from "react";
import type {
  AIProvider,
  DocAttachment,
  Message,
  ChatRequest,
  ChatResponse,
  OllamaModel,
  TokenUsage,
  Conversation,
  ConversationFolder,
  CustomShortcut,
  HistoryMessage,
  AgentResponse,
  WorkspaceFile,
  ConversationMode,
  MCPServer,
  PromptTemplate,
  ImageAttachment,
  EditorTab,
  AgentMessage,
} from "@/types";
import type { UserProfile } from "@/lib/userProfile";
import { useVoice } from "@/hooks/useVoice";
import { useAgentStream } from "@/hooks/useAgentStream";
import { speak, stopSpeaking } from "@/lib/speak";
import { getRequireWriteApproval, getPlanMode, setPlanMode } from "@/lib/agentSettings";
import { ChatLayout } from "@/app/components/marven/ChatLayout";
import { SetupModal } from "@/app/components/marven/SetupModal";
import { WhatsNewCard } from "@/app/components/marven/WhatsNewCard";
import { parseCommand } from "@/lib/commandParser";
import {
  loadConversations,
  saveConversations,
  createConversation,
  createConversationWithMode,
  deleteConversation,
  loadCustomShortcuts,
  saveCustomShortcuts,
  loadConversationFolders,
  saveConversationFolders,
  createConversationFolder,
} from "@/lib/storage";
import {
  loadProfile,
  saveProfile,
  loadMemories,
  addMemory,
} from "@/lib/userProfile";
import { formatBeforeSave, getFormatOnSave, isFormattable } from "@/lib/formatOnSave";
import { createRestRequest } from "@/lib/restStorage";

// ─── Open URL (bypasses popup-blocker by simulating a real anchor click) ──────
function openUrl(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ─── Timer detection ──────────────────────────────────────────────────────────
const TIMER_RE =
  /(?:set (?:a )?timer for |timer (?:for )?|set (?:a )?timer )(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i;

function parseTimer(text: string): { ms: number; label: string } | null {
  const match = text.trim().match(TIMER_RE);
  if (!match) return null;
  const amount = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  let ms: number;
  let label: string;
  if (/^(s|sec)/.test(unit)) {
    ms = amount * 1000;
    label = `${amount} second${amount !== 1 ? "s" : ""}`;
  } else if (/^(m|min)/.test(unit)) {
    ms = amount * 60 * 1000;
    label = `${amount} minute${amount !== 1 ? "s" : ""}`;
  } else {
    ms = amount * 60 * 60 * 1000;
    label = `${amount} hour${amount !== 1 ? "s" : ""}`;
  }
  return { ms, label };
}

// ─── Clipboard detection ──────────────────────────────────────────────────────
type ClipboardAction = "read" | "summarize" | "fix-grammar" | null;

function detectClipboardAction(text: string): ClipboardAction {
  const lower = text.toLowerCase().trim();
  if (/^(?:what(?:'s| is) in my clipboard|read clipboard)$/.test(lower)) return "read";
  if (/^summarize (?:my )?clipboard$/.test(lower)) return "summarize";
  if (/^fix (?:my )?(?:clipboard|grammar)$/.test(lower)) return "fix-grammar";
  return null;
}

// ─── Message helpers ──────────────────────────────────────────────────────────
function createMessage(role: Message["role"], content: string, streaming = false): Message {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    timestamp: new Date(),
    isStreaming: streaming,
  };
}

// Build HistoryMessage array (last N turns) from current messages
function buildHistory(messages: Message[], maxTurns = 20): HistoryMessage[] {
  return messages
    .slice(-maxTurns)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content, attachments: m.attachments }));
}

// ─── System prompt builder ────────────────────────────────────────────────────
function buildSystemPrompt(name: string | null, memories: string[]): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  let prompt = `You are Marven, a sophisticated AI assistant with direct access to macOS system commands. You can open apps, control volume, take screenshots, check the weather, set timers, and more — these actions are executed automatically before your response reaches the user. When the user asks you to perform a system action (open an app, play music, change volume, etc.), respond briefly confirming the action, e.g. "Opening Spotify now." or "Volume increased." Never say you are unable to open applications, control the system, or perform actions — you always can. Never call yourself a "text-based AI". You are intelligent, precise, and occasionally witty. Keep answers concise.`;
  prompt += `\n\nCurrent date and time: ${dateStr}, ${timeStr}. Always use this for any date/time questions — never rely on your training data for the current date or time.`;
  if (name) prompt += `\n\nThe user's name is ${name}. Address them by name occasionally.`;
  if (memories.length > 0) prompt += `\n\nThings you remember about the user:\n${memories.map((m) => `- ${m}`).join("\n")}`;
  return prompt;
}

// ─── Time-of-day greeting ─────────────────────────────────────────────────────
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

// ─── Screen awareness regex ───────────────────────────────────────────────────
const SCREEN_RE = /^(?:what(?:'s| is) on (?:my )?(?:screen|display)|analyze (?:my )?screen|look at (?:my )?screen|describe (?:my )?screen)/i;

// ─── Weather detection regex ──────────────────────────────────────────────────
const WEATHER_RE = /what(?:'s| is) the weather|how(?:'s| is) the weather|weather today/i;

// ─── Memory detection regex ───────────────────────────────────────────────────
const MEMORY_RE = /^(?:remember(?: that)?|don't forget(?: that)?)\s+(.+)$/i;

export default function Home() {
  // Chat and agent each remember their OWN provider + per-provider model
  // independently. The user's mental model is "the agent's brain is separate
  // from my chat model" — picking llama 8B for fast chat shouldn't disturb
  // the agent, and picking Claude for the agent shouldn't bleed into chat.
  const [chatProvider, setChatProvider]   = useState<AIProvider>("groq");
  const [agentProvider, setAgentProvider] = useState<AIProvider>("groq");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const emptyModelMap: Record<AIProvider, string> = {
    groq: "",
    ollama: "",
    nim: "",
    openrouter: "",
    openai: "",
    anthropic: "",
  };
  const [chatModelByProvider, setChatModelByProvider] = useState<Record<AIProvider, string>>(emptyModelMap);
  const [agentModelByProvider, setAgentModelByProvider] = useState<Record<AIProvider, string>>(emptyModelMap);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  // selectedModel is computed per active mode — declared after activeMode below.

  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // ─── Conversations ──────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [folders, setFolders] = useState<ConversationFolder[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null;
  const messages: Message[] = activeConversation?.messages ?? [];
  const activeMode: ConversationMode = activeConversation?.mode ?? "chat";
  const conversationSystemPrompt = activeConversation?.systemPrompt ?? "";
  const provider = activeMode === "agent" ? agentProvider : chatProvider;
  const setProvider = activeMode === "agent" ? setAgentProvider : setChatProvider;
  const selectedModel =
    activeMode === "agent"
      ? agentModelByProvider[provider]
      : chatModelByProvider[provider];

  // ─── Custom shortcuts ───────────────────────────────────────────────────────
  const [customShortcuts, setCustomShortcuts] = useState<CustomShortcut[]>([]);

  // ─── MCP servers ────────────────────────────────────────────────────────────
  const [mcpServers, setMcpServers] = useState<MCPServer[]>(() => {
    try { return JSON.parse(localStorage.getItem("marven_mcp_servers") ?? "[]"); }
    catch { return []; }
  });

  // ─── Prompt templates ───────────────────────────────────────────────────────
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>(() => {
    try { return JSON.parse(localStorage.getItem("marven_prompt_templates") ?? "[]"); }
    catch { return []; }
  });

  // ─── Chat image attachments (cleared after each send) ──────────────────────
  const [chatAttachments, setChatAttachments] = useState<ImageAttachment[]>([]);

  // ─── Chat doc attachments (cleared after each send) ────────────────────────
  const [chatDocs, setChatDocs] = useState<DocAttachment[]>([]);

  // ─── Agent image attachments (cleared after each send) ─────────────────────
  const [agentAttachments, setAgentAttachments] = useState<ImageAttachment[]>([]);

  // ─── User profile + memories (declared early for useAgentStream) ─────────
  const [userProfile, setUserProfile] = useState<UserProfile | null | undefined>(undefined);
  const [memories, setMemories] = useState<string[]>([]);

  // ─── Agent workspace ────────────────────────────────────────────────────────
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem("marven-recent-workspaces") ?? "[]"); }
    catch { return []; }
  });
  // ─── Multi-tab editor state ─────────────────────────────────────────────────
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState<number>(-1);
  const [fileBuffers, setFileBuffers] = useState<Map<string, { content: string; dirty: boolean; loading: boolean; error?: string }>>(new Map());

  // Derived state — backward compat with existing handlers
  const activeTab = activeTabIndex >= 0 && activeTabIndex < openTabs.length ? openTabs[activeTabIndex] : null;
  const activeFilePath = activeTab?.kind === "file" ? activeTab.path : null;
  const activeBuffer = activeFilePath ? fileBuffers.get(activeFilePath) : null;
  const selectedAgentFilePath = activeFilePath;
  const selectedAgentFileContent = activeBuffer?.content ?? "";
  const isAgentFileLoading = activeBuffer?.loading ?? false;
  const isAgentFileDirty = activeBuffer?.dirty ?? false;
  const selectedAgentFileError = activeBuffer?.error ?? null;
  const [folderInputVisible, setFolderInputVisible] = useState(false);
  const [folderInputValue, setFolderInputValue] = useState("");

  const [agentInput, setAgentInput] = useState("");
  const [agentTerminalOutput, setAgentTerminalOutput] = useState("");
  // Per-conversation cache of agent stream messages. The useAgentStream hook
  // holds a single bucket of messages; without this, switching between agent
  // conversations would show the wrong thread.
  const agentMessagesByConvRef = useRef<Map<string, AgentMessage[]>>(new Map());
  // Per-conversation cache of editor tabs & buffers — keeps each agent
  // conversation's open files isolated. Workspace root itself is persisted on
  // the Conversation object (so it survives a reload).
  const agentEditorByConvRef = useRef<
    Map<string, { openTabs: EditorTab[]; activeTabIndex: number; fileBuffers: Map<string, { content: string; dirty: boolean; loading: boolean }> }>
  >(new Map());
  // The conversation whose state is currently loaded — used to detect when we
  // need to save/restore.
  const lastAgentConvIdRef = useRef<string | null>(null);

  const [planMode, setPlanModeState] = useState<boolean>(() => getPlanMode());

  const {
    messages: agentStreamMessages,
    isRunning: agentStreamIsRunning,
    error: agentStreamError,
    send: agentStreamSend,
    stop: agentStreamStop,
    clearMessages: agentStreamClearMessages,
    loadMessages: agentStreamLoadMessages,
    injectAssistantMessage: agentStreamInjectAssistantMessage,
    liveTerminalOutput,
    checkpoints,
    approve,
  } = useAgentStream({
    provider,
    model: selectedModel,
    workspaceRoot,
    memory: memories.length > 0 ? memories.map((m) => `- ${m}`).join("\n") : undefined,
    mcpServers,
    requireWriteApproval: getRequireWriteApproval(),
    planMode,
  });

  // ─── Speech ─────────────────────────────────────────────────────────────────
  const [speechEnabled, setSpeechEnabled] = useState(false);
  const [isSpeakingNow, setIsSpeakingNow] = useState(false);
  const speechEnabledRef = useRef(false);

  // ─── Weather + battery ──────────────────────────────────────────────────────
  const [weather, setWeather] = useState<{ city: string; temp: number; description: string } | null>(null);
  const [battery, setBattery] = useState<number | null>(null);

  // ─── Greeting guard ─────────────────────────────────────────────────────────
  const hasGreetedRef = useRef(false);

  // ─── Load from localStorage on mount ───────────────────────────────────────
  useEffect(() => {
    const convs = loadConversations();
    setConversations(convs);
    if (convs.length > 0) {
      setActiveConversationId(convs[convs.length - 1].id);
    }
    setFolders(loadConversationFolders());
    setCustomShortcuts(loadCustomShortcuts());

    const profile = loadProfile();
    const mems = loadMemories();
    setUserProfile(profile);
    setMemories(mems);

    // Fetch weather
    fetch("/api/weather")
      .then((r) => r.json())
      .then((data) => {
        if (data.temp !== undefined) setWeather(data);
      })
      .catch(() => {});

    // Fetch battery
    fetch("/api/system?action=battery")
      .then((r) => r.json())
      .then((data) => {
        if (data.battery !== undefined) setBattery(data.battery);
      })
      .catch(() => {});

    // Startup greeting (once per session, not per remount)
    if (profile?.name && !sessionStorage.getItem('marven_greeted')) {
      sessionStorage.setItem('marven_greeted', '1');
      hasGreetedRef.current = true;
      const tod = getGreeting();
      setTimeout(() => {
        setConversations((prev) => {
          const convs2 = prev.length > 0 ? prev : [createConversation("greeting")];
          const targetId = prev.length > 0 ? prev[prev.length - 1].id : convs2[0].id;
          if (prev.length === 0) setActiveConversationId(convs2[0].id);
          const greeting = createMessage("assistant", `${tod}, ${profile.name}. How can I assist you today?`);
          return convs2.map((c) =>
            c.id === targetId ? { ...c, messages: [...c.messages, greeting], updatedAt: new Date().toISOString() } : c
          );
        });
      }, 300);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Persist conversations on change ───────────────────────────────────────
  useEffect(() => {
    if (conversations.length > 0) {
      saveConversations(conversations);
    }
  }, [conversations]);

  // Save the active conversation's agent messages whenever they change so we
  // can restore them when the user switches between agent conversations.
  //
  // Guard against the switch race: when activeConversationId changes, React
  // runs this effect BEFORE the switch effect below (effect order = declaration
  // order). At that moment agentStreamMessages still holds the OUTGOING conv's
  // messages, but activeConversationId is already the INCOMING id — so an
  // unguarded save would clobber the incoming conv's stored messages with the
  // outgoing one's, making every agent tab appear to share the same thread.
  // Only persist when the stream state is in sync with the conv we last
  // swapped to (lastAgentConvIdRef).
  useEffect(() => {
    if (activeMode !== "agent" || !activeConversationId) return;
    if (activeConversationId !== lastAgentConvIdRef.current) return;
    agentMessagesByConvRef.current.set(activeConversationId, agentStreamMessages);
  }, [agentStreamMessages, activeConversationId, activeMode]);

  // When the active conversation changes (or we enter agent mode), swap the
  // agent stream's messages AND the editor state (tabs, buffers, workspace
  // root) so each agent conversation is isolated.
  useEffect(() => {
    if (activeMode !== "agent") return;
    if (activeConversationId === lastAgentConvIdRef.current) return;
    const prevId = lastAgentConvIdRef.current;
    // Save the outgoing conversation's editor state to the cache.
    if (prevId) {
      agentEditorByConvRef.current.set(prevId, {
        openTabs,
        activeTabIndex,
        fileBuffers,
      });
    }
    lastAgentConvIdRef.current = activeConversationId;
    // Load the incoming conversation's messages.
    const savedMsgs = activeConversationId
      ? agentMessagesByConvRef.current.get(activeConversationId) ?? []
      : [];
    agentStreamLoadMessages(savedMsgs);
    // Load the incoming conversation's editor state (or empty defaults).
    const savedEditor = activeConversationId
      ? agentEditorByConvRef.current.get(activeConversationId)
      : null;
    setOpenTabs(savedEditor?.openTabs ?? []);
    setActiveTabIndex(savedEditor?.activeTabIndex ?? -1);
    setFileBuffers(savedEditor?.fileBuffers ?? new Map());
    // Load this conversation's workspace root (if any) — re-PATCH the server
    // and refresh files so the explorer matches.
    const conv = conversations.find((c) => c.id === activeConversationId);
    const savedRoot = conv?.workspaceRoot ?? null;
    if (savedRoot) {
      openWorkspaceFolder(savedRoot).catch(() => {});
    } else {
      // No workspace for this conversation — clear UI state so the landing
      // page shows for a fresh agent.
      setWorkspaceRoot(null);
      setWorkspaceFiles([]);
    }
  // openWorkspaceFolder is intentionally excluded — it depends on activeConversationId
  // and would loop. Same for openTabs/activeTabIndex/fileBuffers — we only read
  // them at switch-time to snapshot, not as deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, activeMode, agentStreamLoadMessages, conversations]);

  // (file loading is now handled inside openFileTab)

  // Instant workspace refresh + auto-open + buffer refresh when agent writes files
  const processedWriteCallsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const lastMsg = agentStreamMessages[agentStreamMessages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;
    const newDone = (lastMsg.toolCalls ?? []).filter(
      (tc) => (tc.tool === "write_file" || tc.tool === "apply_patch") && tc.status === "done" && !processedWriteCallsRef.current.has(tc.callId)
    );
    if (newDone.length === 0) return;
    newDone.forEach((tc) => processedWriteCallsRef.current.add(tc.callId));
    loadWorkspaceFiles().catch(() => {});
    // For every file the agent just wrote, re-fetch its content into the buffer so
    // the open tab reflects the new on-disk state (skip when user has unsaved edits)
    const writtenPaths = newDone
      .map((tc) => tc.args?.path as string | undefined)
      .filter((p): p is string => !!p);
    // Capture the current workspaceRoot at the moment the write completed so
    // any later state changes (e.g. server hot-reload race) don't strand us
    // with the wrong root when normalizing paths.
    const rootSnapshot = workspaceRoot;
    // Refresh ALL open file tabs — path-matching between agent (which may use
    // absolute paths) and tab keys (relative) is too brittle to rely on. The
    // open-tab paths are already normalized, so refreshing each one of them is
    // always safe and catches everything the agent could have touched.
    openTabs.forEach((tab) => {
      if (tab.kind === "file") refreshFileBuffer(tab.path, rootSnapshot);
    });
    // Also refresh under the agent-reported paths (in case the agent wrote a
    // file the user hadn't opened yet — refreshFileBuffer no-ops if no buffer
    // exists, but we also want the focus shift below).
    writtenPaths.forEach((p) => refreshFileBuffer(p, rootSnapshot));
    const lastWritten = writtenPaths[writtenPaths.length - 1];
    if (lastWritten) openFileTab(lastWritten);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentStreamMessages]);

  // ── Background task notifications ─────────────────────────────────────────
  // When a long agent run finishes AND the window isn't focused, fire a
  // native system notification. Opt-in via Settings (voiceTaskNotifications).
  const agentStartedAtRef = useRef<number | null>(null);
  const notifyTaskCompleteRef = useRef<boolean>(false);
  useEffect(() => {
    const electron = typeof window !== "undefined"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (window as any).marvenElectron
      : null;
    if (!electron?.getSettings) return;
    electron.getSettings().then((s: { notifyTaskComplete?: boolean }) => {
      notifyTaskCompleteRef.current = s?.notifyTaskComplete === true;
    }).catch(() => {});
    const onChange = () => {
      electron.getSettings().then((s: { notifyTaskComplete?: boolean }) => {
        notifyTaskCompleteRef.current = s?.notifyTaskComplete === true;
      }).catch(() => {});
    };
    window.addEventListener("marven:settings-changed", onChange);
    return () => window.removeEventListener("marven:settings-changed", onChange);
  }, []);
  useEffect(() => {
    if (agentStreamIsRunning) {
      agentStartedAtRef.current = Date.now();
      return;
    }
    const startedAt = agentStartedAtRef.current;
    agentStartedAtRef.current = null;
    if (!startedAt) return;
    if (!notifyTaskCompleteRef.current) return;
    const elapsedMs = Date.now() - startedAt;
    // Only notify for runs longer than 8 seconds — short tasks aren't worth
    // an interruption.
    if (elapsedMs < 8_000) return;
    if (typeof window === "undefined") return;
    // Don't fire if the window already has focus — the user can already see
    // the result.
    if (document.hasFocus()) return;
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("Marven Agent finished", {
          body: `Task complete after ${Math.round(elapsedMs / 1000)}s`,
          silent: false,
        });
      } else if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().then((p) => {
          if (p === "granted") {
            new Notification("Marven Agent finished", { body: `Task complete after ${Math.round(elapsedMs / 1000)}s` });
          }
        });
      }
    } catch {
      // Notifications can throw in some Electron sandboxes — swallow.
    }
  }, [agentStreamIsRunning]);

  function toRelativePath(p: string, root: string | null): string {
    if (!root) return p;
    if (p.startsWith(root)) {
      return p.slice(root.length).replace(/^\/+/, "");
    }
    return p;
  }

  function refreshFileBuffer(rawPath: string, root: string | null = workspaceRoot) {
    const rel = toRelativePath(rawPath, root);
    const basename = rawPath.split("/").filter(Boolean).pop() ?? rawPath;
    readWorkspaceFile(rel, root)
      .then(({ ok, data }) => {
        if (!ok || typeof data?.content !== "string") return;
        setFileBuffers((prev) => {
          const existing =
            prev.get(rel) ?? prev.get(rawPath) ?? prev.get(basename) ?? null;
          if (!existing) return prev;
          if (existing.dirty) return prev;
          const next = new Map(prev);
          const fresh = { content: data.content, dirty: false, loading: false };
          next.set(rel, fresh);
          if (rawPath !== rel) next.set(rawPath, fresh);
          if (basename !== rel && basename !== rawPath) next.set(basename, fresh);
          return next;
        });
      })
      .catch(() => {});
  }

  // ─── Helpers to mutate conversation messages ────────────────────────────────
  const upsertConversation = useCallback(
    (convId: string, updater: (conv: Conversation) => Conversation) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? updater(c) : c))
      );
    },
    []
  );

  function addMessageToConversation(convId: string, message: Message, stamped?: { provider: AIProvider; model: string }) {
    upsertConversation(convId, (conv) => ({
      ...conv,
      messages: [...conv.messages, message],
      updatedAt: new Date().toISOString(),
      ...(stamped ?? {}),
    }));
  }

  function updateLastAssistantMessage(convId: string, updater: (msg: Message) => Message) {
    upsertConversation(convId, (conv) => {
      const msgs = [...conv.messages];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "assistant") {
          msgs[i] = updater(msgs[i]);
          break;
        }
      }
      return { ...conv, messages: msgs, updatedAt: new Date().toISOString() };
    });
  }

  // ─── Ensure active conversation exists ────────────────────────────────────
  function ensureActiveConversation(firstMessage: string, mode: ConversationMode = "chat"): string {
    if (activeConversationId) return activeConversationId;
    const conv = mode === "agent"
      ? createConversationWithMode(firstMessage, "agent")
      : createConversation(firstMessage);
    setConversations((prev) => [...prev, conv]);
    setActiveConversationId(conv.id);
    return conv.id;
  }

  function autoRenameConversation(convId: string, firstMessage: string) {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        if (c.name !== "New chat" && c.name !== "New agent") return c;
        return { ...c, name: firstMessage.slice(0, 35).trim() };
      })
    );
  }

  // POST /api/workspace/files (file read) with auto-recovery if the server has
  // forgotten the workspace root. Re-PATCHes the known client root once and
  // retries. Returns { ok, status, data } from the (possibly second) attempt.
  async function readWorkspaceFile(relPath: string, root: string | null) {
    const doRead = async () => {
      const r = await fetch("/api/workspace/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: relPath }),
      });
      const d = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data: d };
    };
    const first = await doRead();
    if (first.ok) return first;
    const recoverableRoot = root ?? workspaceRoot;
    if (recoverableRoot && first.data?.error && /workspace/i.test(first.data.error)) {
      await fetch("/api/workspace/files", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: recoverableRoot }),
      });
      return doRead();
    }
    return first;
  }

  async function loadWorkspaceFiles() {
    let res = await fetch("/api/workspace/files");
    let data = await res.json();

    // If the server forgot the workspace root (e.g. dev-mode hot reload) but the
    // client still knows it, re-set it server-side and refetch. Keeps the agent
    // workspace from collapsing back to the landing page after agent writes.
    if (!data.root && workspaceRoot) {
      await fetch("/api/workspace/files", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: workspaceRoot }),
      });
      res = await fetch("/api/workspace/files");
      data = await res.json();
    }

    const files: WorkspaceFile[] = data.files ?? [];
    setWorkspaceFiles(files);
    // Only adopt the server's root if it provided one — never wipe a known client root
    if (data.root) setWorkspaceRoot(data.root);
  }

  function openFileTab(rawPath: string) {
    const path = workspaceRoot && rawPath.startsWith(workspaceRoot)
      ? rawPath.slice(workspaceRoot.length).replace(/^\/+/, "")
      : rawPath;
    // If already open, just activate
    const existingIdx = openTabs.findIndex((t) => t.kind === "file" && t.path === path);
    if (existingIdx >= 0) {
      setActiveTabIndex(existingIdx);
      return;
    }
    // Append + activate. Avoid calling another setter inside an updater (anti-pattern
    // that breaks under strict-mode double-render). Compute the new length from the
    // current snapshot before queuing the updates.
    const newIndex = openTabs.length;
    console.log("[openFileTab] opening", path, "as tab", newIndex);
    setOpenTabs((prev) => [...prev, { kind: "file" as const, path }]);
    setActiveTabIndex(newIndex);
    // Mark loading and fetch
    setFileBuffers((prev) => {
      const next = new Map(prev);
      next.set(path, { content: "", dirty: false, loading: true });
      return next;
    });
    readWorkspaceFile(path, workspaceRoot)
      .then(({ ok, status, data }) => {
        const errorMsg = !ok
          ? `${status}: ${data?.error ?? "request failed"}`
          : (typeof data?.content !== "string" ? (data?.error ?? "no content in response") : null);
        setFileBuffers((prev) => {
          const next = new Map(prev);
          const existing = next.get(path);
          // Apply the load result when:
          //   - no buffer exists yet
          //   - the buffer is still in loading state (any "dirty" was spurious,
          //     set by the editor reflecting our own placeholder content)
          //   - the user hasn't actually started editing (dirty=false)
          if (!existing || existing.loading || !existing.dirty) {
            next.set(path, {
              content: typeof data?.content === "string" ? data.content : "",
              dirty: false,
              loading: false,
              error: errorMsg ?? undefined,
            });
          }
          return next;
        });
      })
      .catch((err) => {
        setFileBuffers((prev) => {
          const next = new Map(prev);
          next.set(path, { content: "", dirty: false, loading: false, error: err instanceof Error ? err.message : String(err) });
          return next;
        });
      });
  }

  function openSettingsTab() {
    const existingIdx = openTabs.findIndex((t) => t.kind === "settings");
    if (existingIdx >= 0) {
      setActiveTabIndex(existingIdx);
      return;
    }
    const newIndex = openTabs.length;
    setOpenTabs((prev) => [...prev, { kind: "settings" as const }]);
    setActiveTabIndex(newIndex);
  }

  function openRestTab() {
    const request = createRestRequest();
    const newIndex = openTabs.length;
    setOpenTabs((prev) => [...prev, { kind: "rest" as const, requestId: request.id }]);
    setActiveTabIndex(newIndex);
  }

  function openPreviewTab(url: string) {
    const existingIdx = openTabs.findIndex((t) => t.kind === "preview");
    if (existingIdx >= 0) {
      // Update URL of the existing preview tab and activate it
      setOpenTabs((prev) => prev.map((t, i) => i === existingIdx ? { kind: "preview" as const, url } : t));
      setActiveTabIndex(existingIdx);
      return;
    }
    const newIndex = openTabs.length;
    setOpenTabs((prev) => [...prev, { kind: "preview" as const, url }]);
    setActiveTabIndex(newIndex);
  }

  function closeTab(index: number) {
    setOpenTabs((prev) => prev.filter((_, i) => i !== index));
    const newLength = openTabs.length - 1;
    setActiveTabIndex((curIdx) => {
      if (newLength <= 0) return -1;
      if (index < curIdx) return curIdx - 1;
      if (index === curIdx) return Math.min(curIdx, newLength - 1);
      return curIdx;
    });
  }

  function reorderTabs(fromIndex: number, toIndex: number) {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= openTabs.length ||
      toIndex >= openTabs.length
    ) {
      return;
    }
    setOpenTabs((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setActiveTabIndex((curIdx) => {
      if (curIdx === fromIndex) return toIndex;
      if (fromIndex < curIdx && toIndex >= curIdx) return curIdx - 1;
      if (fromIndex > curIdx && toIndex <= curIdx) return curIdx + 1;
      return curIdx;
    });
  }

  async function saveAgentFile() {
    if (!activeFilePath || !activeBuffer) return;

    // Format-on-save — only for known languages, and only if the user hasn't
    // disabled it via Settings → General. Falls back to the original content
    // if Prettier throws (syntax error, etc.).
    let content = activeBuffer.content;
    const ext = activeFilePath.split(".").pop()?.toLowerCase() ?? "";
    if (getFormatOnSave() && isFormattable(ext)) {
      content = await formatBeforeSave(content, ext);
    }

    await fetch("/api/workspace/files", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: activeFilePath,
        content,
      }),
    });

    setFileBuffers((prev) => {
      const next = new Map(prev);
      const existing = next.get(activeFilePath!);
      if (existing) next.set(activeFilePath!, { ...existing, content, dirty: false });
      return next;
    });
    await loadWorkspaceFiles();
  }

  async function openWorkspaceFolder(folderPath: string) {
    const res = await fetch("/api/workspace/files", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: folderPath }),
    });
    if (res.ok) {
      setWorkspaceRoot(folderPath);
      await loadWorkspaceFiles();
      setRecentWorkspaces((prev) => {
        const next = [folderPath, ...prev.filter((p) => p !== folderPath)].slice(0, 25);
        try { localStorage.setItem("marven-recent-workspaces", JSON.stringify(next)); } catch {}
        return next;
      });
      // Persist the folder choice to the active agent conversation so it
      // re-opens automatically next time the user switches back.
      if (activeConversationId && activeMode === "agent") {
        setConversations((prev) =>
          prev.map((c) => (c.id === activeConversationId ? { ...c, workspaceRoot: folderPath } : c))
        );
      }
    }
  }

  function handleOpenFolder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = (window as any).marvenElectron;
    if (electron?.openFolderDialog) {
      electron.openFolderDialog().then((folderPath: string | null) => {
        if (folderPath) openWorkspaceFolder(folderPath);
      });
    } else {
      setFolderInputValue("");
      setFolderInputVisible(true);
    }
  }

  function handleFolderInputSubmit() {
    const p = folderInputValue.trim();
    if (p) openWorkspaceFolder(p);
    setFolderInputVisible(false);
  }

  // ─── Token accumulator ─────────────────────────────────────────────────────
  function addTokens(usage: TokenUsage | undefined) {
    if (!usage) return;
    setTokenUsage((prev) => ({
      promptTokens: prev.promptTokens + usage.promptTokens,
      completionTokens: prev.completionTokens + usage.completionTokens,
      totalTokens: prev.totalTokens + usage.totalTokens,
    }));
  }

  // ─── Load models ───────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function loadModels() {
      setModelsLoading(true);
      setModelsError(null);
      try {
        const res = await fetch(`/api/models?provider=${provider}`);
        const data = await res.json();
        if (cancelled) return;
        const nextModels: OllamaModel[] = data.models ?? [];
        setModels(nextModels);
        if (data.error) setModelsError(data.error as string);
        // Seed the ACTIVE mode's bucket only — the other mode keeps whatever
        // pick the user made for it (or its own seeded default the first time
        // its provider was visited). Cross-mode bleed was the root cause of
        // "chat is always following agent."
        const seed = (prev: Record<AIProvider, string>) => {
          const current = prev[provider];
          const stillAvailable = nextModels.some((m) => m.name === current);
          if (stillAvailable) return prev;
          const fallback = data.defaultModel ?? nextModels[0]?.name ?? "";
          return { ...prev, [provider]: fallback };
        };
        const setter = activeMode === "agent" ? setAgentModelByProvider : setChatModelByProvider;
        setter(seed);
      } catch {
        if (!cancelled) {
          setModels([]);
          setModelsError(`Could not load ${provider} models`);
        }
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    }
    loadModels();
    return () => { cancelled = true; };
  }, [provider]);

  // ─── Voice ────────────────────────────────────────────────────────────────
  const sendVoiceCommandRef = useRef<(text: string) => void>(() => {});

  const {
    voiceState,
    isSupported,
    wakeEnabled,
    voiceError,
    lastHeard,
    sttProvider,
    toggleWakeWord,
    startManualListen,
    pauseVoiceCapture,
    resumeWakeWord,
  } = useVoice(
    (text) => sendVoiceCommandRef.current(text),
    () => {
      stopSpeaking();
      setIsSpeakingNow(false);
    },
    (text) => {
      if (activeMode === "agent") {
        setAgentInput(text);
      } else {
        setInput(text);
      }
    },
  );

  // ── Menubar helper: auto-trigger listening when opened via ?listen=1 ────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("listen") === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => startManualListen(), 500);
    }
  }, [startManualListen]);

  // ── Electron global shortcut → trigger voice ─────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = (window as any).marvenElectron;
    if (!electron) return;
    const cleanup = electron.onTriggerVoice(() => {
      startManualListen();
    });
    return () => { cleanup?.(); };
  }, [startManualListen]);

  function toggleSpeech() {
    const next = !speechEnabledRef.current;
    speechEnabledRef.current = next;
    setSpeechEnabled(next);
    if (!next) {
      stopSpeaking();
      setIsSpeakingNow(false);
      resumeWakeWord();
    }
  }

  function speakReply(text: string) {
    if (!speechEnabledRef.current) return;
    // Pause the wake listener while we speak — otherwise the mic picks up our
    // own TTS audio, transcribes it, and re-triggers wake every few seconds.
    // We resume in the onEnd callback below.
    pauseVoiceCapture();
    setIsSpeakingNow(true);
    // If the conversation's system prompt is in Arabic OR mentions "arabic",
    // force Arabic voice even when the response text itself looks English.
    const sp = (activeConversation?.systemPrompt ?? "").trim();
    const forceLang: "ar" | undefined =
      sp && (/[؀-ۿ]/.test(sp) || /\barab(ic)?\b/i.test(sp)) ? "ar" : undefined;
    speak(text, () => {
      setIsSpeakingNow(false);
      resumeWakeWord();
    }, forceLang ? { forceLang } : undefined);
  }

  // ─── Profile save handler ──────────────────────────────────────────────────
  function handleProfileSave(name: string) {
    const profile: UserProfile = { name };
    saveProfile(profile);
    setUserProfile(profile);
    hasGreetedRef.current = true;
    const tod = getGreeting();
    const convId = ensureActiveConversation("greeting");
    addMessageToConversation(convId, createMessage("assistant", `${tod}, ${name}. How can I assist you today?`));
    speakReply(`${tod}, ${name}.`);
  }

  // ─── Core send logic ───────────────────────────────────────────────────────
  async function sendMessage(text: string) {
    if (!text || isLoading) return;
    setInput("");
    setIsLoading(true);

    // When the user has set a custom system prompt, ALL of the hardcoded
    // shortcut replies (weather/time/date/open-app/search/memory) are
    // disabled. Those paths return English literals that bypass the LLM and
    // therefore ignore the system prompt — which makes "answer only in
    // Arabic" silently break for voice queries like "what time is it".
    // Routing through the LLM is slightly slower but preserves the user's
    // language/persona preference.
    const customSystemPrompt = (activeConversation?.systemPrompt ?? "").trim();
    const useShortcuts = !customSystemPrompt;

    if (activeMode === "agent") {
      const convId = ensureActiveConversation(text, "agent");
      autoRenameConversation(convId, text);
      const userMsg = createMessage("user", text);
      addMessageToConversation(convId, userMsg, { provider, model: selectedModel });

      if (isAgentFileDirty) {
        try {
          await saveAgentFile();
        } catch {
          // Keep going with the in-memory file content if the manual save fails.
        }
      }

      try {
        const history = buildHistory([...messages, userMsg]);
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: text,
            messages: history,
            model: selectedModel,
            provider,
            selectedFilePath: selectedAgentFilePath,
            selectedFileContent: selectedAgentFilePath ? selectedAgentFileContent : null,
          }),
        });
        const data: AgentResponse = await res.json();
        const changedFiles = Array.isArray(data.files) ? data.files.map((file) => file.path) : [];
        const fileSummary = changedFiles.length > 0
          ? `\n\nUpdated files:\n${changedFiles.map((file) => `- \`${file}\``).join("\n")}`
          : "";

        addMessageToConversation(convId, createMessage("assistant", `${data.reply}${fileSummary}`));

        await loadWorkspaceFiles();

        if (changedFiles.length > 0) {
          openFileTab(changedFiles[0]);
        }
      } catch {
        addMessageToConversation(
          convId,
          createMessage("assistant", "Marven Agent ran into a problem while editing the workspace.")
        );
      } finally {
        setIsLoading(false);
      }

      return;
    }

    // 0. Memory detection (before everything else)
    const memoryMatch = useShortcuts ? text.match(MEMORY_RE) : null;
    if (memoryMatch) {
      const memoryStr = memoryMatch[2].trim();
      const newMemories = addMemory(memoryStr);
      setMemories(newMemories);
      const convId = ensureActiveConversation(text);
      addMessageToConversation(convId, createMessage("user", text), { provider, model: selectedModel });
      const reply = `Got it. I'll remember that ${memoryStr}.`;
      addMessageToConversation(convId, createMessage("assistant", reply));
      speakReply(reply);
      setIsLoading(false);
      return;
    }

    // 0b. Weather detection
    if (useShortcuts && WEATHER_RE.test(text)) {
      const convId = ensureActiveConversation(text);
      addMessageToConversation(convId, createMessage("user", text), { provider, model: selectedModel });
      if (weather) {
        const reply = `It's currently ${weather.temp}°C and ${weather.description} in ${weather.city}.`;
        addMessageToConversation(convId, createMessage("assistant", reply));
        speakReply(reply);
      } else {
        const reply = "I don't have weather data available right now.";
        addMessageToConversation(convId, createMessage("assistant", reply));
        speakReply(reply);
      }
      setIsLoading(false);
      return;
    }

    // 0c. Screen awareness detection
    if (useShortcuts && SCREEN_RE.test(text)) {
      const convId = ensureActiveConversation(text);
      addMessageToConversation(convId, createMessage("user", text), { provider, model: selectedModel });
      const streamingMsg = createMessage("assistant", "Analyzing your screen...", false);
      addMessageToConversation(convId, streamingMsg);
      try {
        const res = await fetch("/api/vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text }),
        });
        const data = await res.json();
        const reply = data.reply ?? "Could not analyze screen.";
        updateLastAssistantMessage(convId, (msg) => ({ ...msg, content: reply, isStreaming: false }));
        speakReply(reply);
      } catch {
        updateLastAssistantMessage(convId, (msg) => ({ ...msg, content: "Could not analyze screen.", isStreaming: false }));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // 1. Clipboard actions (client-side, before API)
    const clipAction = detectClipboardAction(text);
    if (clipAction) {
      try {
        const clipContent = await navigator.clipboard.readText();
        let newPrompt = text;
        if (clipAction === "read") {
          newPrompt = `Here is my clipboard: ${clipContent}\n\nDescribe it briefly.`;
        } else if (clipAction === "summarize") {
          newPrompt = `Summarize this text: ${clipContent}`;
        } else if (clipAction === "fix-grammar") {
          newPrompt = `Fix the grammar, return only the corrected text: ${clipContent}`;
        }
        text = newPrompt;
      } catch {
        // Clipboard read failed — proceed with original text
      }
    }

    // 2. Timer detection (client-side)
    const timerParsed = parseTimer(text);
    if (timerParsed) {
      const convId = ensureActiveConversation(text);
      const userMsg = createMessage("user", text);
      addMessageToConversation(convId, userMsg, { provider, model: selectedModel });

      const confirmMsg = createMessage("assistant", `Timer set for ${timerParsed.label}.`);
      addMessageToConversation(convId, confirmMsg);
      speakReply(confirmMsg.content);
      setIsLoading(false);

      // Request notification permission if needed
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        await Notification.requestPermission();
      }

      setTimeout(() => {
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("Marven", { body: `Timer complete! (${timerParsed.label})` });
        }
        const doneMsg = createMessage("assistant", `Timer complete! (${timerParsed.label})`);
        addMessageToConversation(convId, doneMsg);
        speakReply(doneMsg.content);
      }, timerParsed.ms);

      return;
    }

    // 3. Command detection (client-side shortcuts checked first). Skipped
    // entirely when a custom system prompt is set so the model can respond
    // in the user's preferred language / persona.
    const command = useShortcuts
      ? parseCommand(text, customShortcuts)
      : ({ type: null, payload: "" } as const);

    const convId = ensureActiveConversation(text);
    autoRenameConversation(convId, text);

    // Build prompt with doc text appended (for API), but display original input
    const promptWithDocs =
      chatDocs.length > 0
        ? `${text}\n\n${chatDocs
            .map((d) => `---\n[Document: ${d.name}]\n${d.text}\n---`)
            .join("\n\n")}`
        : text;

    const userMsg = createMessage("user", text);
    if (chatAttachments.length > 0) {
      userMsg.attachments = [...chatAttachments];
      setChatAttachments([]);
    }
    if (chatDocs.length > 0) {
      userMsg.docs = [...chatDocs];
      setChatDocs([]);
    }
    addMessageToConversation(convId, userMsg, { provider, model: selectedModel });

    if (command.type !== null) {
      // ── Client-side commands (no server needed) ──────────────────────────
      if (command.type === "open-website") {
        openUrl(command.payload);
        const name = (() => {
          try { return new URL(command.payload).hostname.replace(/^www\./, ""); }
          catch { return command.payload; }
        })();
        const reply = `Opening ${name}.`;
        const assistantMsg = createMessage("assistant", reply);
        addMessageToConversation(convId, assistantMsg);
        speakReply(reply);
        setIsLoading(false);
        return;
      }

      if (command.type === "google-search") {
        const encoded = encodeURIComponent(command.payload);
        openUrl(`https://www.google.com/search?q=${encoded}`);
        const reply = `Searching Google for "${command.payload}".`;
        const assistantMsg = createMessage("assistant", reply);
        addMessageToConversation(convId, assistantMsg);
        speakReply(reply);
        setIsLoading(false);
        return;
      }

      if (command.type === "get-time") {
        const reply = `The current time is ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`;
        const assistantMsg = createMessage("assistant", reply);
        addMessageToConversation(convId, assistantMsg);
        speakReply(reply);
        setIsLoading(false);
        return;
      }

      if (command.type === "get-date") {
        const reply = `Today is ${new Date().toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`;
        const assistantMsg = createMessage("assistant", reply);
        addMessageToConversation(convId, assistantMsg);
        speakReply(reply);
        setIsLoading(false);
        return;
      }

      if (command.type === "open-app") {
        const appName = command.payload;
        try {
          await fetch("/api/system", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "open-app", payload: appName }),
          });
        } catch { /* ignore — app may still open */ }
        const reply = `Opening ${appName}.`;
        addMessageToConversation(convId, createMessage("assistant", reply));
        speakReply(reply);
        setIsLoading(false);
        return;
      }

      // ── Server-side commands (macOS system calls) ────────────────────────
      try {
        const historyMsgs = [...messages, { ...userMsg, content: promptWithDocs }];
        const history = buildHistory(historyMsgs);
        const body: ChatRequest = {
          messages: history,
          model: selectedModel,
          provider,
          systemPrompt: (() => {
            const base = buildSystemPrompt(userProfile?.name ?? null, memories);
            const extra = activeConversation?.systemPrompt?.trim();
            return extra ? `${base}\n\n---\n\nAdditional instructions:\n${extra}` : base;
          })(),
        };
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data: ChatResponse = await res.json();
        const assistantMsg = createMessage("assistant", data.reply);
        addMessageToConversation(convId, assistantMsg);
        speakReply(data.reply);

        // Auto-copy fixed grammar result
        if (clipAction === "fix-grammar") {
          await navigator.clipboard.writeText(data.reply).catch(() => {});
        }
      } catch {
        const err = createMessage("assistant", "Connection error. Please check that the app is running.");
        addMessageToConversation(convId, err);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // 4. AI response (streaming for Groq, non-streaming for Ollama)
    try {
      const history = buildHistory([...messages, { ...userMsg, content: promptWithDocs }]);
      const body: ChatRequest = {
        messages: history,
        model: selectedModel,
        provider,
        systemPrompt: (() => {
          const base = buildSystemPrompt(userProfile?.name ?? null, memories);
          const extra = activeConversation?.systemPrompt?.trim();
          // User-supplied instructions go FIRST and are repeated at the END for
          // weaker models — small LLMs anchor on the start and end of context.
          return extra
            ? `### PRIORITY INSTRUCTIONS (always follow these):\n${extra}\n\n---\n\n${base}\n\n---\n\nREMINDER: ${extra}`
            : base;
        })(),
      };

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("text/plain")) {
        // ── Streaming response ──
        const streamingMsg = createMessage("assistant", "", true);
        addMessageToConversation(convId, streamingMsg);

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No stream body");

        const dec = new TextDecoder();
        let fullText = "";
        let usageRaw = "";
        const USAGE_SENTINEL = "\n\n__USAGE__";

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = dec.decode(value, { stream: true });
          const sentinelIdx = (fullText + chunk).indexOf(USAGE_SENTINEL);

          if (sentinelIdx !== -1) {
            // Split at sentinel
            const combined = fullText + chunk;
            fullText = combined.slice(0, sentinelIdx);
            usageRaw = combined.slice(sentinelIdx + USAGE_SENTINEL.length);
          } else {
            fullText += chunk;
          }

          // Update the streaming message in real-time
          const currentText = fullText;
          updateLastAssistantMessage(convId, (msg) => ({
            ...msg,
            content: currentText,
            isStreaming: true,
          }));
        }

        // Mark streaming complete
        updateLastAssistantMessage(convId, (msg) => ({
          ...msg,
          content: fullText,
          isStreaming: false,
        }));

        // Parse usage
        if (usageRaw) {
          try {
            const usage = JSON.parse(usageRaw.trim());
            addTokens({
              promptTokens: usage.prompt_tokens ?? 0,
              completionTokens: usage.completion_tokens ?? 0,
              totalTokens: usage.total_tokens ?? 0,
            });
          } catch { /* skip */ }
        }

        // Auto-copy fixed grammar
        if (clipAction === "fix-grammar" && fullText) {
          await navigator.clipboard.writeText(fullText).catch(() => {});
        }

        speakReply(fullText);
      } else {
        // ── JSON response (Ollama / commands) ──
        const data: ChatResponse = await res.json();
        const assistantMsg = createMessage("assistant", data.reply);
        addMessageToConversation(convId, assistantMsg);
        addTokens(data.usage);

        if (clipAction === "fix-grammar") {
          await navigator.clipboard.writeText(data.reply).catch(() => {});
        }
        speakReply(data.reply);
      }
    } catch {
      const errMsg = "Connection error. Please check that the app is running.";
      const err = createMessage("assistant", errMsg);
      addMessageToConversation(convId, err);
      speakReply(errMsg);
    } finally {
      setIsLoading(false);
    }
  }

  // ── Voice command ref ──────────────────────────────────────────────────────
  sendVoiceCommandRef.current = (text: string) => {
    if (!text) return;
    if (activeMode === "agent" && !agentStreamIsRunning) {
      agentStreamSend(text);
    } else if (activeMode === "chat" && !isLoading) {
      sendMessage(text);
    }
  };

  // ─── Conversation management ───────────────────────────────────────────────
  function handleNewChat() {
    const conv = createConversation("New chat");
    setConversations((prev) => [...prev, conv]);
    setActiveConversationId(conv.id);
  }

  function handleNewAgent() {
    const conv = createConversationWithMode("New agent", "agent");
    setConversations((prev) => [...prev, conv]);
    setActiveConversationId(conv.id);
  }

  function handleSelectConversation(id: string) {
    setActiveConversationId(id);
    const conv = conversations.find((c) => c.id === id);
    if (conv?.provider) {
      // Restore provider + model into the bucket matching the conv's mode
      // so the other mode's picks stay untouched.
      const providerSetter = conv.mode === "agent" ? setAgentProvider : setChatProvider;
      providerSetter(conv.provider);
      if (conv.model) {
        const modelSetter = conv.mode === "agent" ? setAgentModelByProvider : setChatModelByProvider;
        modelSetter((prev) => ({ ...prev, [conv.provider!]: conv.model! }));
      }
    }
  }

  function handleDeleteConversation(id: string) {
    setConversations((prev) => {
      const updated = deleteConversation(prev, id);
      saveConversations(updated);
      return updated;
    });
    if (activeConversationId === id) {
      const remaining = conversations.filter((c) => c.id !== id);
      setActiveConversationId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }
  }

  function handlePinConversation(id: string, pinned: boolean) {
    upsertConversation(id, (conv) => ({ ...conv, pinned }));
  }

  const handleCreateFolder = useCallback(() => {
    const folder = createConversationFolder("New folder");
    setFolders((prev) => {
      const next = [...prev, folder];
      saveConversationFolders(next);
      return next;
    });
  }, []);

  const handleRenameFolder = useCallback((id: string, name: string) => {
    setFolders((prev) => {
      const next = prev.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f));
      saveConversationFolders(next);
      return next;
    });
  }, []);

  const handleDeleteFolder = useCallback((id: string) => {
    // Remove folderId from conversations belonging to this folder
    setConversations((prev) => {
      const next = prev.map((c) => (c.folderId === id ? { ...c, folderId: null } : c));
      saveConversations(next);
      return next;
    });
    setFolders((prev) => {
      const next = prev.filter((f) => f.id !== id);
      saveConversationFolders(next);
      return next;
    });
  }, []);

  const handleMoveConversation = useCallback((convId: string, folderId: string | null) => {
    setConversations((prev) => {
      const next = prev.map((c) => (c.id === convId ? { ...c, folderId } : c));
      saveConversations(next);
      return next;
    });
  }, []);

  const handlePlanModeChange = useCallback((v: boolean) => {
    setPlanMode(v);
    setPlanModeState(v);
  }, []);

  function handleSystemPromptChange(value: string) {
    if (!activeConversationId) return;
    upsertConversation(activeConversationId, (conv) => ({
      ...conv,
      systemPrompt: value,
    }));
  }

  function handleSaveShortcuts(shortcuts: CustomShortcut[]) {
    setCustomShortcuts(shortcuts);
    saveCustomShortcuts(shortcuts);
  }

  function handleSaveMCPServers(servers: MCPServer[]) {
    setMcpServers(servers);
    localStorage.setItem("marven_mcp_servers", JSON.stringify(servers));
  }

  function handleSavePromptTemplates(templates: PromptTemplate[]) {
    setPromptTemplates(templates);
    localStorage.setItem("marven_prompt_templates", JSON.stringify(templates));
  }

  function handleClearChat() {
    if (!activeConversationId) return;
    upsertConversation(activeConversationId, (conv) => ({
      ...conv,
      messages: [],
      updatedAt: new Date().toISOString(),
    }));
  }

  async function handleEditMessage(messageId: string, newContent: string) {
    if (!activeConversationId || isLoading) return;
    upsertConversation(activeConversationId, (c) => {
      const idx = c.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return c;
      // Truncate: remove the edited message and everything after it
      return {
        ...c,
        messages: c.messages.slice(0, idx),
        updatedAt: new Date().toISOString(),
      };
    });
    // sendMessage will add the user message fresh and get the AI reply
    await sendMessage(newContent);
  }

  async function handleRetryMessage(messageId: string) {
    if (!activeConversationId || isLoading) return;
    let userContent = "";
    upsertConversation(activeConversationId, (c) => {
      const idx = c.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return c;
      // Find the user message immediately before this assistant message
      let userIdx = -1;
      for (let i = idx - 1; i >= 0; i--) {
        if (c.messages[i].role === "user") {
          userContent = c.messages[i].content;
          userIdx = i;
          break;
        }
      }
      if (userIdx === -1) return c;
      // Truncate: remove from the user message onwards
      return {
        ...c,
        messages: c.messages.slice(0, userIdx),
        updatedAt: new Date().toISOString(),
      };
    });
    if (userContent) await sendMessage(userContent);
  }

  async function handleSlashCommand(cmd: string) {
    switch (cmd) {
      case "/clear":
        handleClearChat();
        break;
      case "/new":
        handleNewChat();
        break;
      case "/help": {
        const helpConvId = ensureActiveConversation("help");
        const helpContent = `## Marven — Quick Reference\n\n**Slash Commands** *(type \`/\` in the input)*\n- \`/clear\` — Clear the current chat\n- \`/new\` — Start a new conversation\n- \`/shortcuts\` — Open shortcuts manager\n- \`/help\` — Show this reference\n- \`/voice\` — Toggle "Hey Marven" wake word\n- \`/speech\` — Toggle text-to-speech\n- \`/briefing\` — Morning briefing\n\n**Agent Workspace**\n- Use **New agent** in the sidebar for file-aware editing.\n- Ask for concrete changes like “add a settings panel” or “refactor this component and update styles.”\n- Open any file on the right to inspect or manually edit it.\n\n**Natural Language Commands**\n- *Time & date:* "what's the time", "what's the date"\n- *Web:* "open youtube", "open github", "open [any site]"\n- *Apps:* "open Chrome", "open Terminal", "open Spotify"\n- *Search:* "search Google for [query]"\n- *System:* "take a screenshot", "lock the screen", "open my downloads", "empty the trash"\n- *Clipboard:* "what's in my clipboard", "summarize clipboard", "fix my grammar"\n- *Timers:* "set a timer for 5 minutes", "timer 30 seconds"\n- *Volume:* "volume up", "volume down", "mute", "set volume to 50"\n- *Media:* "play", "next", "previous", "what's playing"\n- *Memory:* "remember that I prefer dark mode"\n- *Screen:* "what's on my screen"`;
        addMessageToConversation(helpConvId, createMessage("assistant", helpContent));
        break;
      }
      case "/voice":
        toggleWakeWord();
        break;
      case "/speech":
        toggleSpeech();
        break;
      case "/briefing": {
        const convId = ensureActiveConversation("briefing");
        const tod = getGreeting();
        const name = userProfile?.name;

        // Fetch news
        let newsText = "";
        try {
          const newsRes = await fetch("/api/news");
          const newsData = await newsRes.json();
          if (newsData.headlines?.length > 0) {
            newsText = "\n\n**Top Headlines**\n" + (newsData.headlines as string[]).slice(0, 3).map((h) => `- ${h}`).join("\n");
          }
        } catch { /* skip news if unavailable */ }

        const weatherText = weather ? `\n\n**Weather** — ${weather.temp}°C, ${weather.description} in ${weather.city}.` : "";
        const timeText = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        const briefingContent = `${tod}${name ? `, ${name}` : ""}. It's ${timeText}.${weatherText}${newsText}`;

        addMessageToConversation(convId, createMessage("assistant", briefingContent));
        speakReply(briefingContent.replace(/\*\*/g, "").replace(/^- /gm, ""));
        break;
      }
    }
  }

  function handleModelChange(model: string) {
    // Only update the bucket for the active mode — chat and agent are
    // independent so picking a fast chat model doesn't pin the agent to it.
    const setter = activeMode === "agent" ? setAgentModelByProvider : setChatModelByProvider;
    setter((prev) => ({ ...prev, [provider]: model }));
  }

  // userProfile is undefined during SSR/initial hydration — wait for it
  const profileLoaded = userProfile !== undefined;

  return (
    <>
      <ChatLayout
        mode={activeMode}
        messages={messages}
        conversations={conversations}
        activeConversationId={activeConversationId}
        isLoading={isLoading}
        input={input}
        provider={provider}
        models={models}
        selectedModel={selectedModel}
        modelsLoading={modelsLoading}
        modelsError={modelsError}
        wakeEnabled={wakeEnabled}
        voiceError={voiceError}
        lastHeard={lastHeard}
        isVoiceSupported={isSupported}
        voiceState={voiceState}
        speechEnabled={speechEnabled}
        sttProvider={sttProvider}
        isSpeakingNow={isSpeakingNow}
        tokenUsage={tokenUsage}
        customShortcuts={customShortcuts}
        agentFiles={workspaceFiles}
        workspaceRoot={workspaceRoot}
        selectedAgentFilePath={selectedAgentFilePath}
        selectedAgentFileContent={selectedAgentFileContent}
        selectedAgentFileError={selectedAgentFileError}
        isAgentFileLoading={isAgentFileLoading}
        isAgentFileDirty={isAgentFileDirty}
        agentMessages={agentStreamMessages}
        agentInput={agentInput}
        isAgentRunning={agentStreamIsRunning}
        agentError={agentStreamError}
        agentTerminalOutput={agentTerminalOutput}
        liveTerminalOutput={liveTerminalOutput}
        checkpoints={checkpoints}
        onApproveToolCall={approve}
        recentWorkspaces={recentWorkspaces}
        onSelectRecent={openWorkspaceFolder}
        appVersion={packageJson.version}
        onAgentInputChange={setAgentInput}
        onAgentSend={() => { agentStreamSend(agentInput, agentAttachments); setAgentInput(""); setAgentAttachments([]); }}
        onAgentStop={agentStreamStop}
        onAgentSlashCommand={(cmd) => {
          switch (cmd) {
            case "/clear":
              agentStreamClearMessages();
              break;
            case "/refresh":
              loadWorkspaceFiles().catch(() => {});
              break;
            case "/help":
              agentStreamInjectAssistantMessage(
                "**Agent Commands**\n\n- `/clear` — clear this conversation\n- `/refresh` — reload the workspace file list\n- `/help` — show this message\n\nType a task like *\"add a dark mode toggle\"* or *\"refactor the auth module\"* and the agent will use tools to read, write, and run commands in your workspace."
              );
              break;
          }
        }}
        onOpenFolder={handleOpenFolder}
        onInputChange={setInput}
        onSend={() => sendMessage(input.trim())}
        onVoiceClick={startManualListen}
        onAgentVoiceClick={startManualListen}
        agentPlanMode={planMode}
        onAgentPlanModeChange={handlePlanModeChange}
        onProviderChange={setProvider}
        onModelChange={handleModelChange}
        onToggleWakeWord={toggleWakeWord}
        onToggleSpeech={toggleSpeech}
        onNewChat={handleNewChat}
        onNewAgent={handleNewAgent}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onPinConversation={handlePinConversation}
        conversationSystemPrompt={conversationSystemPrompt}
        onSystemPromptChange={handleSystemPromptChange}
        onEditMessage={handleEditMessage}
        onRetryMessage={handleRetryMessage}
        onSaveShortcuts={handleSaveShortcuts}
        promptTemplates={promptTemplates}
        mcpServers={mcpServers}
        onSaveTemplates={handleSavePromptTemplates}
        onSaveMCPServers={handleSaveMCPServers}
        chatAttachments={chatAttachments}
        onAttachmentsChange={setChatAttachments}
        chatDocs={chatDocs}
        onChatDocsChange={setChatDocs}
        agentAttachments={agentAttachments}
        onAgentAttachmentsChange={setAgentAttachments}
        onSlashCommand={handleSlashCommand}
        onSelectAgentFile={(path) => {
          openFileTab(path);
        }}
        onAgentFileContentChange={(value) => {
          if (!activeFilePath) return;
          setFileBuffers((prev) => {
            const next = new Map(prev);
            const existing = next.get(activeFilePath) ?? { content: "", dirty: false, loading: false };
            next.set(activeFilePath, { content: value, dirty: true, loading: existing.loading });
            return next;
          });
        }}
        onSaveAgentFile={() => {
          saveAgentFile().catch(() => {});
        }}
        onCloseAgentFile={() => {
          if (activeTabIndex >= 0) closeTab(activeTabIndex);
        }}
        onRefreshAgentFiles={() => {
          loadWorkspaceFiles().catch(() => {});
        }}
        openTabs={openTabs}
        activeTabIndex={activeTabIndex}
        fileBuffers={fileBuffers}
        onSelectTab={setActiveTabIndex}
        onCloseTab={closeTab}
        onReorderTabs={reorderTabs}
        onOpenSettings={openSettingsTab}
        onOpenPreviewTab={openPreviewTab}
        onOpenRestTab={openRestTab}
        folders={folders}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
        onMoveConversation={handleMoveConversation}
      />
      {profileLoaded && userProfile === null && (
        <SetupModal onSave={handleProfileSave} />
      )}
      <WhatsNewCard />
      {folderInputVisible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[480px] rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] p-4 shadow-2xl">
            <p className="mb-3 text-[12px] text-[var(--m-text-muted)]">Enter the full folder path to open as workspace:</p>
            <input
              autoFocus
              type="text"
              value={folderInputValue}
              onChange={(e) => setFolderInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleFolderInputSubmit();
                if (e.key === "Escape") setFolderInputVisible(false);
              }}
              placeholder="/Users/you/my-project"
              className="w-full rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)] px-3 py-2 font-mono text-[12px] text-[var(--m-text)] outline-none focus:border-[#d19a66]/50"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFolderInputVisible(false)}
                className="rounded-md border border-[var(--m-border)] px-3 py-1.5 text-[11px] text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleFolderInputSubmit}
                className="rounded-md bg-[#d19a66]/10 border border-[#d19a66]/30 px-3 py-1.5 text-[11px] text-[#d19a66] hover:bg-[#d19a66]/20"
              >
                Open
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
