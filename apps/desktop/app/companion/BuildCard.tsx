"use client";

// The bubble's view of a "Build it here" run: one calm progress line with a
// step counter while the Agent works, a card when it needs the user, and the
// result with ways to open it.

import type { BuildView } from "@/hooks/useCompanionBuild";
import { useT } from "@/lib/i18n";

export interface BuildCardHandlers {
  onStop: () => void;
  onAnswer: (accept: boolean) => void;
  onKeepGoing: () => void;
  onOpenFolder: () => void;
  onOpenInMarven: () => void;
  onOpenUrl: (url: string) => void;
  onOpenSettings: () => void;
}

const primary = "rounded-md bg-[var(--m-accent)] px-2 py-1 text-[12px] font-medium text-white disabled:opacity-60";
const secondary =
  "rounded-md border border-[var(--m-border-subtle)] px-2 py-1 text-[12px] text-[var(--m-text)] hover:border-[var(--m-border)] disabled:opacity-60";
const quiet = "rounded-md px-2 py-1 text-[12px] text-[var(--m-text-faint)] hover:text-[var(--m-text)]";

/** "Marven Projects/cafe-menu": the last two parts of the folder, for a short "where" line. */
function shortFolder(root: string): string {
  return root.replace(/\\/g, "/").split("/").filter(Boolean).slice(-2).join("/");
}

/** "localhost:5173" for the button label. */
function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The bubble's text input is hidden while the card asks something or shows a result, to keep the bubble small. */
export function buildCardTakesInput(view: BuildView): boolean {
  return (view.phase === "preparing" || view.phase === "running") && !view.approval && !view.conflict;
}

export function BuildCard({ view, handlers }: { view: BuildView; handlers: BuildCardHandlers }) {
  const { t: typedT } = useT();
  // Keys come from state (progress labels), which the typed translator rejects.
  const t = typedT as unknown as (key: string, opts?: Record<string, unknown>) => string;
  const { phase, name, approval, conflict } = view;
  const running = phase === "preparing" || phase === "running";

  if (running && conflict) {
    return (
      <div>
        <p className="mb-2 leading-snug">{t("companion.build.conflict", { name })}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handlers.onStop} className={primary}>
            {t("companion.build.stop")}
          </button>
          <button type="button" onClick={handlers.onKeepGoing} className={quiet}>
            {t("companion.build.keepGoing")}
          </button>
        </div>
      </div>
    );
  }

  if (running) {
    return (
      <div className={approval ? "" : "mb-2"} aria-live="polite">
        <div className="mb-1 flex items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--m-accent)] opacity-40" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--m-accent)]" />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{t("companion.build.building", { name })}</span>
          {view.steps > 0 && (
            <span className="shrink-0 text-[11px] tabular-nums text-[var(--m-text-faint)]">{t("companion.build.stepCount", { n: view.steps })}</span>
          )}
        </div>
        {approval ? (
          <>
            <p className="mb-1 leading-snug">{t(`companion.build.ask.${approval.kind}`)}</p>
            {approval.detail && (
              <p
                dir="ltr"
                className="mb-2 max-h-[40px] overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-[var(--m-surface-2)] px-2 py-1 font-mono text-[11.5px] leading-snug"
              >
                {approval.detail}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button type="button" disabled={approval.sending} onClick={() => handlers.onAnswer(true)} className={primary}>
                {t("companion.build.allow")}
              </button>
              <button type="button" disabled={approval.sending} onClick={() => handlers.onAnswer(false)} className={secondary}>
                {t("companion.build.deny")}
              </button>
              <button type="button" onClick={handlers.onStop} className={`${quiet} ms-auto`}>
                {t("companion.build.stop")}
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[12px] text-[var(--m-text-faint)]" title={t(view.label.key, view.label.params)}>
              {t(view.label.key, view.label.params)}
            </p>
            <button type="button" onClick={handlers.onStop} className={`${secondary} shrink-0`}>
              {t("companion.build.stop")}
            </button>
          </div>
        )}
      </div>
    );
  }

  const where = view.root ? t("companion.build.savedIn", { folder: shortFolder(view.root) }) : "";
  const canOpenProject = !!view.root && (phase === "done" || view.steps > 0);

  if (phase === "done") {
    return (
      <div>
        <p className="truncate font-medium leading-snug">{t("companion.build.doneTitle", { name })}</p>
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--m-text-faint)]">
          {where && <span className="min-w-0 truncate">{where}</span>}
          {where && view.liveUrl && <span aria-hidden>·</span>}
          {view.liveUrl && (
            <button
              type="button"
              onClick={() => handlers.onOpenUrl(view.liveUrl!)}
              title={view.liveUrl}
              className="shrink-0 font-medium text-[var(--m-accent)] hover:underline"
            >
              {t("companion.build.openUrl", { host: hostLabel(view.liveUrl) })}
            </button>
          )}
        </div>
        <p className="mb-2 max-h-[50px] overflow-y-auto whitespace-pre-wrap text-[12px] leading-snug text-[var(--m-text-muted)]">
          {view.summary || t("companion.build.emptySummary")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={handlers.onOpenFolder} className={primary}>
            {t("companion.build.openFolder")}
          </button>
          <button type="button" onClick={handlers.onOpenInMarven} className={secondary}>
            {t("companion.build.openInMarven")}
          </button>
        </div>
      </div>
    );
  }

  // failed, stopped, blocked
  const title =
    phase === "stopped" ? t("companion.build.stoppedTitle", { name }) : phase === "failed" ? t("companion.build.failedTitle", { name }) : "";
  const body = phase === "stopped" ? (canOpenProject ? t("companion.build.stoppedHint") : "") : view.error ?? "";
  return (
    <div>
      {title && <p className="font-medium leading-snug">{title}</p>}
      {body && <p className="mb-2 max-h-[50px] overflow-y-auto whitespace-pre-wrap text-[12px] leading-snug">{body}</p>}
      {(view.settingsHint || canOpenProject) && (
        <div className="flex flex-wrap gap-1.5">
          {view.settingsHint && (
            <button type="button" onClick={handlers.onOpenSettings} className={primary}>
              {t("companion.openSettings")}
            </button>
          )}
          {canOpenProject && (
            <>
              <button type="button" onClick={handlers.onOpenFolder} className={view.settingsHint ? secondary : primary}>
                {t("companion.build.openFolder")}
              </button>
              <button type="button" onClick={handlers.onOpenInMarven} className={secondary}>
                {t("companion.build.openInMarven")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
