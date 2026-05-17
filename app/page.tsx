"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type {
  AIProvider,
  Message,
  ChatRequest,
  ChatResponse,
  OllamaModel,
  TokenUsage,
  Conversation,
  CustomShortcut,
  HistoryMessage,
  AgentResponse,
  WorkspaceFile,
  ConversationMode,
  MCPServer,
  PromptTemplate,
  ImageAttachment,
  EditorTab,
} from "@/types";
import type { UserProfile } from "@/lib/userProfile";
import { useVoice } from "@/hooks/useVoice";
import { useAgentStream } from "@/hooks/useAgentStream";
import { speak, stopSpeaking } from "@/lib/speak";
import { ChatLayout } from "@/app/components/marven/ChatLayout";
import { SetupModal } from "@/app/components/marven/SetupModal";
import { parseCommand } from "@/lib/commandParser";
import {
  loadConversations,
  saveConversations,
  createConversation,
  createConversationWithMode,
  deleteConversation,
  loadCustomShortcuts,
  saveCustomShortcuts,
} from "@/lib/storage";
import {
  loadProfile,
  saveProfile,
  loadMemories,
  addMemory,
} from "@/lib/userProfile";

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
  const [provider, setProvider] = useState<AIProvider>("groq");
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModelByProvider, setSelectedModelByProvider] = useState<Record<AIProvider, string>>({
    groq: "",
    ollama: "",
    nim: "",
    openrouter: "",
    openai: "",
    anthropic: "",
  });
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const selectedModel = selectedModelByProvider[provider];

  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // ─── Conversations ──────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null;
  const messages: Message[] = activeConversation?.messages ?? [];
  const activeMode: ConversationMode = activeConversation?.mode ?? "chat";
  const conversationSystemPrompt = activeConversation?.systemPrompt ?? "";

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

  const {
    messages: agentStreamMessages,
    isRunning: agentStreamIsRunning,
    error: agentStreamError,
    send: agentStreamSend,
    stop: agentStreamStop,
    clearMessages: agentStreamClearMessages,
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

  useEffect(() => {
    if (activeMode !== "agent") return;
    loadWorkspaceFiles().catch(() => {});
  }, [activeMode]);

  // (file loading is now handled inside openFileTab)

  // Instant workspace refresh + auto-open + buffer refresh when agent writes files
  const processedWriteCallsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const lastMsg = agentStreamMessages[agentStreamMessages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;
    const newDone = (lastMsg.toolCalls ?? []).filter(
      (tc) => tc.tool === "write_file" && tc.status === "done" && !processedWriteCallsRef.current.has(tc.callId)
    );
    if (newDone.length === 0) return;
    newDone.forEach((tc) => processedWriteCallsRef.current.add(tc.callId));
    loadWorkspaceFiles().catch(() => {});
    // For every file the agent just wrote, re-fetch its content into the buffer so
    // the open tab reflects the new on-disk state (skip when user has unsaved edits)
    const writtenPaths = newDone
      .map((tc) => tc.args?.path as string | undefined)
      .filter((p): p is string => !!p);
    writtenPaths.forEach((p) => refreshFileBuffer(p));
    const lastWritten = writtenPaths[writtenPaths.length - 1];
    if (lastWritten) openFileTab(lastWritten);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentStreamMessages]);

  function toRelativePath(p: string): string {
    if (!workspaceRoot) return p;
    if (p.startsWith(workspaceRoot)) {
      return p.slice(workspaceRoot.length).replace(/^\/+/, "");
    }
    return p;
  }

  function refreshFileBuffer(rawPath: string) {
    const path = toRelativePath(rawPath);
    fetch("/api/workspace/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (!ok || typeof data?.content !== "string") return;
        setFileBuffers((prev) => {
          // Look up buffer under both the relative AND the raw path so we
          // catch buffers opened from the explorer (relative) and ones the
          // agent referenced absolutely.
          const existing = prev.get(path) ?? prev.get(rawPath);
          if (!existing) return prev;
          if (existing.dirty) return prev;
          const next = new Map(prev);
          next.set(path, { content: data.content, dirty: false, loading: false });
          if (rawPath !== path) next.set(rawPath, { content: data.content, dirty: false, loading: false });
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

  async function loadWorkspaceFiles() {
    const res = await fetch("/api/workspace/files");
    const data = await res.json();
    const files: WorkspaceFile[] = data.files ?? [];

    setWorkspaceFiles(files);
    setWorkspaceRoot(data.root ?? null);
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
    fetch("/api/workspace/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    })
      .then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }))
      .then(({ ok, status, data }) => {
        const errorMsg = !ok
          ? `${status}: ${data?.error ?? "request failed"}`
          : (typeof data?.content !== "string" ? (data?.error ?? "no content in response") : null);
        setFileBuffers((prev) => {
          const next = new Map(prev);
          const existing = next.get(path);
          if (!existing || !existing.dirty) {
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

    await fetch("/api/workspace/files", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: activeFilePath,
        content: activeBuffer.content,
      }),
    });

    setFileBuffers((prev) => {
      const next = new Map(prev);
      const existing = next.get(activeFilePath!);
      if (existing) next.set(activeFilePath!, { ...existing, dirty: false });
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
        setSelectedModelByProvider((prev) => {
          const current = prev[provider];
          const stillAvailable = nextModels.some((m) => m.name === current);
          if (stillAvailable) return prev;
          const fallback = data.defaultModel ?? nextModels[0]?.name ?? "";
          return { ...prev, [provider]: fallback };
        });
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
    toggleWakeWord,
    startManualListen,
    resumeWakeWord,
  } = useVoice(
    (text) => sendVoiceCommandRef.current(text),
    () => {
      stopSpeaking();
      setIsSpeakingNow(false);
    },
    (text) => setInput(text),
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
    if (wakeEnabled) {
      resumeWakeWord();
    }
    setIsSpeakingNow(true);
    speak(text, () => {
      setIsSpeakingNow(false);
      resumeWakeWord();
    });
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
    const memoryMatch = text.match(MEMORY_RE);
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
    if (WEATHER_RE.test(text)) {
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
    if (SCREEN_RE.test(text)) {
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

    // 3. Command detection (client-side shortcuts checked first)
    const command = parseCommand(text, customShortcuts);

    const convId = ensureActiveConversation(text);
    autoRenameConversation(convId, text);
    const userMsg = createMessage("user", text);
    if (chatAttachments.length > 0) {
      userMsg.attachments = [...chatAttachments];
      setChatAttachments([]);
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
        const history = buildHistory([...messages, userMsg]);
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
      const history = buildHistory([...messages, userMsg]);
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
    if (!text || isLoading) return;
    sendMessage(text);
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
      setProvider(conv.provider);
      if (conv.model) {
        setSelectedModelByProvider((prev) => ({
          ...prev,
          [conv.provider!]: conv.model!,
        }));
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
    setSelectedModelByProvider((prev) => ({ ...prev, [provider]: model }));
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
        appVersion="1.6.0"
        onAgentInputChange={setAgentInput}
        onAgentSend={() => { agentStreamSend(agentInput); setAgentInput(""); }}
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
      />
      {profileLoaded && userProfile === null && (
        <SetupModal onSave={handleProfileSave} />
      )}
      {folderInputVisible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[480px] rounded-lg border border-[#333] bg-[#1e1e1e] p-4 shadow-2xl">
            <p className="mb-3 text-[12px] text-[#888]">Enter the full folder path to open as workspace:</p>
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
              className="w-full rounded-md border border-[#383838] bg-[#252525] px-3 py-2 font-mono text-[12px] text-[#ccc] outline-none focus:border-[#d19a66]/50"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFolderInputVisible(false)}
                className="rounded-md border border-[#383838] px-3 py-1.5 text-[11px] text-[#666] hover:text-[#999]"
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
