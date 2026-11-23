"use client";

import type { RefObject } from "react";
import type { BrainReply, BubbleAction } from "@/hooks/useCompanionBrain";

interface Props {
  reply: BrainReply | null;
  busy: boolean;
  listening: boolean;
  /** A voice problem (e.g. mic permission denied); typing still works. */
  notice: string | null;
  draft: string;
  /** Live speech-to-text while listening; shown as the input placeholder. */
  interim: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onDraftChange: (text: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  /** The user pressed inside the bubble: make the window focusable so they can type. */
  onEngage: () => void;
  onAction: (action: Exclude<BubbleAction, null>) => void;
}

const ACTION_LABELS: Record<Exclude<BubbleAction, null>, string> = {
  retry: "Retry",
  "open-in-marven": "Open in Marven",
  "open-settings": "Open settings",
  "retry-or-settings": "Retry",
};

export function SpeechBubble({ reply, busy, listening, notice, draft, interim, inputRef, onDraftChange, onSubmit, onClose, onEngage, onAction }: Props) {
  const text = reply?.text || (busy ? "…" : "");
  return (
    <div
      data-hit
      onPointerDown={onEngage}
      className="relative w-[320px] rounded-xl border border-[var(--m-border)] bg-[var(--m-surface)] p-3 text-[13px] text-[var(--m-text)] shadow-lg"
    >
      {text && (
        <p className="mb-2 max-h-[84px] overflow-y-auto whitespace-pre-wrap leading-snug">{text}</p>
      )}
      {reply?.done && reply.action && (
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            onClick={() => onAction(reply.action === "retry-or-settings" ? "retry" : (reply.action as Exclude<BubbleAction, null>))}
            className="rounded-md bg-[var(--m-accent)] px-2 py-1 text-[12px] font-medium text-white"
          >
            {ACTION_LABELS[reply.action]}
          </button>
          {reply.action === "retry-or-settings" && (
            <button
              type="button"
              onClick={() => onAction("open-settings")}
              className="rounded-md bg-[var(--m-accent)] px-2 py-1 text-[12px] font-medium text-white"
            >
              {ACTION_LABELS["open-settings"]}
            </button>
          )}
          {reply.action === "open-in-marven" && (
            <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-[12px] text-[var(--m-text-faint)]">
              Not now
            </button>
          )}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          placeholder={listening ? interim || "Listening…" : "Tell me what to do…"}
          className="w-full rounded-md border border-[var(--m-border-subtle)] bg-transparent px-2 py-1.5 outline-none focus:border-[var(--m-accent)]"
          aria-label="Message Mini Me"
        />
      </form>
      {notice && (
        <p className="mt-1.5 text-[11px] text-[var(--m-text-faint)]">
          {notice}
        </p>
      )}
      {/* tail pointing down at the character */}
      <div className="absolute -bottom-[7px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-[var(--m-border)] bg-[var(--m-surface)]" />
    </div>
  );
}
