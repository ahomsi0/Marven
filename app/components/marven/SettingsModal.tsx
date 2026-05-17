"use client";

import { useState, useEffect } from "react";
import type { CustomShortcut, MCPServer, PromptTemplate } from "@/types";
import packageJson from "@/package.json";
import { MarvenLogo } from "./MarvenLogo";

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
  | "api-keys"
  | "connectors"
  | "browser"
  | "shortcuts"
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
      { id: "api-keys", label: "API Keys" },
      { id: "connectors", label: "Connectors" },
      { id: "browser", label: "Browser" },
    ],
  },
  {
    heading: "Customization",
    items: [
      { id: "shortcuts", label: "Shortcuts" },
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
      className="group flex items-start justify-between gap-3 rounded-lg border border-[#2a2a2a] bg-[#181818] px-4 py-3 text-left transition-all hover:border-[#d19a66]/30 hover:bg-[#1c1c1c]"
    >
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-[#d4d4d4] group-hover:text-[#d19a66]">
          {label}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-[#666]">{hint}</div>
      </div>
      <svg
        className="mt-0.5 h-3 w-3 shrink-0 text-[#444] transition-colors group-hover:text-[#d19a66]"
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
  const [activePage, setActivePage] = useState<SettingsPage>("general");
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
    });
    electron.getVersion().then(setVersion);
    const unsub = electron.onUpdateStatus((data: any) => {
      setUpdateStatus(data.type);
      setUpdateInfo(data);
    });
    return unsub;
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

  useEffect(() => {
    if (activePage !== "connectors") return;
    fetch("/api/mcp")
      .then((r) => r.json())
      .then((data) => {
        if (data.status) setMcpStatuses(data.status);
      })
      .catch(() => {});
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

  async function handleSaveKeys() {
    if (!electron) return;
    await electron.saveSettings({
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
    "w-full rounded-lg bg-[#252525] border border-[#383838] px-3 py-2 text-[13px] text-[#ccc] outline-none placeholder:text-[#555] focus:border-[#555] transition-colors";

  // ─── Page content renderer ───────────────────────────────────────────────

  function renderPageContent() {
    const meta = PAGE_META[activePage];

    return (
      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {/* Page header */}
        <div className="mb-6">
          <h2 className="text-[18px] font-semibold text-[#e0e0e0]">
            {meta.title}
          </h2>
          <p className="mt-1 text-[12px] text-[#888]">{meta.description}</p>
        </div>

        {/* ── General ── */}
        {activePage === "general" && (
          <div className="space-y-5">
            <div className="rounded-xl border border-[#2a2a2a] bg-[#181818] px-5 py-4">
              <div className="flex items-center gap-4">
                <MarvenLogo size={44} />
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[16px] font-semibold text-[#e0e0e0]">
                      Marven
                    </span>
                    <span className="rounded-full border border-[#d19a66]/30 bg-[#d19a66]/10 px-2 py-0.5 font-mono text-[10px] text-[#d19a66]">
                      v{packageJson.version}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-[#777]">
                    Marven is a local AI desktop assistant. Your data stays on
                    your machine.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#2a2a2a] bg-[#181818] divide-y divide-[#2a2a2a]">
              <div className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-[13px] text-[#d4d4d4]">Theme</p>
                  <p className="text-[11px] text-[#666]">
                    More themes coming soon
                  </p>
                </div>
                <span className="rounded border border-[#333] bg-[#252525] px-2.5 py-1 text-[11px] text-[#888]">
                  Dark
                </span>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-[13px] text-[#d4d4d4]">Voice &amp; speech</p>
                  <p className="text-[11px] text-[#666]">
                    Configure voice from the input bar
                  </p>
                </div>
                <span className="text-[11px] text-[#555]">Input bar</span>
              </div>
            </div>
          </div>
        )}

        {/* ── API Keys ── */}
        {activePage === "api-keys" && (
          <div className="space-y-5">
            {!electron && (
              <div className="rounded-lg border border-[#383838] bg-[#252525] px-4 py-3">
                <p className="font-mono text-[11px] text-[#666]">
                  API key settings are only available in the packaged app.
                </p>
              </div>
            )}

            <div>
              <label className="block font-mono text-[9px] tracking-[0.2em] text-[#555] uppercase mb-2">
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
              <p className="mt-1.5 font-mono text-[10px] text-[#555]">
                Free at console.groq.com — powers cloud AI chat.
              </p>
            </div>

            <div>
              <label className="block font-mono text-[9px] tracking-[0.2em] text-[#555] uppercase mb-2">
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
              <p className="mt-1.5 font-mono text-[10px] text-[#555]">
                Free credits at build.nvidia.com — access llama-3.1-70b and
                more.
              </p>
            </div>

            <div>
              <label className="block font-mono text-[9px] tracking-[0.2em] text-[#555] uppercase mb-2">
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
              <p className="mt-1.5 font-mono text-[10px] text-[#555]">
                Free at openrouter.ai — access Gemma, Llama, Mistral &amp; more
                at no cost.
              </p>
            </div>

            <div>
              <label className="block font-mono text-[9px] tracking-[0.2em] text-[#555] uppercase mb-2">
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
              <p className="mt-1.5 font-mono text-[10px] text-[#555]">
                Get yours at platform.openai.com — powers GPT-4o and GPT-4o
                mini.
              </p>
            </div>

            <div>
              <label className="block font-mono text-[9px] tracking-[0.2em] text-[#555] uppercase mb-2">
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
              <p className="mt-1.5 font-mono text-[10px] text-[#555]">
                Get yours at console.anthropic.com — powers Claude Sonnet,
                Haiku &amp; Opus.
              </p>
            </div>

            <div>
              <label className="block font-mono text-[9px] tracking-[0.2em] text-[#555] uppercase mb-2">
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
              <p className="mt-1.5 font-mono text-[10px] text-[#555]">
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
              <p className="text-[12px] text-[#555] px-1">
                No MCP servers configured.
              </p>
            )}
            {mcpList.map((server) => (
              <div
                key={server.id}
                className="flex items-center gap-2 rounded-md border border-[#2a2a2a] bg-[#161616] px-3 py-2"
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
                <span className="text-[12px] text-[#d4d4d4] min-w-[80px]">
                  {server.name}
                </span>
                <span className="flex-1 font-mono text-[10px] text-[#555] truncate">
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
                  className="text-[#555] hover:text-red-400 text-[12px] shrink-0 disabled:opacity-30"
                >
                  ×
                </button>
              </div>
            ))}

            {!showAddMCP ? (
              <button
                type="button"
                onClick={() => setShowAddMCP(true)}
                className="mt-2 w-full rounded-md border border-dashed border-[#333] py-2 text-[11px] text-[#555] hover:border-[#555] hover:text-[#888]"
              >
                + Add server
              </button>
            ) : (
              <div className="mt-2 rounded-md border border-[#333] bg-[#161616] p-3 space-y-2">
                <input
                  value={newMcpName}
                  onChange={(e) => setNewMcpName(e.target.value)}
                  placeholder="Name (e.g. filesystem)"
                  className="w-full rounded border border-[#333] bg-[#1e1e1e] px-2 py-1.5 text-[11px] text-[#d4d4d4] outline-none focus:border-[#555]"
                />
                <input
                  value={newMcpCommand}
                  onChange={(e) => setNewMcpCommand(e.target.value)}
                  placeholder="Command (e.g. npx @modelcontextprotocol/server-filesystem ~/)"
                  className="w-full rounded border border-[#333] bg-[#1e1e1e] px-2 py-1.5 text-[11px] font-mono text-[#d4d4d4] outline-none focus:border-[#555]"
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
                    className="text-[11px] text-[#555] hover:text-[#888] px-3 py-1"
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
                      : "border-[#2a2a2a] bg-[#1e1e1e] hover:border-[#383838] hover:bg-[#252525]"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      active
                        ? "border-[#d19a66] bg-[#d19a66]/20"
                        : "border-[#444]"
                    }`}
                  >
                    {active && (
                      <span className="h-2 w-2 rounded-full bg-[#d19a66]" />
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span
                      className={`block font-mono text-[12px] ${
                        active ? "text-[#d19a66]" : "text-[#ccc]"
                      }`}
                    >
                      {label}
                    </span>
                    <span className="block font-mono text-[10px] text-[#555] mt-0.5">
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
              <div className="mb-4 rounded-lg border border-[#383838] bg-[#252525] p-4 space-y-2.5">
                <p className="font-mono text-[9px] text-[#666] uppercase tracking-[0.2em] mb-3">
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
                    className="rounded-lg px-4 py-2 font-mono text-[11px] text-[#555] transition-colors hover:text-[#d19a66/65]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="mb-3 text-[#555]">
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
                <p className="font-mono text-[11px] tracking-wider text-[#555] uppercase">
                  No shortcuts yet.
                </p>
                <p className="font-mono text-[10px] text-[#555] mt-1">
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
                        className="rounded-lg border border-[#383838] bg-[#252525] p-4 space-y-2.5"
                      >
                        <p className="font-mono text-[9px] text-[#666] uppercase tracking-[0.2em] mb-3">
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
                            className="rounded-lg px-4 py-2 font-mono text-[11px] text-[#555] transition-colors hover:text-[#d19a66/65]"
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
                      className="flex items-center gap-3 rounded-lg bg-[#252525] border border-[#2a2a2a] px-4 py-3"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d19a66/10] border border-[#383838] font-mono text-[12px] font-medium text-[#d19a66]">
                        {avatarChar}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-[#ccc] truncate">
                          {displayName}
                        </p>
                        <p className="font-mono text-[10px] text-[#666] truncate">
                          {item.trigger}
                        </p>
                        <p className="font-mono text-[10px] text-[#444] truncate">
                          {item.url}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEdit(i)}
                          className="rounded-lg p-1.5 text-[#555] transition-colors hover:bg-[#d19a66/08] hover:text-[#d19a66]"
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
                          className="rounded-lg p-1.5 text-[#555] transition-colors hover:bg-red-950/30 hover:text-red-500/80"
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

        {/* ── Templates ── */}
        {activePage === "templates" && (
          <div className="space-y-2">
            {templates.length === 0 && (
              <p className="text-[12px] text-[#555] px-1">
                No templates yet. Add one below.
              </p>
            )}
            {templates.map((t) => (
              <div
                key={t.id}
                className="flex items-start gap-2 rounded-md border border-[#2a2a2a] bg-[#161616] px-3 py-2"
              >
                <span className="font-mono text-[12px] text-[#d19a66] min-w-[80px]">
                  /{t.trigger}
                </span>
                <span className="flex-1 text-[11px] text-[#666] truncate">
                  {t.label ?? t.prompt.slice(0, 60)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const updated = templates.filter((x) => x.id !== t.id);
                    setTemplates(updated);
                    onSaveTemplates(updated);
                  }}
                  className="text-[#555] hover:text-red-400 text-[12px] shrink-0"
                >
                  ×
                </button>
              </div>
            ))}

            {!showAddTemplate ? (
              <button
                type="button"
                onClick={() => setShowAddTemplate(true)}
                className="mt-2 w-full rounded-md border border-dashed border-[#333] py-2 text-[11px] text-[#555] hover:border-[#555] hover:text-[#888]"
              >
                + Add template
              </button>
            ) : (
              <div className="mt-2 rounded-md border border-[#333] bg-[#161616] p-3 space-y-2">
                <div className="flex gap-2">
                  <div className="flex items-center rounded border border-[#333] bg-[#1e1e1e] px-2 text-[11px] text-[#555]">
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
                    className="flex-1 rounded border border-[#333] bg-[#1e1e1e] px-2 py-1.5 text-[11px] text-[#d4d4d4] outline-none focus:border-[#555]"
                  />
                  <input
                    value={newTemplateLabel}
                    onChange={(e) => setNewTemplateLabel(e.target.value)}
                    placeholder="Label (optional)"
                    className="flex-1 rounded border border-[#333] bg-[#1e1e1e] px-2 py-1.5 text-[11px] text-[#d4d4d4] outline-none focus:border-[#555]"
                  />
                </div>
                <textarea
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  placeholder="Prompt text…"
                  rows={3}
                  className="w-full resize-none rounded border border-[#333] bg-[#1e1e1e] px-2 py-1.5 text-[11px] text-[#d4d4d4] outline-none focus:border-[#555]"
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
                    className="text-[11px] text-[#555] hover:text-[#888] px-3 py-1"
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
              <h3 className="mb-2.5 font-mono text-[9px] tracking-[0.2em] text-[#555] uppercase">
                Slash Commands
              </h3>
              <div className="rounded-lg border border-[#2a2a2a] overflow-hidden">
                {SLASH_REF.map((item, i) => (
                  <div
                    key={item.command}
                    className={`flex items-center gap-3 px-4 py-2.5 ${
                      i < SLASH_REF.length - 1 ? "border-b border-[#2a2a2a]" : ""
                    }`}
                  >
                    <code className="min-w-[100px] font-mono text-[11px] text-[#d19a66]">
                      {item.command}
                    </code>
                    <span className="text-[12px] text-[#888]">
                      {item.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2.5 font-mono text-[9px] tracking-[0.2em] text-[#555] uppercase">
                Natural Language
              </h3>
              <div className="space-y-3">
                {NATURAL_LANGUAGE_SECTIONS.map((section) => (
                  <div key={section.heading}>
                    <p className="mb-1.5 font-mono text-[9px] tracking-[0.15em] text-[#555] uppercase">
                      {section.heading}
                    </p>
                    <div className="rounded-lg border border-[#2a2a2a] overflow-hidden">
                      {section.items.map((item, i) => (
                        <div
                          key={item}
                          className={`px-4 py-2 ${
                            i < section.items.length - 1
                              ? "border-b border-[#2a2a2a]"
                              : ""
                          }`}
                        >
                          <code className="font-mono text-[11px] text-[#888]">
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
            <div className="flex items-center gap-4 rounded-xl border border-[#2a2a2a] bg-gradient-to-br from-[rgba(209,154,102,0.04)] to-transparent px-5 py-4">
              <MarvenLogo size={44} />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-[18px] font-semibold tracking-tight text-[#e0e0e0]">
                    Marven
                  </h2>
                  <span className="rounded-full border border-[#d19a66]/30 bg-[#d19a66]/10 px-2 py-0.5 font-mono text-[10px] text-[#d19a66]">
                    v{packageJson.version}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-[#777]">
                  Local AI desktop assistant
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-[#2a2a2a] bg-[#181818] px-5 py-4">
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
                  <span className="text-[11px] font-medium text-[#d4d4d4]">
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
                <p className="text-[11px] text-[#666]">
                  Marven checks for updates automatically when it starts.
                </p>
              )}
              {updateStatus === "checking" && (
                <p className="text-[11px] text-[#888]">
                  Checking for updates…
                </p>
              )}
              {updateStatus === "up-to-date" && (
                <p className="text-[11px] text-[#888]">
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
                  <div className="flex justify-between text-[10px] text-[#888]">
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
                  <div className="h-1 w-full overflow-hidden rounded-full bg-[#252525]">
                    <div
                      className="h-full rounded-full bg-[#d19a66] transition-all duration-300"
                      style={{ width: `${updateInfo?.percent ?? 0}%` }}
                    />
                  </div>
                  {updateStatus === "progress" &&
                    updateInfo?.bytesPerSecond && (
                      <div className="flex justify-between font-mono text-[10px] text-[#555]">
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

            <p className="pt-1 text-center text-[10px] text-[#444]">
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
      <aside className="flex w-[220px] shrink-0 flex-col overflow-y-auto bg-[#181818] border-r border-[#2a2a2a] py-4">
        {SECTIONS.map((section) => (
          <div key={section.heading} className="mb-4">
            <p className="px-4 pb-2 pt-1 font-semibold text-[11px] tracking-[0.18em] text-[#d19a66]/85 uppercase">
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
                      ? "bg-[#252525] text-[#e0e0e0]"
                      : "text-[#888] hover:bg-[#1e1e1e] hover:text-[#d4d4d4]"
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
      <div className="flex h-full flex-col bg-[#1a1a1a] overflow-hidden">
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
      <div className="relative z-10 m-auto flex h-[min(680px,92vh)] w-[min(880px,96vw)] flex-col overflow-hidden rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] shadow-[0_0_60px_rgba(0,0,0,0.9)]">
        {/* Top bar */}
        <div className="flex shrink-0 items-center gap-3 border-b border-[#2a2a2a] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-[#888] hover:text-[#d4d4d4] transition-colors"
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
          <h1 className="text-[15px] font-semibold text-[#e0e0e0]">
            Settings
          </h1>
        </div>
        {innerLayout}
      </div>
    </div>
  );
}
