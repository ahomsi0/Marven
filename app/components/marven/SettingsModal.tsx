"use client";

import { useState, useEffect, useRef } from "react";
import type { CustomShortcut, MCPServer, PromptTemplate } from "@/types";
import packageJson from "@/package.json";
import { MarvenLogo } from "./MarvenLogo";
import { useTheme } from "@/lib/theme";
import { getFormatOnSave, setFormatOnSave } from "@/lib/formatOnSave";
import { getRequireWriteApproval, setRequireWriteApproval } from "@/lib/agentSettings";
import { getLocalSttPipeline, type LocalSttProgress } from "@/lib/localStt";
import {
  DEFAULT_KEYBINDINGS,
  loadKeybindings,
  saveKeybindings,
  resetKeybindings,
} from "@/lib/keybindings";

type SttProviderId = "local" | "groq";
type LocalModelId = "whisper-tiny" | "whisper-base" | "distil-tiny";
type ProviderId =
  | "groq" | "openai" | "anthropic" | "nim" | "openrouter"
  | "ollama" | "lmstudio" | "llamaserver";

const LOCAL_MODEL_OPTIONS: Array<{ id: LocalModelId; label: string; hint: string }> = [
  { id: "whisper-tiny", label: "Whisper Tiny.en",      hint: "Default • ~145 MB • Fastest download" },
  { id: "whisper-base", label: "Whisper Base.en",      hint: "~290 MB • More accurate on accents / noise" },
  { id: "distil-tiny",  label: "Distil-Whisper Small", hint: "~165 MB • Best speed/accuracy balance" },
];

interface SettingsModalProps {
  shortcuts: CustomShortcut[];
  onSave: (shortcuts: CustomShortcut[]) => void;
  onClose: () => void;
  promptTemplates: PromptTemplate[];
  mcpServers: MCPServer[];
  onSaveTemplates: (templates: PromptTemplate[]) => void;
  onSaveMCPServers: (servers: MCPServer[]) => void;
  inline?: boolean;
}

type SettingsPage =
  | "general"
  | "ai-backends"
  | "api-keys"
  | "connectors"
  | "browser"
  | "shortcuts"
  | "keyboard"
  | "templates"
  | "commands"
  | "about";

interface EditState {
  index: number;
  label: string;
  trigger: string;
  url: string;
}

const SLASH_REF = [
  { command: "/clear", description: "Clear current conversation" },
  { command: "/new", description: "New conversation" },
  { command: "/shortcuts", description: "Open this panel" },
  { command: "/help", description: "Show help in chat" },
  { command: "/voice", description: "Toggle wake word" },
  { command: "/speech", description: "Toggle TTS" },
];

const NATURAL_LANGUAGE_SECTIONS = [
  {
    heading: "Web",
    items: [
      "open youtube",
      "open github",
      "google search for ...",
      "any URL (e.g. https://example.com)",
    ],
  },
  {
    heading: "Apps",
    items: [
      "open Chrome",
      "open Terminal",
      "open Spotify",
      "open [any app name]",
    ],
  },
  {
    heading: "System",
    items: [
      "what's the time",
      "today's date",
      "take a screenshot",
      "lock the screen",
      "open my downloads",
      "empty the trash",
    ],
  },
  {
    heading: "Clipboard",
    items: [
      "what's in my clipboard",
      "summarize clipboard",
      "fix my grammar",
    ],
  },
  {
    heading: "Timers",
    items: ["set a timer for 5 minutes", "timer 30 seconds"],
  },
];

const SECTIONS: Array<{
  heading: string;
  items: Array<{ id: SettingsPage; label: string }>;
}> = [
  {
    heading: "Workspace",
    items: [{ id: "general", label: "General" }],
  },
  {
    heading: "Integrations",
    items: [
      { id: "ai-backends", label: "AI Backends" },
      { id: "api-keys", label: "API Keys" },
      { id: "connectors", label: "Connectors" },
      { id: "browser", label: "Browser" },
    ],
  },
  {
    heading: "Customization",
    items: [
      { id: "shortcuts", label: "Shortcuts" },
      { id: "keyboard", label: "Keyboard" },
      { id: "templates", label: "Templates" },
    ],
  },
  {
    heading: "Help",
    items: [
      { id: "commands", label: "Commands" },
      { id: "about", label: "About" },
    ],
  },
];

const PAGE_META: Record<SettingsPage, { title: string; description: string }> = {
  general: {
    title: "General",
    description: "Overview and basic preferences for Marven.",
  },
  "ai-backends": {
    title: "AI Backends",
    description: "Enable and configure AI providers and local model servers.",
  },
  "api-keys": {
    title: "API Keys",
    description: "Configure provider credentials.",
  },
  connectors: {
    title: "Connectors",
    description:
      "MCP servers provide extra tools to the agent (filesystem, GitHub, databases, etc.).",
  },
  browser: {
    title: "Browser",
    description: "Choose which browser opens links from AI responses.",
  },
  shortcuts: {
    title: "Shortcuts",
    description: "Custom trigger phrases that open URLs via voice or text.",
  },
  keyboard: {
    title: "Keyboard",
    description: "Keyboard shortcut reference and customization.",
  },
  templates: {
    title: "Templates",
    description: "Slash-command prompt templates available in the input bar.",
  },
  commands: {
    title: "Commands",
    description: "Reference for slash commands and natural language actions.",
  },
  about: {
    title: "About",
    description: "Version info, updates, and links.",
  },
};

function AboutLink({
  label,
  hint,
  href,
}: {
  label: string;
  hint: string;
  href: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        const el =
          typeof window !== "undefined"
            ? (
                window as unknown as {
                  marvenElectron?: {
                    openExternal?: (u: string, b: string) => void;
                  };
                }
              ).marvenElectron
            : null;
        if (el?.openExternal) el.openExternal(href, "default");
        else window.open(href, "_blank", "noopener,noreferrer");
      }}
      className="group flex items-start justify-between gap-3 rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-4 py-3 text-left transition-all hover:border-[var(--m-accent)]/30 hover:bg-[var(--m-surface-2)]"
    >
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-[var(--m-text)] group-hover:text-[var(--m-accent)]">
          {label}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-[var(--m-text-muted)]">{hint}</div>
      </div>
      <svg
        className="mt-0.5 h-3 w-3 shrink-0 text-[var(--m-text-faint)] transition-colors group-hover:text-[var(--m-accent)]"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14 5l7 7m0 0l-7 7m7-7H3"
        />
      </svg>
    </button>
  );
}

export function SettingsModal({
  shortcuts,
  onSave,
  onClose,
  promptTemplates,
  mcpServers,
  onSaveTemplates,
  onSaveMCPServers,
  inline = false,
}: SettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const [activePage, setActivePage] = useState<SettingsPage>("general");
  const [formatOnSave, setFormatOnSaveState] = useState<boolean>(true);
  const [requireWriteApproval, setRequireWriteApprovalState] = useState<boolean>(false);
  const [liteAgentMode, setLiteAgentModeState] = useState<boolean>(false);
  const [codebaseIndexEnabled, setCodebaseIndexEnabled] = useState<boolean>(true);
  const [indexStatus, setIndexStatus] = useState<{
    running: boolean;
    stats: { fileCount: number; chunkCount: number; dbSizeBytes: number } | null;
  }>({ running: false, stats: null });
  useEffect(() => {
    setFormatOnSaveState(getFormatOnSave());
    setRequireWriteApprovalState(getRequireWriteApproval());
  }, []);
  const [items, setItems] = useState<CustomShortcut[]>(
    shortcuts.map((s) => ({ ...s }))
  );

  // API Keys state
  const [groqKey, setGroqKey] = useState("");
  const [nimKey, setNimKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [keysSaved, setKeysSaved] = useState(false);
  const [preferredBrowser, setPreferredBrowser] = useState<string>("default");

  // STT provider preference + model status — surfaced under General → Voice.
  // Default to "local" so first-time users get an offline-capable experience
  // without needing to plug in a Groq API key first.
  const [sttProvider, setSttProvider] = useState<SttProviderId>("local");
  const [customWakeWord, setCustomWakeWord] = useState<string>("");
  const [customWakeWordSaved, setCustomWakeWordSaved] = useState(false);
  const [localModel, setLocalModel] = useState<LocalModelId>("whisper-tiny");
  const [modelStatus, setModelStatus] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<
    | "idle"
    | "checking"
    | "up-to-date"
    | "available"
    | "progress"
    | "ready"
    | "error"
  >("idle");
  const [updateInfo, setUpdateInfo] = useState<{
    version?: string;
    percent?: number;
    transferred?: number;
    total?: number;
    bytesPerSecond?: number;
    message?: string;
  } | null>(null);
  const electron =
    typeof window !== "undefined" ? (window as any).marvenElectron : null;

  useEffect(() => {
    if (!electron) return;
    electron.getSettings().then((s: any) => {
      if (s.groqApiKey) setGroqKey(s.groqApiKey);
      if (s.nimApiKey) setNimKey(s.nimApiKey);
      if (s.openrouterApiKey) setOpenrouterKey(s.openrouterApiKey);
      if (s.openaiApiKey) setOpenaiKey(s.openaiApiKey);
      if (s.anthropicApiKey) setAnthropicKey(s.anthropicApiKey);
      if (s.ollamaUrl) setOllamaUrl(s.ollamaUrl);
      if (s.preferredBrowser) setPreferredBrowser(s.preferredBrowser);
      if (s.voiceSttProvider === "groq") setSttProvider("groq");
      else setSttProvider("local");
      const validModels: LocalModelId[] = ["whisper-tiny", "whisper-base", "distil-tiny"];
      if (validModels.includes(s.voiceLocalModel)) setLocalModel(s.voiceLocalModel);
      else setLocalModel("whisper-tiny");
      setCustomWakeWord(s.customWakeWord ?? "");
      if (s.enabledProviders) setEnabledProviders((prev) => ({ ...prev, ...(s.enabledProviders as Record<string, boolean>) }));
      if (s.lmStudioUrl) {
        setLmStudioUrl(s.lmStudioUrl);
        persistedLmStudioUrlRef.current = s.lmStudioUrl;
      }
      if (s.llamaServerUrl) {
        setLlamaServerUrl(s.llamaServerUrl);
        persistedLlamaServerUrlRef.current = s.llamaServerUrl;
      }
      if (typeof s.liteAgentMode === "boolean") {
        setLiteAgentModeState(s.liteAgentMode);
      }
      if (typeof s.codebaseIndexEnabled === "boolean") {
        setCodebaseIndexEnabled(s.codebaseIndexEnabled);
      }
    });
    electron.getVersion().then(setVersion);
    const unsub = electron.onUpdateStatus((data: any) => {
      setUpdateStatus(data.type);
      setUpdateInfo(data);
    });
    // Index status + event subscriptions
    const idx = (electron as any).index;
    let unsubIdx: (() => void) | undefined;
    if (idx) {
      idx.status?.().then((s: any) => {
        if (s) setIndexStatus({ running: !!s.running, stats: s.stats ?? null });
      });
      const u1 = idx.onProgress?.(() =>
        setIndexStatus((prev) => ({ ...prev, running: true })),
      );
      const u2 = idx.onDone?.(() => {
        idx.status?.().then((s: any) =>
          setIndexStatus({ running: false, stats: s?.stats ?? null }),
        );
      });
      const u3 = idx.onError?.(() =>
        setIndexStatus((prev) => ({ ...prev, running: false })),
      );
      unsubIdx = () => {
        u1?.();
        u2?.();
        u3?.();
      };
    }
    return () => {
      unsub?.();
      unsubIdx?.();
    };
  }, []);

  // Templates state
  const [templates, setTemplates] = useState<PromptTemplate[]>(
    promptTemplates.map((t) => ({ ...t }))
  );
  const [showAddTemplate, setShowAddTemplate] = useState(false);
  const [newTrigger, setNewTrigger] = useState("");
  const [newTemplateLabel, setNewTemplateLabel] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [templateError, setTemplateError] = useState("");

  // Connectors (MCP) state
  const [mcpList, setMcpList] = useState<MCPServer[]>(
    mcpServers.map((s) => ({ ...s }))
  );
  const [mcpStatuses, setMcpStatuses] = useState<
    Record<string, "connected" | "disconnected">
  >({});
  const [showAddMCP, setShowAddMCP] = useState(false);
  const [newMcpName, setNewMcpName] = useState("");
  const [newMcpCommand, setNewMcpCommand] = useState("");
  const [mcpError, setMcpError] = useState("");
  const [mcpLoading, setMcpLoading] = useState<string | null>(null);

  // AI Backends state
  const [enabledProviders, setEnabledProviders] = useState<Record<ProviderId, boolean>>({
    groq: true, openai: true, ollama: true,
    anthropic: false, nim: false, openrouter: false,
    lmstudio: false, llamaserver: false,
  });
  const [lmStudioUrl, setLmStudioUrl] = useState("http://localhost:1234");
  const [llamaServerUrl, setLlamaServerUrl] = useState("http://localhost:8080");
  const persistedLmStudioUrlRef = useRef("http://localhost:1234");
  const persistedLlamaServerUrlRef = useRef("http://localhost:8080");
  const [backendStatus, setBackendStatus] = useState<Record<string, "live" | "down" | "checking">>({
    ollama: "checking", lmstudio: "checking", llamaserver: "checking",
  });
  const backendSaveInFlightRef = useRef(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    if (activePage !== "connectors") return;
    const fetchStatus = () => {
      fetch("/api/mcp")
        .then((r) => r.json())
        .then((data) => {
          if (data.status) setMcpStatuses(data.status);
        })
        .catch(() => {});
    };
    fetchStatus();
    const id = setInterval(fetchStatus, 10_000);
    return () => clearInterval(id);
  }, [activePage]);

  useEffect(() => {
    if (activePage !== "ai-backends") return;
    const controller = new AbortController();
    const localProviders = ["ollama", "lmstudio", "llamaserver"] as const;
    localProviders.forEach((p) =>
      setBackendStatus((prev) => ({ ...prev, [p]: "checking" }))
    );
    Promise.all(
      localProviders.map(async (p) => {
        try {
          const res = await fetch(`/api/models?provider=${p}`, {
            signal: controller.signal,
          });
          const data = await res.json();
          setBackendStatus((prev) => ({
            ...prev,
            [p]: data.models && data.models.length > 0 ? "live" : "down",
          }));
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            setBackendStatus((prev) => ({ ...prev, [p]: "down" }));
          }
        }
      })
    );
    return () => controller.abort();
  }, [activePage]);

  // Add shortcut form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addTrigger, setAddTrigger] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addError, setAddError] = useState("");

  // Edit shortcut state
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editError, setEditError] = useState("");

  // Keyboard bindings state
  const [kbOverrides, setKbOverrides] = useState<Record<string, string>>({});
  const [capturingId, setCapturingId] = useState<string | null>(null);
  useEffect(() => {
    setKbOverrides(loadKeybindings());
  }, []);

  async function saveBackendSettings(patch: Record<string, unknown>) {
    if (!electron || backendSaveInFlightRef.current) return;
    backendSaveInFlightRef.current = true;
    try {
      const current = await electron.getSettings();
      await electron.saveSettings({ ...current, ...patch });
    } finally {
      backendSaveInFlightRef.current = false;
    }
  }

  async function handleSaveKeys() {
    if (!electron) return;
    // Merge with current settings so we don't clobber unrelated keys like
    // voiceSttProvider, custom shortcuts, etc.
    const current = await electron.getSettings();
    await electron.saveSettings({
      ...current,
      groqApiKey: groqKey.trim(),
      nimApiKey: nimKey.trim(),
      openrouterApiKey: openrouterKey.trim(),
      openaiApiKey: openaiKey.trim(),
      anthropicApiKey: anthropicKey.trim(),
      ollamaUrl: ollamaUrl.trim(),
      preferredBrowser,
    });
    setKeysSaved(true);
    setTimeout(() => setKeysSaved(false), 2500);
  }

  async function handleSaveBrowser(choice: string) {
    setPreferredBrowser(choice);
    if (!electron) return;
    const current = await electron.getSettings();
    await electron.saveSettings({ ...current, preferredBrowser: choice });
  }

  async function handleSttProviderChange(choice: SttProviderId) {
    setSttProvider(choice);
    setModelStatus(null);
    if (electron) {
      const current = await electron.getSettings();
      await electron.saveSettings({ ...current, voiceSttProvider: choice });
    }
    // Let useVoice (and any other listeners) pick up the change without
    // requiring a full app reload.
    window.dispatchEvent(new CustomEvent("marven:settings-changed"));
  }

  async function handleLocalModelChange(choice: LocalModelId) {
    setLocalModel(choice);
    setModelStatus(null);
    if (electron) {
      const current = await electron.getSettings();
      await electron.saveSettings({ ...current, voiceLocalModel: choice });
    }
    window.dispatchEvent(new CustomEvent("marven:settings-changed"));
  }

  async function handleSaveCustomWakeWord() {
    if (!electron) return;
    const current = await electron.getSettings();
    await electron.saveSettings({ ...current, customWakeWord: customWakeWord.trim() });
    window.dispatchEvent(new CustomEvent("marven:settings-changed"));
    setCustomWakeWordSaved(true);
    setTimeout(() => setCustomWakeWordSaved(false), 2000);
  }

  async function handlePreloadModel() {
    if (modelLoading) return;
    setModelLoading(true);
    setModelStatus("Preparing model…");
    try {
      await getLocalSttPipeline((p: LocalSttProgress) => {
        if (p.status === "downloading" && p.total) {
          const pct = Math.round(((p.loaded ?? 0) / p.total) * 100);
          const mb  = ((p.loaded ?? 0) / 1024 / 1024).toFixed(1);
          const tot = (p.total / 1024 / 1024).toFixed(1);
          const file = p.file ? ` ${p.file}` : "";
          setModelStatus(`Downloading${file}… ${pct}% (${mb}/${tot} MB)`);
        } else if (p.status === "loading") {
          setModelStatus(p.message ?? "Loading model…");
        } else if (p.status === "ready") {
          setModelStatus("Ready to use offline.");
        } else if (p.status === "error") {
          setModelStatus(p.message ? `Error: ${p.message}` : "Failed to load model.");
        }
      });
      setModelStatus("Ready to use offline.");
    } catch (err) {
      setModelStatus(err instanceof Error ? `Error: ${err.message}` : "Failed to load model.");
    } finally {
      setModelLoading(false);
    }
  }

  async function handleCheckUpdates() {
    if (!electron) return;
    setUpdateStatus("checking");
    setUpdateInfo(null);
    await electron.checkForUpdates();
  }

  function saveItems(next: CustomShortcut[]) {
    setItems(next);
    onSave(next);
  }

  function validateUrl(url: string): string | null {
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    try {
      new URL(normalized);
      return normalized;
    } catch {
      return null;
    }
  }

  function handleAdd() {
    const trigger = addTrigger.trim();
    const url = addUrl.trim();
    const label = addLabel.trim();
    if (!trigger || !url) {
      setAddError("Trigger and URL are required.");
      return;
    }
    const normalized = validateUrl(url);
    if (!normalized) {
      setAddError("Enter a valid URL.");
      return;
    }
    setAddError("");
    const newItem: CustomShortcut = { trigger, url: normalized };
    if (label) newItem.label = label;
    const next = [...items, newItem];
    saveItems(next);
    setAddLabel("");
    setAddTrigger("");
    setAddUrl("");
    setShowAddForm(false);
  }

  function handleDelete(index: number) {
    const next = items.filter((_, i) => i !== index);
    saveItems(next);
    if (editState?.index === index) setEditState(null);
  }

  function startEdit(index: number) {
    const item = items[index];
    setEditState({
      index,
      label: item.label ?? "",
      trigger: item.trigger,
      url: item.url,
    });
    setEditError("");
  }

  function handleEditSave() {
    if (!editState) return;
    const trigger = editState.trigger.trim();
    const url = editState.url.trim();
    const label = editState.label.trim();
    if (!trigger || !url) {
      setEditError("Trigger and URL are required.");
      return;
    }
    const normalized = validateUrl(url);
    if (!normalized) {
      setEditError("Enter a valid URL.");
      return;
    }
    setEditError("");
    const updated: CustomShortcut = { trigger, url: normalized };
    if (label) updated.label = label;
    const next = items.map((item, i) =>
      i === editState.index ? updated : item
    );
    saveItems(next);
    setEditState(null);
  }

  const inputClass =
    "w-full rounded-lg bg-[var(--m-surface-2)] border border-[var(--m-border)] px-3 py-2 text-[13px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-text-faint)] transition-colors";

  function formatKeyEvent(e: KeyboardEvent): string {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const parts: string[] = [];
    if (e.ctrlKey) parts.push(isMac ? "⌃" : "Ctrl+");
    if (e.altKey) parts.push(isMac ? "⌥" : "Alt+");
    if (e.shiftKey) parts.push(isMac ? "⇧" : "Shift+");
    if (e.metaKey) parts.push(isMac ? "⌘" : "Win+");
    const key =
      e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    parts.push(key);
    return parts.join("");
  }

  // ─── Page content renderer ───────────────────────────────────────────────

  function renderPageContent() {
    const meta = PAGE_META[activePage];

    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {/* Page header */}
        <div className="mb-6">
          <h2 className="text-[18px] font-semibold text-[var(--m-text)]">
            {meta.title}
          </h2>
          <p className="mt-1 text-[12px] text-[var(--m-text-muted)]">{meta.description}</p>
        </div>

        {/* ── General ── */}
        {activePage === "general" && (
          <div className="space-y-5">
            <div className="rounded-xl border border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-5 py-4">
              <div className="flex items-center gap-4">
                <MarvenLogo size={44} />
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[16px] font-semibold text-[var(--m-text)]">
                      Marven
                    </span>
                    <span className="rounded-full border border-[var(--m-accent)]/30 bg-[var(--m-accent)]/10 px-2 py-0.5 font-mono text-[10px] text-[var(--m-accent)]">
                      v{packageJson.version}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-[var(--m-text-muted)]">
                    AI desktop assistant. Files, settings, and memory stay
                    local. Prompts and audio go to the provider you pick (or
                    fully local with Ollama).
                  </p>
                </div>
              </div>
            </div>

            {/* Theme selector — visual preview tiles */}
            <div>
              <h3 className="mb-1 text-[13px] font-medium text-[var(--m-text)]">Appearance</h3>
              <p className="mb-3 text-[11px] text-[var(--m-text-faint)]">Choose how Marven looks.</p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  {
                    id: "dark" as const,
                    label: "Dark",
                    bg: "#1a1a1a",
                    surface: "#1e1e1e",
                    surface2: "#252525",
                    border: "#333",
                    text: "#d4d4d4",
                    muted: "#888",
                    accent: "#d19a66",
                  },
                  {
                    id: "light" as const,
                    label: "Light",
                    bg: "#fafafa",
                    surface: "#ffffff",
                    surface2: "#f0f0f0",
                    border: "#d4d4d4",
                    text: "#1f1f1f",
                    muted: "#6b6b6b",
                    accent: "#b87a3f",
                  },
                  {
                    id: "midnight" as const,
                    label: "Midnight",
                    bg: "#282c34",
                    surface: "#21252b",
                    surface2: "#2c313a",
                    border: "#3e4451",
                    text: "#abb2bf",
                    muted: "#636d83",
                    accent: "#61afef",
                  },
                  {
                    id: "aurora" as const,
                    label: "Aurora",
                    bg: "#1a1229",
                    surface: "#1f1735",
                    surface2: "#271e40",
                    border: "#3d2f5e",
                    text: "#f0e6d3",
                    muted: "#b994e0",
                    accent: "#f97ef8",
                  },
                ]).map((t) => {
                  const active = theme === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTheme(t.id)}
                      aria-pressed={active}
                      className={`group relative overflow-hidden rounded-lg border-2 transition-all ${
                        active
                          ? "border-[var(--m-accent)]"
                          : "border-[var(--m-border)] hover:border-[var(--m-text-faint)]"
                      }`}
                    >
                      {/* Mini app mockup */}
                      <div
                        className="flex h-[56px] w-full overflow-hidden"
                        style={{ background: t.bg }}
                      >
                        {/* Left sidebar */}
                        <div
                          className="flex w-1/4 flex-col gap-0.5 p-1"
                          style={{ background: t.surface, borderRight: `1px solid ${t.border}` }}
                        >
                          <div className="h-[2px] w-3/4 rounded-sm" style={{ background: t.text, opacity: 0.7 }} />
                          <div className="h-[2px] w-1/2 rounded-sm" style={{ background: t.muted, opacity: 0.6 }} />
                          <div className="h-[2px] w-2/3 rounded-sm" style={{ background: t.muted, opacity: 0.6 }} />
                        </div>
                        {/* Editor */}
                        <div className="flex flex-1 flex-col gap-0.5 p-1">
                          <div className="flex gap-0.5">
                            <div className="h-1 w-3 rounded-sm" style={{ background: t.surface2 }} />
                            <div className="h-1 w-1 rounded-sm" style={{ background: t.accent }} />
                          </div>
                          <div className="mt-0.5 space-y-[1px]">
                            <div className="h-[1px] w-4/5" style={{ background: t.text, opacity: 0.7 }} />
                            <div className="h-[1px] w-3/5" style={{ background: t.muted, opacity: 0.6 }} />
                            <div className="h-[1px] w-2/3" style={{ background: t.text, opacity: 0.7 }} />
                          </div>
                        </div>
                        {/* Right panel */}
                        <div
                          className="w-1/4 p-1"
                          style={{ background: t.surface, borderLeft: `1px solid ${t.border}` }}
                        >
                          <div className="h-[2px] w-full rounded-sm" style={{ background: t.muted, opacity: 0.5 }} />
                        </div>
                      </div>
                      {/* Label bar */}
                      <div
                        className={`flex items-center justify-between border-t px-2.5 py-1 ${
                          active
                            ? "border-[var(--m-accent)]/30 bg-[var(--m-accent)]/10"
                            : "border-[var(--m-border-subtle)] bg-[var(--m-surface)]"
                        }`}
                      >
                        <span className={`text-[11px] font-medium ${active ? "text-[var(--m-accent)]" : "text-[var(--m-text)]"}`}>
                          {t.label}
                        </span>
                        {active && (
                          <svg className="h-2.5 w-2.5 text-[var(--m-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Voice recognition — picks where "Hey Marven" audio is
                transcribed. Local uses Whisper-tiny.en in-browser via
                transformers.js (no key required, model downloads once). */}
            <div>
              <h3 className="mb-1 text-[13px] font-medium text-[var(--m-text)]">Voice recognition</h3>
              <p className="mb-3 text-[11px] text-[var(--m-text-faint)]">
                Where &quot;Hey Marven&quot; audio is transcribed.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  {
                    id: "local" as const,
                    label: "Local",
                    hint: "On your machine • Free • Whisper-tiny",
                    icon: (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                        <rect x="3" y="4" width="18" height="12" rx="2" />
                        <path strokeLinecap="round" d="M8 20h8M12 16v4" />
                      </svg>
                    ),
                  },
                  {
                    id: "groq" as const,
                    label: "Groq Cloud",
                    hint: "Faster • Requires API key",
                    icon: (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 014-4 5 5 0 019.584-1A4.5 4.5 0 0119 19H7a4 4 0 01-4-4z" />
                      </svg>
                    ),
                  },
                ]).map((opt) => {
                  const active = sttProvider === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSttProviderChange(opt.id)}
                      aria-pressed={active}
                      className={`flex flex-col gap-1.5 rounded-lg border-2 p-3 text-left transition-all ${
                        active
                          ? "border-[var(--m-accent)] bg-[var(--m-accent)]/5"
                          : "border-[var(--m-border)] hover:border-[var(--m-text-faint)]"
                      }`}
                    >
                      <span className={`flex items-center gap-2 text-[12px] font-medium ${active ? "text-[var(--m-accent)]" : "text-[var(--m-text)]"}`}>
                        {opt.icon}
                        {opt.label}
                      </span>
                      <span className="text-[10px] text-[var(--m-text-faint)]">{opt.hint}</span>
                    </button>
                  );
                })}
              </div>
              {sttProvider === "local" && (
                <>
                  <div className="mt-3">
                    <p className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--m-text-faint)]">
                      Local model
                    </p>
                    <div className="space-y-1.5">
                      {LOCAL_MODEL_OPTIONS.map((opt) => {
                        const active = localModel === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleLocalModelChange(opt.id)}
                            aria-pressed={active}
                            className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                              active
                                ? "border-[var(--m-accent)] bg-[var(--m-accent)]/8"
                                : "border-[var(--m-border-subtle)] hover:border-[var(--m-text-faint)] hover:bg-[var(--m-surface-2)]"
                            }`}
                          >
                            <span
                              className={`inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full border ${
                                active
                                  ? "border-[var(--m-accent)] bg-[var(--m-accent)]"
                                  : "border-[var(--m-text-faint)]"
                              }`}
                            >
                              {active && (
                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--m-bg)]" />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className={`text-[12px] font-medium ${active ? "text-[var(--m-accent)]" : "text-[var(--m-text)]"}`}>
                                {opt.label}
                              </div>
                              <div className="text-[10px] text-[var(--m-text-faint)]">{opt.hint}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] text-[var(--m-text-muted)]">
                      {modelStatus ?? "Model downloads on first use, then runs offline."}
                    </p>
                    <button
                      type="button"
                      onClick={handlePreloadModel}
                      disabled={modelLoading}
                      className="shrink-0 rounded-md border border-[var(--m-accent)]/30 bg-[var(--m-accent)]/10 px-2.5 py-1 text-[10px] text-[var(--m-accent)] transition-colors hover:bg-[var(--m-accent)]/15 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {modelLoading ? "Loading…" : "Preload model"}
                    </button>
                  </div>
                </>
              )}
              {sttProvider === "groq" && (
                <p className="mt-2 text-[10px] text-[var(--m-text-muted)]">
                  Requires a Groq API key in Integrations → API Keys. Audio is sent to Groq Whisper.
                </p>
              )}
              <div className="mt-4 flex items-center justify-between py-2">
                <div>
                  <p className="text-[12px] text-[var(--m-text)]">Custom wake word</p>
                  <p className="text-[11px] text-[var(--m-text-faint)]">
                    Phrase to trigger voice in addition to &quot;Hey Marven&quot; (leave blank to use default only)
                  </p>
                </div>
                <div className="ml-4 flex items-center gap-1.5">
                  <input
                    type="text"
                    value={customWakeWord}
                    onChange={(e) => { setCustomWakeWord(e.target.value); setCustomWakeWordSaved(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveCustomWakeWord(); }}
                    placeholder="e.g. Hey Assistant"
                    className="w-36 rounded-md border border-[var(--m-border)] bg-[var(--m-bg)] px-2 py-1 text-[11px] text-[var(--m-text)] placeholder-[var(--m-text-faint)] outline-none focus:border-[var(--m-text-faint)]"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCustomWakeWord}
                    className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-medium transition-all ${
                      customWakeWordSaved
                        ? "bg-green-600/20 text-green-400"
                        : "bg-[var(--m-accent-soft)] text-[var(--m-accent)] hover:bg-[var(--m-accent)]/20"
                    }`}
                  >
                    {customWakeWordSaved ? "Saved ✓" : "Save"}
                  </button>
                </div>
              </div>
            </div>

            {/* Format on save toggle */}
            <div className="rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-surface)] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-medium text-[var(--m-text)]">Format on save</h3>
                  <p className="mt-0.5 text-[11px] text-[var(--m-text-faint)]">
                    Run Prettier on JS/TS, CSS, JSON, Markdown, HTML, and YAML files when
                    saving. Falls back to the original on syntax errors.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={formatOnSave}
                  onClick={() => {
                    const next = !formatOnSave;
                    setFormatOnSaveState(next);
                    setFormatOnSave(next);
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    formatOnSave ? "bg-[#d19a66]" : "bg-[var(--m-border)]"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      formatOnSave ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Require write approval toggle */}
            <div className="rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-surface)] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-medium text-[var(--m-text)]">Require approval before writing files</h3>
                  <p className="mt-0.5 text-[11px] text-[var(--m-text-faint)]">
                    Show a diff preview and ask before write_file or apply_patch execute. Adds a confirmation step for every agent write.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={requireWriteApproval}
                  onClick={() => {
                    const next = !requireWriteApproval;
                    setRequireWriteApprovalState(next);
                    setRequireWriteApproval(next);
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    requireWriteApproval ? "bg-[#d19a66]" : "bg-[var(--m-border)]"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      requireWriteApproval ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Agent section */}
            <h3 className="text-[13px] font-medium text-[var(--m-text)]">Agent</h3>

            {/* Lite agent mode toggle */}
            <div className="rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-surface)] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-medium text-[var(--m-text)]">Lite agent mode</h3>
                  <p className="mt-0.5 text-[11px] text-[var(--m-text-faint)]">
                    Automatically uses a reduced tool set and shorter instructions.
                    On by default for local models.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={liteAgentMode}
                  onClick={async () => {
                    const next = !liteAgentMode;
                    setLiteAgentModeState(next);
                    await saveBackendSettings({ liteAgentMode: next });
                    window.dispatchEvent(new CustomEvent("marven:settings-changed"));
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    liteAgentMode ? "bg-[#d19a66]" : "bg-[var(--m-border)]"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      liteAgentMode ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Codebase Indexing */}
            <div
              className="rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-surface)] p-4"
              data-testid="setting-codebase-indexing"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-medium text-[var(--m-text)]">
                    Codebase indexing
                  </h3>
                  <p className="mt-0.5 text-[11px] text-[var(--m-text-faint)]">
                    Lets the agent search your code semantically. Uses Ollama
                    (nomic-embed-text). Index lives at ~/.marven/index/.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={codebaseIndexEnabled}
                  onClick={async () => {
                    const next = !codebaseIndexEnabled;
                    setCodebaseIndexEnabled(next);
                    if (electron) {
                      const cur = await electron.getSettings();
                      await electron.saveSettings({
                        ...cur,
                        codebaseIndexEnabled: next,
                      });
                      await (electron as any).index?.setEnabled?.(next);
                      window.dispatchEvent(
                        new CustomEvent("marven:settings-changed"),
                      );
                    }
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    codebaseIndexEnabled ? "bg-[#d19a66]" : "bg-[var(--m-border)]"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      codebaseIndexEnabled ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
              <div className="mt-3 text-[11px] text-[var(--m-text-faint)]">
                Status:{" "}
                {indexStatus.running
                  ? "Indexing…"
                  : indexStatus.stats
                    ? "Ready"
                    : "Idle"}
                {indexStatus.stats && (
                  <>
                    {" · "}
                    {indexStatus.stats.fileCount} files ·{" "}
                    {indexStatus.stats.chunkCount} chunks ·{" "}
                    {(indexStatus.stats.dbSizeBytes / 1_000_000).toFixed(1)} MB
                  </>
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded border border-[var(--m-border-subtle)] px-2 py-1 text-[11px] text-[var(--m-text)] hover:bg-[var(--m-surface-raised)]"
                  onClick={() => (electron as any)?.index?.runFull?.()}
                >
                  Reindex now
                </button>
                <button
                  type="button"
                  className="rounded border border-[var(--m-border-subtle)] px-2 py-1 text-[11px] text-[var(--m-text)] hover:bg-[var(--m-surface-raised)]"
                  onClick={async () => {
                    const idx = (electron as any)?.index;
                    if (!idx) return;
                    await idx.clear?.();
                    const s = await idx.status?.();
                    setIndexStatus({
                      running: !!s?.running,
                      stats: s?.stats ?? null,
                    });
                  }}
                >
                  Clear index
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── AI Backends ── */}
        {activePage === "ai-backends" && (
          <div className="flex flex-col gap-0">
            {/* Cloud providers */}
            <div className="mb-1 px-1 pt-1 text-[9px] font-bold uppercase tracking-widest text-[var(--m-text-faint)]">
              Cloud
            </div>
            {([
              { id: "groq",       label: "Groq",       icon: "⚡", meta: "5 models", badge: "cloud" },
              { id: "openai",     label: "OpenAI",     icon: "◈", meta: "4 models", badge: "cloud" },
              { id: "anthropic",  label: "Anthropic",  icon: "✦", meta: "3 models", badge: "cloud" },
              { id: "nim",        label: "NIM",        icon: "◈", meta: "5 models", badge: "cloud" },
              { id: "openrouter", label: "OpenRouter", icon: "◉", meta: "5 models", badge: "cloud" },
            ] as const).map(({ id, label, icon, meta, badge }) => (
              <div
                key={id}
                className="flex items-center gap-3 border-b border-[var(--m-border-subtle)] py-2.5"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--m-surface-raised)] text-base">
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold text-[var(--m-text)]">{label}</span>
                    <span className="rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-widest bg-[rgba(97,175,239,0.1)] text-[#61afef]">
                      {badge}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--m-text-faint)]">{meta}</div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const next = { ...enabledProviders, [id]: !enabledProviders[id] };
                    setEnabledProviders(next);
                    await saveBackendSettings({ enabledProviders: next });
                  }}
                  className={`relative h-[17px] w-[32px] shrink-0 rounded-full transition-colors ${
                    enabledProviders[id] ? "bg-[#d19a66]" : "bg-[#333]"
                  }`}
                  aria-label={enabledProviders[id] ? `Disable ${label}` : `Enable ${label}`}
                >
                  <span
                    className={`absolute top-[2px] h-[13px] w-[13px] rounded-full bg-white transition-all ${
                      enabledProviders[id] ? "left-[17px]" : "left-[2px]"
                    }`}
                  />
                </button>
              </div>
            ))}

            {/* Local backends */}
            <div className="mb-1 mt-4 px-1 text-[9px] font-bold uppercase tracking-widest text-[var(--m-text-faint)]">
              Local
            </div>
            {([
              { id: "ollama",      label: "Ollama",       icon: "🦙", badge: "local", hasUrl: false },
              { id: "lmstudio",    label: "LM Studio",    icon: "◉",  badge: "local", hasUrl: true  },
              { id: "llamaserver", label: "llama-server",  icon: "⬡",  badge: "local", hasUrl: true  },
            ] as const).map(({ id, label, icon, badge, hasUrl }) => (
              <div
                key={id}
                className="flex flex-col border-b border-[var(--m-border-subtle)] py-2.5 gap-1.5"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--m-surface-raised)] text-base">
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-[var(--m-text)]">{label}</span>
                      <span className="rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-widest bg-[rgba(152,195,121,0.1)] text-[#98c379]">
                        {badge}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--m-text-faint)]">
                      {backendStatus[id] === "checking" && "Checking…"}
                      {backendStatus[id] === "live"     && <span className="text-[#98c379]">● running</span>}
                      {backendStatus[id] === "down"     && <span className="text-[#555]">✗ not running</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = { ...enabledProviders, [id]: !enabledProviders[id] };
                      setEnabledProviders(next);
                      await saveBackendSettings({ enabledProviders: next });
                    }}
                    className={`relative h-[17px] w-[32px] shrink-0 rounded-full transition-colors ${
                      enabledProviders[id] ? "bg-[#d19a66]" : "bg-[#333]"
                    }`}
                    aria-label={enabledProviders[id] ? `Disable ${label}` : `Enable ${label}`}
                  >
                    <span
                      className={`absolute top-[2px] h-[13px] w-[13px] rounded-full bg-white transition-all ${
                        enabledProviders[id] ? "left-[17px]" : "left-[2px]"
                      }`}
                    />
                  </button>
                </div>
                {hasUrl && (
                  <>
                    <input
                      type="text"
                      value={id === "lmstudio" ? lmStudioUrl : llamaServerUrl}
                      onChange={(e) => {
                        if (id === "lmstudio") setLmStudioUrl(e.target.value);
                        else setLlamaServerUrl(e.target.value);
                      }}
                      onBlur={async (e) => {
                        const val = e.target.value.trim();
                        try {
                          new URL(val);
                          setUrlError(null);
                          const key = id === "lmstudio" ? "lmStudioUrl" : "llamaServerUrl";
                          await saveBackendSettings({ [key]: val });
                          if (id === "lmstudio") persistedLmStudioUrlRef.current = val;
                          else persistedLlamaServerUrlRef.current = val;
                        } catch {
                          setUrlError("Invalid URL — must start with http:// or https://");
                          if (id === "lmstudio") setLmStudioUrl(persistedLmStudioUrlRef.current);
                          else setLlamaServerUrl(persistedLlamaServerUrlRef.current);
                        }
                      }}
                      className="ml-11 rounded border border-[var(--m-border)] bg-[var(--m-surface-raised)] px-2 py-1 font-mono text-[11px] text-[var(--m-text-muted)] focus:outline-none focus:border-[var(--m-accent)]"
                      spellCheck={false}
                    />
                    {urlError && (
                      <p className="ml-11 mt-0.5 text-[10px] text-[#e06c75]">{urlError}</p>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── API Keys ── */}
        {activePage === "api-keys" && (
          <div className="space-y-5">
            {!electron && (
              <div className="rounded-lg border border-[var(--m-border)] bg-[var(--m-surface-2)] px-4 py-3">
                <p className="font-mono text-[11px] text-[var(--m-text-muted)]">
                  API key settings are only available in the packaged app.
                </p>
              </div>
            )}

            <div>
              <label className="block font-mono text-[9px] tracking-[0.2em] text-[var(--m-text-faint)] uppercase mb-2">
                Groq API Key
              </label>
              <input
                type="password"
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                placeholder="gsk_..."
                disabled={!electron}
                className={inputClass}
              />
              <p className="mt-1.5 font-mono text-[10px] text-[var(--m-text-faint)]">
                Free at console.groq.com — powers cloud AI chat.
              </p>
            </div>

            <div>
              <label className="block font-mono text-[9px] tracking-[0.2em] text-[var(--m-text-faint)] uppercase mb-2">
                NVIDIA NIM API Key
              </label>
              <input
                type="password"
                value={nimKey}
                onChange={(e) => setNimKey(e.target.value)}
                placeholder="nvapi-..."
                disabled={!electron}
                className={inputClass}
              />
              <p className="mt-1.5 font-mono text-[10px] text-[var(--m-text-faint)]">
                Free credits at build.nvidia.com — access llama-3.1-70b and
                more.
              </p>
            </div>

            <div>
              <label className="block font-mono text-[9px] tracking-[0.2em] text-[var(--m-text-faint)] uppercase mb-2">
                OpenRouter API Key
              </label>
              <input
                type="password"
                value={openrouterKey}
                onChange={(e) => setOpenrouterKey(e.target.value)}
                placeholder="sk-or-..."
                disabled={!electron}
                className={inputClass}
              />
              <p className="mt-1.5 font-mono text-[10px] text-[var(--m-text-faint)]">
                Free at openrouter.ai — access Gemma, Llama, Mistral &amp; more
                at no cost.
              </p>
            </div>

            <div>
              <label className="block font-mono text-[9px] tracking-[0.2em] text-[var(--m-text-faint)] uppercase mb-2">
                OpenAI API Key
              </label>
              <input
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
                disabled={!electron}
                className={inputClass}
              />
              <p className="mt-1.5 font-mono text-[10px] text-[var(--m-text-faint)]">
                Get yours at platform.openai.com — powers GPT-4o and GPT-4o
                mini.
              </p>
            </div>

            <div>
              <label className="block font-mono text-[9px] tracking-[0.2em] text-[var(--m-text-faint)] uppercase mb-2">
                Anthropic API Key
              </label>
              <input
                type="password"
                value={anthropicKey}
                onChange={(e) => setAnthropicKey(e.target.value)}
                placeholder="sk-ant-..."
                disabled={!electron}
                className={inputClass}
              />
              <p className="mt-1.5 font-mono text-[10px] text-[var(--m-text-faint)]">
                Get yours at console.anthropic.com — powers Claude Sonnet,
                Haiku &amp; Opus.
              </p>
            </div>

            <div>
              <label className="block font-mono text-[9px] tracking-[0.2em] text-[var(--m-text-faint)] uppercase mb-2">
                Ollama URL
              </label>
              <input
                type="text"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                placeholder="http://localhost:11434"
                disabled={!electron}
                className={inputClass}
              />
              <p className="mt-1.5 font-mono text-[10px] text-[var(--m-text-faint)]">
                Default: http://localhost:11434 — only change if Ollama runs on
                a different machine.
              </p>
            </div>

            <button
              type="button"
              onClick={handleSaveKeys}
              disabled={!electron}
              className="w-full rounded-lg border border-[#d19a66]/30 bg-[#d19a66]/10 py-2.5 font-mono text-[11px] tracking-wider text-[#d19a66] uppercase transition-all hover:bg-[#d19a66]/15 hover:border-[#d19a66]/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {keysSaved ? "Saved ✓" : "Save Keys"}
            </button>

          </div>
        )}

        {/* ── Connectors (MCP) ── */}
        {activePage === "connectors" && (
          <div className="space-y-2">
            {mcpList.length === 0 && (
              <p className="text-[12px] text-[var(--m-text-faint)] px-1">
                No MCP servers configured.
              </p>
            )}
            {mcpList.map((server) => (
              <div
                key={server.id}
                className="flex items-center gap-2 rounded-md border border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-2"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    background:
                      mcpStatuses[server.id] === "connected"
                        ? "#4caf50"
                        : "#555",
                  }}
                  title={mcpStatuses[server.id] ?? "unknown"}
                />
                <span className="text-[12px] text-[var(--m-text)] min-w-[80px]">
                  {server.name}
                </span>
                <span className="flex-1 font-mono text-[10px] text-[var(--m-text-faint)] truncate">
                  {server.command}
                </span>
                <button
                  type="button"
                  disabled={mcpLoading === server.id}
                  onClick={async () => {
                    setMcpLoading(server.id);
                    try {
                      await fetch("/api/mcp", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "stop", server }),
                      });
                      const updated = mcpList.filter(
                        (s) => s.id !== server.id
                      );
                      setMcpList(updated);
                      onSaveMCPServers(updated);
                    } finally {
                      setMcpLoading(null);
                    }
                  }}
                  className="text-[var(--m-text-faint)] hover:text-red-400 text-[12px] shrink-0 disabled:opacity-30"
                >
                  ×
                </button>
              </div>
            ))}

            {!showAddMCP ? (
              <button
                type="button"
                onClick={() => setShowAddMCP(true)}
                className="mt-2 w-full rounded-md border border-dashed border-[var(--m-border)] py-2 text-[11px] text-[var(--m-text-faint)] hover:border-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
              >
                + Add server
              </button>
            ) : (
              <div className="mt-2 rounded-md border border-[var(--m-border)] bg-[var(--m-bg)] p-3 space-y-2">
                <input
                  value={newMcpName}
                  onChange={(e) => setNewMcpName(e.target.value)}
                  placeholder="Name (e.g. filesystem)"
                  className="w-full rounded border border-[var(--m-border)] bg-[var(--m-surface)] px-2 py-1.5 text-[11px] text-[var(--m-text)] outline-none focus:border-[var(--m-text-faint)]"
                />
                <input
                  value={newMcpCommand}
                  onChange={(e) => setNewMcpCommand(e.target.value)}
                  placeholder="Command (e.g. npx @modelcontextprotocol/server-filesystem ~/)"
                  className="w-full rounded border border-[var(--m-border)] bg-[var(--m-surface)] px-2 py-1.5 text-[11px] font-mono text-[var(--m-text)] outline-none focus:border-[var(--m-text-faint)]"
                />
                {mcpError && (
                  <p className="text-[10px] text-red-400">{mcpError}</p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddMCP(false);
                      setNewMcpName("");
                      setNewMcpCommand("");
                      setMcpError("");
                    }}
                    className="text-[11px] text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)] px-3 py-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newMcpName.trim()) {
                        setMcpError("Name is required");
                        return;
                      }
                      if (!newMcpCommand.trim()) {
                        setMcpError("Command is required");
                        return;
                      }
                      const newServer: MCPServer = {
                        id: `${Date.now()}-${Math.random()
                          .toString(36)
                          .slice(2)}`,
                        name: newMcpName.trim(),
                        command: newMcpCommand.trim(),
                        enabled: true,
                      };
                      setMcpLoading(newServer.id);
                      const res = await fetch("/api/mcp", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "start", server: newServer }),
                      });
                      const data = await res.json();
                      if (!data.ok) {
                        setMcpError(data.error ?? "Failed to connect");
                        setMcpLoading(null);
                        return;
                      }
                      const updated = [...mcpList, newServer];
                      setMcpList(updated);
                      onSaveMCPServers(updated);
                      setMcpStatuses((s) => ({
                        ...s,
                        [newServer.id]: "connected",
                      }));
                      setShowAddMCP(false);
                      setNewMcpName("");
                      setNewMcpCommand("");
                      setMcpError("");
                      setMcpLoading(null);
                    }}
                    className="rounded border border-[#d19a66]/30 bg-[#d19a66]/10 px-3 py-1 text-[11px] text-[#d19a66] hover:bg-[#d19a66]/20"
                  >
                    Save &amp; Connect
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Browser ── */}
        {activePage === "browser" && (
          <div className="space-y-4">
            {(
              [
                {
                  id: "default",
                  label: "Default",
                  description: "System default browser",
                },
                {
                  id: "chrome",
                  label: "Google Chrome",
                  description: "google.com/chrome",
                },
                {
                  id: "firefox",
                  label: "Firefox",
                  description: "mozilla.org/firefox",
                },
                {
                  id: "safari",
                  label: "Safari",
                  description: "Built-in macOS browser",
                },
                {
                  id: "edge",
                  label: "Microsoft Edge",
                  description: "microsoft.com/edge",
                },
                { id: "arc", label: "Arc", description: "arc.net" },
              ] as { id: string; label: string; description: string }[]
            ).map(({ id, label, description }) => {
              const active = preferredBrowser === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSaveBrowser(id)}
                  className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 transition-all text-left ${
                    active
                      ? "border-[#d19a66]/50 bg-[#d19a66]/08"
                      : "border-[var(--m-border-subtle)] bg-[var(--m-surface)] hover:border-[var(--m-border)] hover:bg-[var(--m-surface-2)]"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      active
                        ? "border-[#d19a66] bg-[#d19a66]/20"
                        : "border-[var(--m-border)]"
                    }`}
                  >
                    {active && (
                      <span className="h-2 w-2 rounded-full bg-[#d19a66]" />
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span
                      className={`block font-mono text-[12px] ${
                        active ? "text-[var(--m-accent)]" : "text-[var(--m-text)]"
                      }`}
                    >
                      {label}
                    </span>
                    <span className="block font-mono text-[10px] text-[var(--m-text-faint)] mt-0.5">
                      {description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Shortcuts ── */}
        {activePage === "shortcuts" && (
          <div>
            {!showAddForm ? (
              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#d19a66]/10 border border-[#d19a66]/30 px-4 py-2.5 font-mono text-[11px] tracking-wider text-[#d19a66] uppercase transition-all hover:bg-[#d19a66]/15 hover:border-[#d19a66]/50"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
                Add New Shortcut
              </button>
            ) : (
              <div className="mb-4 rounded-lg border border-[var(--m-border)] bg-[var(--m-surface-2)] p-4 space-y-2.5">
                <p className="font-mono text-[9px] text-[var(--m-text-muted)] uppercase tracking-[0.2em] mb-3">
                  New Shortcut
                </p>
                <input
                  type="text"
                  value={addLabel}
                  onChange={(e) => setAddLabel(e.target.value)}
                  placeholder="Label (optional, e.g. My Dashboard)"
                  className={inputClass}
                />
                <input
                  type="text"
                  value={addTrigger}
                  onChange={(e) => setAddTrigger(e.target.value)}
                  placeholder='Trigger phrase (e.g. "open work")'
                  className={inputClass}
                />
                <input
                  type="text"
                  value={addUrl}
                  onChange={(e) => setAddUrl(e.target.value)}
                  placeholder="URL (e.g. https://example.com)"
                  className={inputClass}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd();
                  }}
                />
                {addError && (
                  <p className="text-[11px] text-red-400 font-mono">
                    {addError}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleAdd}
                    className="flex-1 rounded-lg bg-[#d19a66/12] border border-[#d19a66/35] py-2 font-mono text-[11px] tracking-wider text-[#d19a66] uppercase transition-all hover:bg-[#d19a66/20]"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddForm(false);
                      setAddError("");
                      setAddLabel("");
                      setAddTrigger("");
                      setAddUrl("");
                    }}
                    className="rounded-lg px-4 py-2 font-mono text-[11px] text-[var(--m-text-faint)] transition-colors hover:text-[var(--m-accent)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-3 text-[var(--m-text-faint)]">
                  <svg
                    className="mx-auto h-8 w-8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                </div>
                <p className="font-mono text-[11px] tracking-wider text-[var(--m-text-faint)] uppercase">
                  No shortcuts yet.
                </p>
                <p className="font-mono text-[10px] text-[var(--m-text-faint)] mt-1">
                  Add your first one above.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((item, i) => {
                  const displayName = item.label || item.trigger;
                  const avatarChar = displayName.charAt(0).toUpperCase();

                  if (editState?.index === i) {
                    return (
                      <div
                        key={i}
                        className="rounded-lg border border-[var(--m-border)] bg-[var(--m-surface-2)] p-4 space-y-2.5"
                      >
                        <p className="font-mono text-[9px] text-[var(--m-text-muted)] uppercase tracking-[0.2em] mb-3">
                          Edit Shortcut
                        </p>
                        <input
                          type="text"
                          value={editState.label}
                          onChange={(e) =>
                            setEditState({ ...editState, label: e.target.value })
                          }
                          placeholder="Label (optional)"
                          className={inputClass}
                        />
                        <input
                          type="text"
                          value={editState.trigger}
                          onChange={(e) =>
                            setEditState({
                              ...editState,
                              trigger: e.target.value,
                            })
                          }
                          placeholder="Trigger phrase"
                          className={inputClass}
                        />
                        <input
                          type="text"
                          value={editState.url}
                          onChange={(e) =>
                            setEditState({ ...editState, url: e.target.value })
                          }
                          placeholder="URL"
                          className={inputClass}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleEditSave();
                          }}
                        />
                        {editError && (
                          <p className="text-[11px] text-red-400 font-mono">
                            {editError}
                          </p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            onClick={handleEditSave}
                            className="flex-1 rounded-lg bg-[#d19a66/12] border border-[#d19a66/35] py-2 font-mono text-[11px] tracking-wider text-[#d19a66] uppercase transition-all hover:bg-[#d19a66/20]"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditState(null);
                              setEditError("");
                            }}
                            className="rounded-lg px-4 py-2 font-mono text-[11px] text-[var(--m-text-faint)] transition-colors hover:text-[var(--m-accent)]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-lg bg-[var(--m-surface-2)] border border-[var(--m-border-subtle)] px-4 py-3"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d19a66/10] border border-[#383838] font-mono text-[12px] font-medium text-[#d19a66]">
                        {avatarChar}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-[var(--m-text)] truncate">
                          {displayName}
                        </p>
                        <p className="font-mono text-[10px] text-[var(--m-text-muted)] truncate">
                          {item.trigger}
                        </p>
                        <p className="font-mono text-[10px] text-[var(--m-text-faint)] truncate">
                          {item.url}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEdit(i)}
                          className="rounded-lg p-1.5 text-[var(--m-text-faint)] transition-colors hover:bg-[var(--m-accent-soft)] hover:text-[var(--m-accent)]"
                          aria-label="Edit shortcut"
                        >
                          <svg
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(i)}
                          className="rounded-lg p-1.5 text-[var(--m-text-faint)] transition-colors hover:bg-red-950/30 hover:text-red-500/80"
                          aria-label="Delete shortcut"
                        >
                          <svg
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Keyboard ── */}
        {activePage === "keyboard" && (
          <div className="space-y-3">
            <div className="rounded-lg border border-[var(--m-border-subtle)] overflow-hidden">
              {DEFAULT_KEYBINDINGS.map((kb, i) => {
                const current = kbOverrides[kb.id] ?? kb.defaultKey;
                const isOverridden = Boolean(kbOverrides[kb.id]);
                const isCapturing = capturingId === kb.id;

                return (
                  <div
                    key={kb.id}
                    className={`flex items-center gap-3 px-4 py-2.5 ${
                      i < DEFAULT_KEYBINDINGS.length - 1
                        ? "border-b border-[var(--m-border-subtle)]"
                        : ""
                    }`}
                  >
                    {/* Label */}
                    <span className="min-w-[160px] flex-1 text-[12px] text-[var(--m-text)]">
                      {kb.label}
                    </span>

                    {/* Binding chip */}
                    <button
                      type="button"
                      title={isCapturing ? "Press a key combo, or Escape to cancel" : "Click to reassign"}
                      onClick={() => {
                        if (isCapturing) {
                          setCapturingId(null);
                          return;
                        }
                        setCapturingId(kb.id);
                      }}
                      onKeyDown={(e) => {
                        if (!isCapturing) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.key === "Escape") {
                          setCapturingId(null);
                          return;
                        }
                        // Ignore bare modifier presses
                        if (
                          ["Control", "Meta", "Alt", "Shift"].includes(e.key)
                        ) {
                          return;
                        }
                        const combo = formatKeyEvent(e.nativeEvent);
                        const next = { ...kbOverrides, [kb.id]: combo };
                        setKbOverrides(next);
                        saveKeybindings(next);
                        setCapturingId(null);
                      }}
                      className={`inline-flex min-w-[64px] items-center justify-center rounded border px-1.5 py-0.5 font-mono text-[11px] transition-all ${
                        isCapturing
                          ? "animate-pulse border-[#d19a66]/60 bg-[#d19a66]/10 text-[#d19a66] outline-none"
                          : "border-[var(--m-border)] bg-[var(--m-surface-2)] text-[var(--m-text)] hover:border-[#d19a66]/40 hover:bg-[#d19a66]/5"
                      }`}
                    >
                      {isCapturing ? "Press key…" : current}
                    </button>

                    {/* Reset button — only shown when overridden */}
                    <div className="w-[48px] flex items-center justify-end">
                      {isOverridden && (
                        <button
                          type="button"
                          title="Reset to default"
                          onClick={() => {
                            const next = { ...kbOverrides };
                            delete next[kb.id];
                            setKbOverrides(next);
                            saveKeybindings(next);
                            if (capturingId === kb.id) setCapturingId(null);
                          }}
                          className="rounded px-1.5 py-0.5 text-[10px] text-[var(--m-text-faint)] transition-colors hover:text-[var(--m-accent)]"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                resetKeybindings();
                setKbOverrides({});
                setCapturingId(null);
              }}
              className="w-full rounded-lg border border-[var(--m-border)] py-2 text-[11px] text-[var(--m-text-faint)] transition-colors hover:border-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
            >
              Reset all shortcuts
            </button>
          </div>
        )}

        {/* ── Templates ── */}
        {activePage === "templates" && (
          <div className="space-y-2">
            {templates.length === 0 && (
              <p className="text-[12px] text-[var(--m-text-faint)] px-1">
                No templates yet. Add one below.
              </p>
            )}
            {templates.map((t) => (
              <div
                key={t.id}
                className="flex items-start gap-2 rounded-md border border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-2"
              >
                <span className="font-mono text-[12px] text-[#d19a66] min-w-[80px]">
                  /{t.trigger}
                </span>
                <span className="flex-1 text-[11px] text-[var(--m-text-muted)] truncate">
                  {t.label ?? t.prompt.slice(0, 60)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const updated = templates.filter((x) => x.id !== t.id);
                    setTemplates(updated);
                    onSaveTemplates(updated);
                  }}
                  className="text-[var(--m-text-faint)] hover:text-red-400 text-[12px] shrink-0"
                >
                  ×
                </button>
              </div>
            ))}

            {!showAddTemplate ? (
              <button
                type="button"
                onClick={() => setShowAddTemplate(true)}
                className="mt-2 w-full rounded-md border border-dashed border-[var(--m-border)] py-2 text-[11px] text-[var(--m-text-faint)] hover:border-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
              >
                + Add template
              </button>
            ) : (
              <div className="mt-2 rounded-md border border-[var(--m-border)] bg-[var(--m-bg)] p-3 space-y-2">
                <div className="flex gap-2">
                  <div className="flex items-center rounded border border-[var(--m-border)] bg-[var(--m-surface)] px-2 text-[11px] text-[var(--m-text-faint)]">
                    /
                  </div>
                  <input
                    value={newTrigger}
                    onChange={(e) =>
                      setNewTrigger(
                        e.target.value.replace(/\s/g, "").toLowerCase()
                      )
                    }
                    placeholder="trigger"
                    className="flex-1 rounded border border-[var(--m-border)] bg-[var(--m-surface)] px-2 py-1.5 text-[11px] text-[var(--m-text)] outline-none focus:border-[var(--m-text-faint)]"
                  />
                  <input
                    value={newTemplateLabel}
                    onChange={(e) => setNewTemplateLabel(e.target.value)}
                    placeholder="Label (optional)"
                    className="flex-1 rounded border border-[var(--m-border)] bg-[var(--m-surface)] px-2 py-1.5 text-[11px] text-[var(--m-text)] outline-none focus:border-[var(--m-text-faint)]"
                  />
                </div>
                <textarea
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder="Prompt text…"
                  rows={3}
                  className="w-full resize-none rounded border border-[var(--m-border)] bg-[var(--m-surface)] px-2 py-1.5 text-[11px] text-[var(--m-text)] outline-none focus:border-[var(--m-text-faint)]"
                />
                {templateError && (
                  <p className="text-[10px] text-red-400">{templateError}</p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddTemplate(false);
                      setNewTrigger("");
                      setNewTemplateLabel("");
                      setNewPrompt("");
                      setTemplateError("");
                    }}
                    className="text-[11px] text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)] px-3 py-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!newTrigger.trim()) {
                        setTemplateError("Trigger is required");
                        return;
                      }
                      if (!newPrompt.trim()) {
                        setTemplateError("Prompt is required");
                        return;
                      }
                      if (
                        templates.some((t) => t.trigger === newTrigger.trim())
                      ) {
                        setTemplateError("Trigger already exists");
                        return;
                      }
                      const updated = [
                        ...templates,
                        {
                          id: `${Date.now()}-${Math.random()
                            .toString(36)
                            .slice(2)}`,
                          trigger: newTrigger.trim(),
                          label: newTemplateLabel.trim() || undefined,
                          prompt: newPrompt.trim(),
                        },
                      ];
                      setTemplates(updated);
                      onSaveTemplates(updated);
                      setShowAddTemplate(false);
                      setNewTrigger("");
                      setNewTemplateLabel("");
                      setNewPrompt("");
                      setTemplateError("");
                    }}
                    className="rounded border border-[#d19a66]/30 bg-[#d19a66]/10 px-3 py-1 text-[11px] text-[#d19a66] hover:bg-[#d19a66]/20"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Commands ── */}
        {activePage === "commands" && (
          <div className="space-y-6">
            <div>
              <h3 className="mb-2.5 font-mono text-[9px] tracking-[0.2em] text-[var(--m-text-faint)] uppercase">
                Slash Commands
              </h3>
              <div className="rounded-lg border border-[var(--m-border-subtle)] overflow-hidden">
                {SLASH_REF.map((item, i) => (
                  <div
                    key={item.command}
                    className={`flex items-center gap-3 px-4 py-2.5 ${
                      i < SLASH_REF.length - 1 ? "border-b border-[var(--m-border-subtle)]" : ""
                    }`}
                  >
                    <code className="min-w-[100px] font-mono text-[11px] text-[#d19a66]">
                      {item.command}
                    </code>
                    <span className="text-[12px] text-[var(--m-text-muted)]">
                      {item.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2.5 font-mono text-[9px] tracking-[0.2em] text-[var(--m-text-faint)] uppercase">
                Natural Language
              </h3>
              <div className="space-y-3">
                {NATURAL_LANGUAGE_SECTIONS.map((section) => (
                  <div key={section.heading}>
                    <p className="mb-1.5 font-mono text-[9px] tracking-[0.15em] text-[var(--m-text-faint)] uppercase">
                      {section.heading}
                    </p>
                    <div className="rounded-lg border border-[var(--m-border-subtle)] overflow-hidden">
                      {section.items.map((item, i) => (
                        <div
                          key={item}
                          className={`px-4 py-2 ${
                            i < section.items.length - 1
                              ? "border-b border-[var(--m-border-subtle)]"
                              : ""
                          }`}
                        >
                          <code className="font-mono text-[11px] text-[var(--m-text-muted)]">
                            {item}
                          </code>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── About ── */}
        {activePage === "about" && (
          <div className="space-y-5">
            <div className="flex items-center gap-4 rounded-xl border border-[var(--m-border-subtle)] bg-gradient-to-br from-[rgba(209,154,102,0.04)] to-transparent px-5 py-4">
              <MarvenLogo size={44} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[18px] font-semibold tracking-tight text-[var(--m-text)]">
                    Marven
                  </h2>
                  <span className="rounded-full border border-[#d19a66]/30 bg-[#d19a66]/10 px-2 py-0.5 font-mono text-[10px] text-[#d19a66]">
                    v{packageJson.version}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-[var(--m-text-muted)]">
                  Local AI desktop assistant
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-5 py-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg
                    className="h-3.5 w-3.5 text-[#d19a66]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.8}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 12a9 9 0 0115.91-5.79M21 12a9 9 0 01-15.91 5.79M3 7v5h5M21 17v-5h-5"
                    />
                  </svg>
                  <span className="text-[11px] font-medium text-[var(--m-text)]">
                    Software updates
                  </span>
                </div>
                {(updateStatus === "idle" ||
                  updateStatus === "up-to-date" ||
                  updateStatus === "error") && (
                  <button
                    type="button"
                    onClick={handleCheckUpdates}
                    disabled={!electron}
                    className="rounded-md border border-[#d19a66]/25 bg-[#d19a66]/8 px-3 py-1 text-[10px] text-[#d19a66] transition-colors hover:bg-[#d19a66]/15 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Check now
                  </button>
                )}
              </div>

              {updateStatus === "idle" && (
                <p className="text-[11px] text-[var(--m-text-muted)]">
                  Marven checks for updates automatically when it starts.
                </p>
              )}
              {updateStatus === "checking" && (
                <p className="text-[11px] text-[var(--m-text-muted)]">
                  Checking for updates…
                </p>
              )}
              {updateStatus === "up-to-date" && (
                <p className="text-[11px] text-[var(--m-text-muted)]">
                  You&apos;re up to date — running the latest version.
                </p>
              )}
              {updateStatus === "error" && (
                <p className="text-[11px] text-red-400/80 break-all">
                  {updateInfo?.message ?? "Update check failed."}
                </p>
              )}

              {(updateStatus === "progress" || updateStatus === "available") && (
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] text-[var(--m-text-muted)]">
                    <span>
                      {updateStatus === "available"
                        ? `v${updateInfo?.version} — starting download…`
                        : `Downloading v${updateInfo?.version}`}
                    </span>
                    {updateStatus === "progress" && (
                      <span className="font-mono">
                        {updateInfo?.percent ?? 0}%
                      </span>
                    )}
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--m-surface-2)]">
                    <div
                      className="h-full rounded-full bg-[#d19a66] transition-all duration-300"
                      style={{ width: `${updateInfo?.percent ?? 0}%` }}
                    />
                  </div>
                  {updateStatus === "progress" &&
                    updateInfo?.bytesPerSecond && (
                      <div className="flex justify-between font-mono text-[10px] text-[var(--m-text-faint)]">
                        <span>
                          {((updateInfo.transferred ?? 0) / 1024 / 1024).toFixed(
                            1
                          )}{" "}
                          /{" "}
                          {((updateInfo.total ?? 0) / 1024 / 1024).toFixed(1)}{" "}
                          MB
                        </span>
                        <span>
                          {(updateInfo.bytesPerSecond / 1024 / 1024).toFixed(1)}{" "}
                          MB/s
                        </span>
                      </div>
                    )}
                </div>
              )}

              {updateStatus === "ready" && (
                <div className="space-y-2">
                  <p className="text-[11px] text-[#d19a66]">
                    v{updateInfo?.version} is ready to install.
                  </p>
                  <button
                    type="button"
                    onClick={() => electron?.installUpdate()}
                    className="w-full rounded-md border border-[#d19a66]/30 bg-[#d19a66]/10 py-1.5 text-[11px] text-[#d19a66] transition-all hover:bg-[#d19a66]/20"
                  >
                    Restart and install
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <AboutLink
                label="Release notes"
                hint="Changelog on GitHub"
                href="https://github.com/ahomsi0/Marven/releases"
              />
              <AboutLink
                label="Source code"
                hint="github.com/ahomsi0/Marven"
                href="https://github.com/ahomsi0/Marven"
              />
            </div>

            <p className="pt-1 text-center text-[10px] text-[var(--m-text-faint)]">
              Made by Ahmad Homsi · AGPLv3 licensed
            </p>
          </div>
        )}
      </div>
    );
  }

  // ─── Sidebar ─────────────────────────────────────────────────────────────

  function renderSidebar() {
    return (
      <aside className="flex w-[220px] shrink-0 flex-col overflow-y-auto bg-[var(--m-surface)] border-r border-[var(--m-border-subtle)] py-4">
        {SECTIONS.map((section) => (
          <div key={section.heading} className="mb-4">
            <p className="px-4 pb-2 pt-1 font-semibold text-[11px] tracking-[0.18em] text-[var(--m-accent)]/85 uppercase">
              {section.heading}
            </p>
            {section.items.map((item) => {
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActivePage(item.id)}
                  className={`relative w-full text-left px-4 py-2 text-[13px] transition-colors ${
                    isActive
                      ? "bg-[var(--m-surface-2)] text-[var(--m-text)]"
                      : "text-[var(--m-text-muted)] hover:bg-[var(--m-surface)] hover:text-[var(--m-text)]"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </aside>
    );
  }

  // ─── Inner layout (shared between both modes) ─────────────────────────────

  const innerLayout = (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {renderSidebar()}
      {renderPageContent()}
    </div>
  );

  // ─── Inline mode (agent editor tab) ──────────────────────────────────────

  if (inline) {
    return (
      <div className="flex h-full flex-col bg-[var(--m-bg)] overflow-hidden">
        {innerLayout}
      </div>
    );
  }

  // ─── Overlay mode (chat mode popup — full-screen) ─────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 m-auto flex h-[min(680px,92vh)] w-[min(880px,96vw)] flex-col overflow-hidden rounded-xl border border-[var(--m-border-subtle)] bg-[var(--m-bg)] shadow-[0_0_60px_rgba(0,0,0,0.9)]">
        {/* Top bar */}
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--m-border-subtle)] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[var(--m-text-muted)] hover:text-[var(--m-text)] transition-colors"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <h1 className="text-[15px] font-semibold text-[var(--m-text)]">
            Settings
          </h1>
        </div>
        {innerLayout}
      </div>
    </div>
  );
}
