"use client";

import { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolCallCard } from "./ToolCallCard";
import { SlashMenu, AGENT_SLASH_COMMANDS } from "./SlashMenu";
import { ModelSelector } from "./ModelSelector";
import { UsageIndicator } from "./UsageIndicator";
import type { AgentMessage, AIProvider, TokenUsage, ImageAttachment, Mention, WorkspaceFile } from "@/types";
import { getActiveTrigger } from "@/lib/mentions/parser";
import { MentionPopup } from "./MentionPopup";
import { MentionChip } from "./MentionChip";

interface AgentPanelProps {
  messages: AgentMessage[];
  input: string;
  isRunning: boolean;
  error: string | null;
  provider: AIProvider;
  selectedModel: string;
  tokenUsage: TokenUsage;
  onProviderChange: (p: AIProvider) => void;
  onModelChange: (m: string) => void;
  onInputChange: (value: string) => void;
  onSend: (opts?: { mentions?: Mention[] }) => void;
  onStop: () => void;
  onSlashCommand: (cmd: string) => void;
  workspaceFiles?: WorkspaceFile[];
  onApproveToolCall?: (callId: string, accept: boolean) => void;
  attachments?: ImageAttachment[];
  onAttachmentsChange?: (attachments: ImageAttachment[]) => void;
  isVoiceSupported?: boolean;
  voiceState?: import("@/hooks/useVoice").VoiceState;
  onVoiceClick?: () => void;
  planMode?: boolean;
  onPlanModeChange?: (v: boolean) => void;
}

function fileToAttachment(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        base64: reader.result as string,
        mimeType: file.type as ImageAttachment["mimeType"],
        name: file.name,
      });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function AgentPanel({
  messages,
  input,
  isRunning,
  error,
  provider,
  selectedModel,
  tokenUsage,
  onProviderChange,
  onModelChange,
  onInputChange,
  onSend,
  onStop,
  onSlashCommand,
  onApproveToolCall,
  attachments,
  onAttachmentsChange,
  isVoiceSupported,
  voiceState,
  onVoiceClick,
  planMode,
  onPlanModeChange,
  workspaceFiles,
}: AgentPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const menuOpen = input.startsWith("/") && !input.includes(" ");
  const query = menuOpen ? input.slice(1) : "";
  const matches = AGENT_SLASH_COMMANDS.filter((c) => c.command.slice(1).startsWith(query));
  const [menuActiveIdx, setMenuActiveIdx] = useState(0);
  const [preferredBrowser, setPreferredBrowser] = useState<string>("default");

  // ── @-mention state ─────────────────────────────────────────────────────
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [mentionPopup, setMentionPopup] = useState<
    { anchor: { x: number; y: number }; query: string; trigger: { startOffset: number } } | null
  >(null);
  const workspaceFilePaths = (workspaceFiles ?? []).map((f) => f.path);

  function updateMentionTrigger() {
    const ta = textareaRef.current;
    if (!ta) { setMentionPopup(null); return; }
    const trig = getActiveTrigger(ta.value, ta.selectionStart);
    if (!trig) { setMentionPopup(null); return; }
    // Anchor: just above the textarea's top-left for v1.
    const rect = ta.getBoundingClientRect();
    setMentionPopup({
      anchor: { x: rect.left, y: rect.top },
      query: trig.query,
      trigger: { startOffset: trig.startOffset },
    });
  }

  function pickMention(m: Mention) {
    const ta = textareaRef.current;
    if (ta && mentionPopup) {
      const cursor = ta.selectionStart;
      const before = ta.value.slice(0, mentionPopup.trigger.startOffset);
      const after = ta.value.slice(cursor);
      onInputChange(before + after);
    }
    setMentions((prev) => [...prev, m]);
    setMentionPopup(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  useEffect(() => {
    const electron = (window as any).marvenElectron;
    if (electron?.getSettings) {
      electron.getSettings().then((s: any) => {
        if (s?.preferredBrowser) setPreferredBrowser(s.preferredBrowser);
      });
    }
  }, []);

  useEffect(() => { setMenuActiveIdx(0); }, [query]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isRunning]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const newAttachments = await Promise.all(files.filter((f) => f.type.startsWith("image/")).map(fileToAttachment));
    if (newAttachments.length > 0) onAttachmentsChange?.([...(attachments ?? []), ...newAttachments]);
    e.target.value = "";
  }

  function selectCommand(cmd: string) {
    onSlashCommand(cmd);
    onInputChange("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen && matches.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMenuActiveIdx((i) => (i + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMenuActiveIdx((i) => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const sel = matches[menuActiveIdx]; if (sel) selectCommand(sel.command); return; }
      if (e.key === "Escape") { e.preventDefault(); onInputChange(""); return; }
    }
    // Backspace at offset 0 with chips → remove last chip.
    if (e.key === "Backspace") {
      const ta = textareaRef.current;
      if (ta && ta.selectionStart === 0 && ta.selectionEnd === 0 && mentions.length > 0) {
        e.preventDefault();
        setMentions((prev) => prev.slice(0, -1));
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      // If the mention popup is open, let it consume Enter via its own listener.
      if (mentionPopup) return;
      e.preventDefault();
      onSend({ mentions });
      setMentions([]);
    }
  }

  return (
    <div className="flex h-full flex-col bg-[var(--m-bg)]">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !isRunning && (
          <p className="text-[12px] text-[var(--m-text-faint)]">
            Open a folder and describe what you want to build or change.
          </p>
        )}

        <div className="flex flex-col gap-4">
          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.isSummary ? (
                <div className="flex items-center gap-3 py-1">
                  <div className="h-px flex-1 bg-[var(--m-border-subtle)]" />
                  <div className="flex items-center gap-1.5 rounded-full border border-[var(--m-border)] bg-[var(--m-surface)] px-3 py-1">
                    <svg className="h-3 w-3 text-[#d19a66]/70" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                    </svg>
                    <span className="text-[10px] text-[var(--m-text-faint)]">Thread summarized</span>
                  </div>
                  <div className="h-px flex-1 bg-[var(--m-border-subtle)]" />
                </div>
              ) : (
                <div>
                  {msg.role === "user" ? (
                    <div className="rounded-md bg-[var(--m-surface-2)] border border-[var(--m-border)] px-3 py-2 text-[12px] text-[var(--m-text)]">
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {msg.attachments.map((att, i) => (
                            <img key={i} src={att.base64} alt={att.name} className="max-h-32 max-w-[200px] rounded border border-[var(--m-border)] object-cover" />
                          ))}
                        </div>
                      )}
                      {msg.content}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {(msg.toolCalls ?? []).map((tc) => (
                        <ToolCallCard key={tc.callId} toolCall={tc} onApprove={onApproveToolCall} />
                      ))}
                      {msg.content && (
                        <div className="prose prose-sm max-w-none text-[12px] text-[var(--m-text)] [&_code]:bg-[var(--m-surface-2)] [&_code]:text-[var(--m-accent)] [&_pre]:bg-[var(--m-surface)] [&_pre]:border [&_pre]:border-[var(--m-border)]">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              a: ({ href, children }) => (
                                <a
                                  href={href}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    if (!href) return;
                                    const electron = (window as any).marvenElectron;
                                    if (electron?.openExternal) {
                                      electron.openExternal(href, preferredBrowser);
                                    } else {
                                      window.open(href, "_blank", "noopener,noreferrer");
                                    }
                                  }}
                                  className="underline decoration-[#d19a66]/40 underline-offset-2 hover:decoration-[#d19a66] cursor-pointer"
                                >
                                  {children}
                                </a>
                              ),
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {isRunning && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--m-text-muted)]">
              <span>Agent running</span>
              {[0, 1, 2].map((i) => (
                <span key={i} className="inline-block h-1 w-1 rounded-full bg-[var(--m-text-faint)]" />
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-700/40 bg-red-950/30 px-3 py-2 text-[11px] text-red-400">
              {error}
            </div>
          )}
        </div>

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 pt-3 pb-2">
        <div
          className="relative flex flex-col overflow-hidden rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)]"
          onDrop={async (e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
            const newAttachments = await Promise.all(files.map(fileToAttachment));
            if (newAttachments.length > 0) onAttachmentsChange?.([...(attachments ?? []), ...newAttachments]);
          }}
          onDragOver={(e) => e.preventDefault()}
        >
          {attachments && attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 border-b border-[var(--m-border-subtle)] px-3 py-2">
              {attachments.map((att, i) => (
                <div key={i} className="group relative h-14 w-14 overflow-hidden rounded-md border border-[var(--m-border)]">
                  <img src={att.base64} alt={att.name} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => onAttachmentsChange?.(attachments.filter((_, j) => j !== i))}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {mentions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2 pb-1">
              {mentions.map((m, i) => (
                <MentionChip
                  key={`${m.kind}-${i}`}
                  mention={m}
                  onRemove={() => setMentions((prev) => prev.filter((_, j) => j !== i))}
                />
              ))}
            </div>
          )}
          {mentionPopup && (
            <MentionPopup
              anchor={mentionPopup.anchor}
              query={mentionPopup.query}
              workspaceFiles={workspaceFilePaths}
              onPick={pickMention}
              onClose={() => setMentionPopup(null)}
            />
          )}
          <div className="relative flex items-center gap-2 px-0 py-0">
            {menuOpen && (
              <SlashMenu
                query={query}
                activeIndex={menuActiveIdx}
                commands={AGENT_SLASH_COMMANDS}
                onSelect={selectCommand}
                onSetActive={setMenuActiveIdx}
              />
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => { onInputChange(e.target.value); setTimeout(updateMentionTrigger, 0); }}
              onKeyUp={updateMentionTrigger}
              onClick={updateMentionTrigger}
              onBlur={() => setTimeout(() => setMentionPopup(null), 150)}
              onKeyDown={handleKeyDown}
              onPaste={async (e) => {
                const items = Array.from(e.clipboardData.items).filter((item) => item.type.startsWith("image/"));
                if (items.length === 0) return;
                e.preventDefault();
                const files = items.map((item) => item.getAsFile()).filter(Boolean) as File[];
                const newAttachments = await Promise.all(files.map(fileToAttachment));
                onAttachmentsChange?.([...(attachments ?? []), ...newAttachments]);
              }}
              disabled={isRunning}
              rows={1}
              placeholder={!input && mentions.length === 0 ? "Describe task… Type @ to attach files, folders, code search, or URLs." : "Describe task…"}
              className="min-h-[36px] flex-1 resize-none border-0 bg-transparent px-3 py-2 text-[12px] text-[var(--m-text)] placeholder-[var(--m-text-faint)] outline-none disabled:opacity-40"
              style={{ maxHeight: 120, overflowY: "auto" }}
            />
            <div className="flex shrink-0 items-center gap-1 pr-1.5">
              <>
                <button
                  type="button"
                  onClick={() => onPlanModeChange?.(!planMode)}
                  title={planMode ? "Plan first: ON (click to disable)" : "Plan first: OFF (click to enable)"}
                  className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] transition-colors ${
                    planMode
                      ? "bg-[#d19a66]/15 text-[#d19a66] border border-[#d19a66]/30"
                      : "text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)] hover:bg-[var(--m-surface-3)]"
                  }`}
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
                  </svg>
                  Plan
                </button>
                {isVoiceSupported && (
                  <button
                    type="button"
                    onClick={onVoiceClick}
                    title={voiceState === "command-listening" ? "Listening…" : "Voice input"}
                    className={`rounded p-1.5 transition-colors ${
                      voiceState === "command-listening"
                        ? "text-red-400 animate-pulse"
                        : "text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)] hover:bg-[var(--m-surface-3)]"
                    }`}
                  >
                    <svg className="h-4 w-4" fill={voiceState === "command-listening" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                    </svg>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach image"
                  className="rounded p-1.5 text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)] hover:bg-[var(--m-surface-3)]"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
              </>
              {isRunning ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-red-700/50 bg-red-950/30 text-red-400 transition-colors hover:border-red-600/60 hover:bg-red-950/50"
                  title="Stop agent"
                >
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="5" y="5" width="14" height="14" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { onSend({ mentions }); setMentions([]); }}
                  disabled={!input.trim() && mentions.length === 0}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--m-border)] bg-[var(--m-bg)] text-[var(--m-accent)] transition-colors hover:border-[var(--m-accent)]/50 disabled:opacity-30"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Status line — below input, like Claude Code */}
        <div className="mt-1.5 flex items-center gap-0.5 pl-0.5">
          <ModelSelector
            provider={provider}
            selectedModel={selectedModel}
            onProviderChange={onProviderChange}
            onModelChange={onModelChange}
          />
          <UsageIndicator usage={tokenUsage} provider={provider} model={selectedModel} />
        </div>
      </div>
    </div>
  );
}
