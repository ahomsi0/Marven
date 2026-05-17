"use client";

import { KeyboardEvent, useEffect, useRef, useState, Fragment } from "react";
import type { VoiceState } from "@/hooks/useVoice";
import type { AIProvider, ImageAttachment, PromptTemplate } from "@/types";
import { SlashMenu, SLASH_COMMANDS } from "@/app/components/marven/SlashMenu";
import { GroupedModelDropdown } from "@/app/components/marven/GroupedModelDropdown";

const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

interface InputBarProps {
  value: string;
  isLoading: boolean;
  isVoiceSupported: boolean;
  voiceState: VoiceState;
  placeholder?: string;
  provider: AIProvider;
  selectedModel: string;
  speechEnabled: boolean;
  wakeEnabled: boolean;
  voiceError: string | null;
  lastHeard: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onVoiceClick: () => void;
  onSlashCommand?: (cmd: string) => void;
  onProviderChange: (p: AIProvider) => void;
  onModelChange: (m: string) => void;
  onToggleSpeech: () => void;
  onToggleWakeWord: () => void;
  attachments?: ImageAttachment[];
  onAttachmentsChange?: (attachments: ImageAttachment[]) => void;
  promptTemplates?: PromptTemplate[];
}

export function InputBar({
  value,
  isLoading,
  isVoiceSupported,
  voiceState,
  placeholder = "Message Marven... or type / for commands",
  provider,
  selectedModel,
  speechEnabled,
  wakeEnabled,
  voiceError,
  lastHeard,
  onChange,
  onSend,
  onVoiceClick,
  onSlashCommand,
  onProviderChange,
  onModelChange,
  onToggleSpeech,
  onToggleWakeWord,
  attachments,
  onAttachmentsChange,
  promptTemplates,
}: InputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isListening = voiceState === "command-listening";

  const menuOpen = value.startsWith("/") && !value.includes(" ");
  const query = menuOpen ? value.slice(1) : "";
  const builtinMatches = SLASH_COMMANDS.filter((c) => c.command.slice(1).startsWith(query));
  const templateMatches = (promptTemplates ?? []).filter((t) => t.trigger.startsWith(query));
  const matches = [...builtinMatches, ...templateMatches];
  const [menuActiveIdx, setMenuActiveIdx] = useState(0);

  useEffect(() => { setMenuActiveIdx(0); }, [query]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

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

  async function addFiles(files: FileList | File[]) {
    const imageFiles = Array.from(files).filter(
      (f) => ALLOWED_MIME_TYPES.includes(f.type as typeof ALLOWED_MIME_TYPES[number]) && f.size <= MAX_BYTES
    );
    if (!imageFiles.length) return;
    const newAttachments = await Promise.all(imageFiles.map(fileToAttachment));
    onAttachmentsChange?.([...(attachments ?? []), ...newAttachments]);
  }

  function selectCommand(cmd: string) {
    if (cmd.startsWith("/template:")) {
      const trigger = cmd.slice("/template:".length);
      const tmpl = promptTemplates?.find((t) => t.trigger === trigger);
      if (tmpl) {
        onChange(tmpl.prompt);
        textareaRef.current?.focus();
        return;
      }
    }
    onSlashCommand?.(cmd);
    onChange("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen && matches.length > 0) {
      if (event.key === "ArrowDown") { event.preventDefault(); setMenuActiveIdx((i) => (i + 1) % matches.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setMenuActiveIdx((i) => (i - 1 + matches.length) % matches.length); return; }
      if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); const sel = matches[menuActiveIdx]; if (sel) { const cmd = "command" in sel ? sel.command : `/template:${sel.trigger}`; selectCommand(cmd); } return; }
      if (event.key === "Escape") { event.preventDefault(); onChange(""); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (value.trim() || (attachments && attachments.length > 0)) onSend(); }
  }

  return (
    <div
      className="relative"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault();
        await addFiles(e.dataTransfer.files);
      }}
    >
      {menuOpen && (
        <SlashMenu
          query={query}
          activeIndex={menuActiveIdx}
          promptTemplates={promptTemplates}
          onSelect={selectCommand}
          onSetActive={setMenuActiveIdx}
        />
      )}
      <div className="rounded-2xl bg-[var(--m-surface-2)] border border-[var(--m-border)] transition-all focus-within:border-[var(--m-text-faint)]">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={async (e) => {
            if (e.target.files) await addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {/* Attachment preview strip */}
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-2">
            {attachments.map((att, i) => (
              <div key={`${att.name}-${att.base64.slice(-8)}`} className="relative">
                <img
                  src={att.base64}
                  alt={att.name}
                  title={att.name}
                  className="h-11 w-11 rounded object-cover border border-[#444]"
                />
                <button
                  type="button"
                  onClick={() =>
                    onAttachmentsChange?.(attachments.filter((_, j) => j !== i))
                  }
                  className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#555] text-[#eee] text-[9px] hover:bg-[#888]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-center gap-2 p-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={async (e) => {
              const items = Array.from(e.clipboardData.items);
              const imageItems = items.filter((item) => item.type.startsWith("image/"));
              if (!imageItems.length) return;
              e.preventDefault();
              const files = imageItems
                .map((item) => item.getAsFile())
                .filter(Boolean) as File[];
              await addFiles(files);
            }}
            placeholder={placeholder}
            disabled={isLoading}
            className="max-h-36 min-h-[38px] flex-1 resize-none rounded-lg bg-transparent px-3 py-2 text-[13px] leading-6 text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] disabled:opacity-60"
            style={{ height: "auto" }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            title="Attach image"
            className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center bg-[var(--m-surface-2)] border border-[var(--m-border)] text-[var(--m-text-muted)] transition-all hover:text-[var(--m-text)] hover:bg-[var(--m-surface-3)] disabled:opacity-30"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
            </svg>
          </button>

          {isVoiceSupported && (
            <button
              type="button"
              onClick={onVoiceClick}
              className={`h-9 w-9 shrink-0 rounded-lg transition-all flex items-center justify-center ${
                isListening
                  ? "bg-red-950/20 border border-red-700/40 text-red-400"
                  : "bg-[var(--m-surface-2)] border border-[var(--m-border)] text-[var(--m-text-muted)] hover:text-[var(--m-text)] hover:bg-[var(--m-surface-3)]"
              }`}
              title={isListening ? "Stop listening" : "Start voice input"}
            >
              {isListening ? (
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onSend}
            disabled={isLoading || (!value.trim() && !(attachments && attachments.length > 0))}
            className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center bg-[#d19a66]/10 border border-[#d19a66]/30 text-[#d19a66] transition-all hover:bg-[#d19a66]/20 hover:border-[#d19a66]/50 disabled:cursor-not-allowed disabled:opacity-25"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.3} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.25 20.75L20.75 12L3.25 3.25V9.25L13 12L3.25 14.75V20.75Z" />
            </svg>
          </button>
        </div>

        {/* Bottom strip */}
        <div className="flex items-center border-t border-[var(--m-border-subtle)] px-3 py-1">
          <GroupedModelDropdown
            provider={provider}
            selectedModel={selectedModel}
            onProviderChange={onProviderChange}
            onModelChange={onModelChange}
          />

          <div className="ml-auto flex items-center">
            <button
              type="button"
              onClick={onToggleSpeech}
              className={`px-1.5 py-0.5 text-[10px] transition-all ${
                speechEnabled ? "text-[var(--m-accent)]" : "text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
              }`}
            >
              {speechEnabled ? "Speech on" : "Speech off"}
            </button>
            <span className="text-[var(--m-border-subtle)] text-[10px]">/</span>
            <button
              type="button"
              onClick={onToggleWakeWord}
              disabled={!isVoiceSupported}
              title={voiceError ?? undefined}
              className={`px-1.5 py-0.5 text-[10px] transition-all disabled:opacity-30 ${
                wakeEnabled
                  ? voiceState === "command-listening" ? "text-[#f87171]" : "text-[var(--m-accent)]"
                  : "text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
              }`}
            >
              {isVoiceSupported ? (wakeEnabled ? "Wake on" : "Wake off") : "Voice n/a"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
