"use client";

import { useState, useEffect } from "react";
import type { CustomShortcut } from "@/types";

interface SettingsModalProps {
  shortcuts: CustomShortcut[];
  onSave: (shortcuts: CustomShortcut[]) => void;
  onClose: () => void;
}

type TabId = "shortcuts" | "commands" | "api-keys";

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
      'open youtube',
      'open github',
      'google search for ...',
      'any URL (e.g. https://example.com)',
    ],
  },
  {
    heading: "Apps",
    items: [
      'open Chrome',
      'open Terminal',
      'open Spotify',
      'open [any app name]',
    ],
  },
  {
    heading: "System",
    items: [
      "what's the time",
      "today's date",
      'take a screenshot',
      'lock the screen',
      'open my downloads',
      'empty the trash',
    ],
  },
  {
    heading: "Clipboard",
    items: [
      "what's in my clipboard",
      'summarize clipboard',
      'fix my grammar',
    ],
  },
  {
    heading: "Timers",
    items: [
      'set a timer for 5 minutes',
      'timer 30 seconds',
    ],
  },
];

export function SettingsModal({ shortcuts, onSave, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>("shortcuts");
  const [items, setItems] = useState<CustomShortcut[]>(shortcuts.map((s) => ({ ...s })));

  // API Keys tab state
  const [groqKey, setGroqKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [keysSaved, setKeysSaved] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const electron = typeof window !== "undefined" ? (window as any).marvenElectron : null;

  useEffect(() => {
    if (!electron) return;
    electron.getSettings().then((s: any) => {
      if (s.groqApiKey) setGroqKey(s.groqApiKey);
      if (s.ollamaUrl)  setOllamaUrl(s.ollamaUrl);
    });
    electron.getVersion().then(setVersion);
  }, []);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addTrigger, setAddTrigger] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addError, setAddError] = useState("");

  // Edit state
  const [editState, setEditState] = useState<EditState | null>(null);
  const [editError, setEditError] = useState("");

  async function handleSaveKeys() {
    if (!electron) return;
    await electron.saveSettings({ groqApiKey: groqKey.trim(), ollamaUrl: ollamaUrl.trim() });
    setKeysSaved(true);
    setTimeout(() => setKeysSaved(false), 2500);
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
    const next = items.map((item, i) => (i === editState.index ? updated : item));
    saveItems(next);
    setEditState(null);
  }

  const inputClass = "w-full rounded-lg bg-[#252525] border border-[#383838] px-3 py-2 text-[13px] text-[#ccc] outline-none placeholder:text-[#555] focus:border-[#555] transition-colors";

  return (
    <div
      className="fixed inset-0 z-50 flex"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Right panel */}
      <div className="fixed right-0 top-0 h-full w-[420px] max-w-full bg-[#1a1a1a] border-l border-[#333] flex flex-col shadow-[0_0_40px_rgba(0,0,0,0.8)] z-10">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0 border-b border-[#2a2a2a]">
          <div>
            <h2 className="font-mono text-[13px] font-bold tracking-[0.15em] text-[#d19a66] uppercase">
              Settings
            </h2>
            <p className="font-mono text-[9px] tracking-[0.12em] text-[#666] uppercase mt-0.5">
              Configuration Panel
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#666] hover:bg-[#252525] hover:text-[#aaa] transition-colors"
            aria-label="Close settings"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-[#2a2a2a] px-5 shrink-0 bg-[#1e1e1e]">
          {(["shortcuts", "commands", "api-keys"] as TabId[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2.5 font-mono text-[11px] tracking-[0.1em] uppercase transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? "text-[#d19a66] border-[#d19a66]"
                  : "text-[#555] border-transparent hover:text-[#888]"
              }`}
            >
              {tab === "api-keys" ? "API Keys" : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === "shortcuts" && (
            <div>
              {/* Add new button */}
              {!showAddForm ? (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#d19a66]/10 border border-[#d19a66]/30 px-4 py-2.5 font-mono text-[11px] tracking-wider text-[#d19a66] uppercase transition-all hover:bg-[#d19a66]/15 hover:border-[#d19a66]/50"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Add New Shortcut
                </button>
              ) : (
                <div className="mb-4 rounded-lg border border-[#383838] bg-[#252525] p-4 space-y-2.5">
                  <p className="font-mono text-[9px] text-[#666] uppercase tracking-[0.2em] mb-3">New Shortcut</p>
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
                    onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                  />
                  {addError && <p className="text-[11px] text-red-400 font-mono">{addError}</p>}
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
                      onClick={() => { setShowAddForm(false); setAddError(""); setAddLabel(""); setAddTrigger(""); setAddUrl(""); }}
                      className="rounded-lg px-4 py-2 font-mono text-[11px] text-[#555] transition-colors hover:text-[#d19a66/65]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Shortcut list */}
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="mb-3 text-[#555]">
                    <svg className="mx-auto h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <p className="font-mono text-[11px] tracking-wider text-[#555] uppercase">No shortcuts yet.</p>
                  <p className="font-mono text-[10px] text-[#555] mt-1">Add your first one above.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item, i) => {
                    const displayName = item.label || item.trigger;
                    const avatarChar = displayName.charAt(0).toUpperCase();

                    if (editState?.index === i) {
                      return (
                        <div key={i} className="rounded-lg border border-[#383838] bg-[#252525] p-4 space-y-2.5">
                          <p className="font-mono text-[9px] text-[#666] uppercase tracking-[0.2em] mb-3">Edit Shortcut</p>
                          <input
                            type="text"
                            value={editState.label}
                            onChange={(e) => setEditState({ ...editState, label: e.target.value })}
                            placeholder="Label (optional)"
                            className={inputClass}
                          />
                          <input
                            type="text"
                            value={editState.trigger}
                            onChange={(e) => setEditState({ ...editState, trigger: e.target.value })}
                            placeholder="Trigger phrase"
                            className={inputClass}
                          />
                          <input
                            type="text"
                            value={editState.url}
                            onChange={(e) => setEditState({ ...editState, url: e.target.value })}
                            placeholder="URL"
                            className={inputClass}
                            onKeyDown={(e) => { if (e.key === "Enter") handleEditSave(); }}
                          />
                          {editError && <p className="text-[11px] text-red-400 font-mono">{editError}</p>}
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
                              onClick={() => { setEditState(null); setEditError(""); }}
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
                        {/* Avatar */}
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d19a66/10] border border-[#383838] font-mono text-[12px] font-medium text-[#d19a66]">
                          {avatarChar}
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-[#ccc] truncate">{displayName}</p>
                          <p className="font-mono text-[10px] text-[#666] truncate">{item.trigger}</p>
                          <p className="font-mono text-[10px] text-[#444] truncate">{item.url}</p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEdit(i)}
                            className="rounded-lg p-1.5 text-[#555] transition-colors hover:bg-[#d19a66/08] hover:text-[#d19a66]"
                            aria-label="Edit shortcut"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(i)}
                            className="rounded-lg p-1.5 text-[#555] transition-colors hover:bg-red-950/30 hover:text-red-500/80"
                            aria-label="Delete shortcut"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
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

          {activeTab === "api-keys" && (
            <div className="space-y-5">
              {!electron && (
                <div className="rounded-lg border border-[#383838] bg-[#252525] px-4 py-3">
                  <p className="font-mono text-[11px] text-[#666]">API key settings are only available in the packaged app.</p>
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
                  Default: http://localhost:11434 — only change if Ollama runs on a different machine.
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

              {version && (
                <div className="pt-4 border-t border-[#2a2a2a]">
                  <p className="font-mono text-[10px] text-[#444] text-center">Marven v{version}</p>
                </div>
              )}
            </div>
          )}

          {activeTab === "commands" && (
            <div className="space-y-6">
              {/* Slash Commands section */}
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
                      <span className="text-[12px] text-[#888]">{item.description}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Natural language sections */}
              <div>
                <h3 className="mb-2.5 font-mono text-[9px] tracking-[0.2em] text-[#555] uppercase">
                  Natural Language
                </h3>
                <div className="space-y-3">
                  {NATURAL_LANGUAGE_SECTIONS.map((section) => (
                    <div key={section.heading}>
                      <p className="mb-1.5 font-mono text-[9px] tracking-[0.15em] text-[#555] uppercase">{section.heading}</p>
                      <div className="rounded-lg border border-[#2a2a2a] overflow-hidden">
                        {section.items.map((item, i) => (
                          <div
                            key={item}
                            className={`px-4 py-2 ${
                              i < section.items.length - 1 ? "border-b border-[#2a2a2a]" : ""
                            }`}
                          >
                            <code className="font-mono text-[11px] text-[#888]">{item}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
