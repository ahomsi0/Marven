"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";
import type { VoiceState } from "@/hooks/useVoice";
import { SlashMenu, SLASH_COMMANDS } from "@/app/components/marven/SlashMenu";

interface InputBarProps {
  value: string;
  isLoading: boolean;
  isVoiceSupported: boolean;
  voiceState: VoiceState;
  placeholder?: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onVoiceClick: () => void;
  onSlashCommand?: (cmd: string) => void;
}

export function InputBar({
  value,
  isLoading,
  isVoiceSupported,
  voiceState,
  placeholder = "Message Marven... or type / for commands",
  onChange,
  onSend,
  onVoiceClick,
  onSlashCommand,
}: InputBarProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isListening = voiceState === "command-listening";

  // Slash menu state
  const menuOpen = value.startsWith("/") && !value.includes(" ");
  const query = menuOpen ? value.slice(1) : "";
  const matches = SLASH_COMMANDS.filter((c) => c.command.slice(1).startsWith(query));
  const [menuActiveIdx, setMenuActiveIdx] = useState(0);

  // Reset active index when query changes
  useEffect(() => {
    setMenuActiveIdx(0);
  }, [query]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

  function selectCommand(cmd: string) {
    onSlashCommand?.(cmd);
    onChange("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen && matches.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMenuActiveIdx((i) => (i + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMenuActiveIdx((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = matches[menuActiveIdx];
        if (selected) selectCommand(selected.command);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onChange("");
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <div className="relative">
      {menuOpen && (
        <SlashMenu
          query={query}
          activeIndex={menuActiveIdx}
          onSelect={selectCommand}
          onSetActive={setMenuActiveIdx}
        />
      )}
      <div className="rounded-2xl bg-[#252525] border border-[#383838] p-2 transition-all focus-within:border-[#555]">
        <div className="flex items-center gap-2">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={isLoading}
            className="max-h-36 min-h-[38px] flex-1 resize-none rounded-lg bg-transparent px-3 py-2 text-[13px] leading-6 text-[#d4d4d4] outline-none placeholder:text-[#555] disabled:opacity-60"
            style={{ height: "auto" }}
          />

          {isVoiceSupported && (
            <button
              type="button"
              onClick={onVoiceClick}
              className={`h-9 w-9 shrink-0 rounded-lg transition-all flex items-center justify-center ${
                isListening
                  ? "bg-red-950/20 border border-red-700/40 text-red-400"
                  : "bg-[#252525] border border-[#383838] text-[#777] hover:text-[#ccc] hover:bg-[#2a2a2a]"
              }`}
              title={isListening ? "Stop listening" : "Start voice input"}
              aria-label={isListening ? "Stop listening" : "Start voice input"}
            >
              {isListening ? (
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
                  />
                </svg>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onSend}
            disabled={isLoading || !value.trim()}
            className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center bg-[#d19a66]/10 border border-[#d19a66]/30 text-[#d19a66] transition-all hover:bg-[#d19a66]/20 hover:border-[#d19a66]/50 disabled:cursor-not-allowed disabled:opacity-25"
            aria-label="Send message"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.3} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.25 20.75L20.75 12L3.25 3.25V9.25L13 12L3.25 14.75V20.75Z"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
