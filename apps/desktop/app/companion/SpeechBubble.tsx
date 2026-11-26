"use client";

import type { RefObject } from "react";
import type { BrainReply, BubbleAction } from "@/hooks/useCompanionBrain";
import type { BuildView } from "@/hooks/useCompanionBuild";
import { useT } from "@/lib/i18n";
import { BUBBLE_HIT_OUTSET } from "@/lib/companion/hitRects";
import { BuildCard, buildCardTakesInput, type BuildCardHandlers } from "./BuildCard";

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
  /** A build to show in place of the reply (the host decides when), with its buttons. */
  build: BuildView | null;
  buildHandlers: BuildCardHandlers;
}

const ACTION_LABEL_KEYS: Record<Exclude<BubbleAction, null>, string> = {
  retry: "companion.retry",
  "open-in-marven": "companion.openInMarven",
  "open-in-agent": "companion.openInAgent",
  "open-settings": "companion.openSettings",
  "retry-or-settings": "companion.retry",
};

export function SpeechBubble({ reply, busy, listening, notice, draft, interim, inputRef, onDraftChange, onSubmit, onClose, onEngage, onAction, build, buildHandlers }: Props) {
  const { t: typedT } = useT();
  // Keys here are looked up dynamically, which the typed translator rejects.
  const t = typedT as unknown as (key: string) => string;
  const label = (action: Exclude<BubbleAction, null>) => t(ACTION_LABEL_KEYS[action]);
  const text = build ? "" : reply?.text || (busy ? "…" : "");
  return (
    <div
      data-hit
      // Linux window shape: keep room for the shadow-lg below (see BUBBLE_HIT_OUTSET).
      data-hit-outset={BUBBLE_HIT_OUTSET}
      onPointerDown={onEngage}
      className="relative w-[320px] rounded-xl border border-[var(--m-border)] bg-[var(--m-surface)] p-3 text-[13px] text-[var(--m-text)] shadow-lg"
    >
      {build && <BuildCard view={build} handlers={buildHandlers} />}
      {text && (
        <p className="mb-2 max-h-[84px] overflow-y-auto whitespace-pre-wrap leading-snug">{text}</p>
      )}
      {!build && reply?.done && reply.action && (
        <div className="mb-2 flex gap-2">
          <button
            type="button"
            onClick={() => onAction(reply.action === "retry-or-settings" ? "retry" : (reply.action as Exclude<BubbleAction, null>))}
            className="rounded-md bg-[var(--m-accent)] px-2 py-1 text-[12px] font-medium text-white"
          >
            {label(reply.action)}
          </button>
          {reply.action === "retry-or-settings" && (
            <button
              type="button"
              onClick={() => onAction("open-settings")}
              className="rounded-md bg-[var(--m-accent)] px-2 py-1 text-[12px] font-medium text-white"
            >
              {label("open-settings")}
            </button>
          )}
          {(reply.action === "open-in-marven" || reply.action === "open-in-agent") && (
            <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-[12px] text-[var(--m-text-faint)]">
              {t("companion.notNow")}
            </button>
          )}
        </div>
      )}
      {(!build || buildCardTakesInput(build)) && (
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
            placeholder={listening ? interim || t("companion.listening") : t("companion.placeholder")}
            className="w-full rounded-md border border-[var(--m-border-subtle)] bg-transparent px-2 py-1.5 outline-none focus:border-[var(--m-accent)]"
            aria-label={t("companion.inputLabel")}
          />
        </form>
      )}
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
