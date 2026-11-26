"use client";

// The bubble's view of a build or change: one calm progress line with a step
// counter (and what's queued next) while the Agent works, a card when it needs
// the user, and the result with the preview one click away.

import type { ReactNode } from "react";
import type { BuildView } from "@/hooks/useCompanionBuild";
import type { CompanionSettingsPage } from "@/lib/companion/bridge";
import { useT } from "@/lib/i18n";

export interface BuildCardHandlers {
  onStop: () => void;
  onAnswer: (accept: boolean) => void;
  /** Open (or bring up) the preview window on this project. */
  onShowPreview: () => void;
  onOpenInMarven: () => void;
  onOpenSettings: (page: CompanionSettingsPage) => void;
  /** Close the bubble (the × on a result). */
  onClose: () => void;
}

const primary = "rounded-md bg-[var(--m-accent)] px-2 py-1 text-[12px] font-medium text-white disabled:opacity-60";
const secondary =
  "rounded-md border border-[var(--m-border-subtle)] px-2 py-1 text-[12px] text-[var(--m-text)] hover:border-[var(--m-border)] disabled:opacity-60";
const quiet = "rounded-md px-2 py-1 text-[12px] text-[var(--m-text-faint)] hover:text-[var(--m-text)]";

function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="-me-1 -mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--m-text-faint)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
    >
      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-[var(--m-border-subtle)] text-[var(--m-text-muted)] hover:border-[var(--m-border)] hover:text-[var(--m-text)]"
    >
      {children}
    </button>
  );
}

/** Marven's window with its sidebar: "Open in Marven". */
function MarvenIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

/** The bubble's text input stays, except while an approval asks something (the bubble has little height to spare). */
export function buildCardTakesInput(view: BuildView): boolean {
  return !view.approval;
}

export function BuildCard({ view, handlers }: { view: BuildView; handlers: BuildCardHandlers }) {
  const { t: typedT } = useT();
  // Keys come from state (progress labels), which the typed translator rejects.
  const t = typedT as unknown as (key: string, opts?: Record<string, unknown>) => string;
  const { phase, name, approval } = view;
  const running = phase === "preparing" || phase === "running";
  const canShowProject = !!view.root && (phase === "done" || view.steps > 0 || view.edit);
  const queued = view.queue.length > 0 && (
    <div className="mt-1 space-y-0.5">
      {view.queue.map((request, i) => (
        <p key={i} className="truncate text-[11px] text-[var(--m-text-muted)]" title={request}>
          {t("companion.build.next", { request })}
        </p>
      ))}
    </div>
  );

  if (running) {
    return (
      <div className={approval ? "" : "mb-2"} aria-live="polite">
        <div className="mb-1 flex items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--m-accent)] opacity-40" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--m-accent)]" />
          </span>
          {/* While asking, the question takes the title's place: the bubble has little height to spare. */}
          <span className="min-w-0 flex-1 truncate font-medium">
            {approval ? t(`companion.build.ask.${approval.kind}`) : t(view.edit ? "companion.build.editing" : "companion.build.building", { name })}
          </span>
          {view.steps > 0 && (
            <span className="shrink-0 text-[11px] tabular-nums text-[var(--m-text-faint)]">{t("companion.build.stepCount", { n: view.steps })}</span>
          )}
        </div>
        {approval ? (
          <>
            {approval.runsProjectCode && (
              <p className="mb-1 text-[11px] leading-snug text-[var(--m-text-muted)]">{t("companion.build.runsProjectCode")}</p>
            )}
            {approval.detail && (
              <div
                dir="ltr"
                className="mb-1.5 max-h-[64px] overflow-y-auto rounded-md bg-[var(--m-surface-2)] px-2 py-1 font-mono text-[11.5px] leading-snug"
              >
                <p className="whitespace-pre-wrap break-all">{approval.detail}</p>
                {approval.scripts && (
                  <>
                    <p className="mt-1 border-t border-[var(--m-border-subtle)] pt-1 font-sans text-[10.5px] text-[var(--m-text-faint)]">
                      {t("companion.build.scriptsLabel")}
                    </p>
                    <p className="whitespace-pre-wrap break-all text-[var(--m-text-muted)]">{approval.scripts}</p>
                  </>
                )}
              </div>
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
          <>
            <p className="truncate ps-4 text-[12px] text-[var(--m-text-faint)]" title={t(view.label.key, view.label.params)}>
              {t(view.label.key, view.label.params)}
            </p>
            {queued}
            <div className="mt-1.5 flex items-center gap-1.5">
              {canShowProject && (
                <button type="button" onClick={handlers.onShowPreview} className={secondary}>
                  {t("companion.build.showPreview")}
                </button>
              )}
              <button type="button" onClick={handlers.onStop} className={`${quiet} ms-auto`}>
                {t("companion.build.stop")}
              </button>
            </div>
            {view.note && <p className="mt-1 text-[11px] leading-snug text-[var(--m-text-muted)]">{view.note}</p>}
          </>
        )}
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="mb-2">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate font-medium leading-snug">
            {t(view.edit ? "companion.build.editDoneTitle" : "companion.build.doneTitle", { name })}
          </p>
          <CloseButton label={t("companion.build.close")} onClick={handlers.onClose} />
        </div>
        {view.summary && (
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--m-text-muted)]" title={view.summary}>
            {view.summary}
          </p>
        )}
        {queued}
        <div className="mt-2 flex items-center gap-1.5">
          <button type="button" onClick={handlers.onShowPreview} className={primary}>
            {t("companion.build.showPreview")}
          </button>
          <IconButton label={t("companion.build.openInMarven")} onClick={handlers.onOpenInMarven}>
            <MarvenIcon />
          </IconButton>
        </div>
      </div>
    );
  }

  // failed, stopped, blocked
  const title =
    phase === "stopped" ? t("companion.build.stoppedTitle", { name }) : phase === "failed" ? t("companion.build.failedTitle", { name }) : t("companion.build.blockedTitle");
  const body = phase === "stopped" ? (canShowProject ? t("companion.build.stoppedHint") : "") : view.error ?? "";
  return (
    <div className="mb-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 font-medium leading-snug">{title}</p>
        <CloseButton label={t("companion.build.close")} onClick={handlers.onClose} />
      </div>
      {body && <p className="mt-0.5 max-h-[50px] overflow-y-auto whitespace-pre-wrap text-[12px] leading-snug">{body}</p>}
      {queued}
      {(view.settingsPage || canShowProject) && (
        <div className="mt-2 flex items-center gap-1.5">
          {view.settingsPage && (
            <button type="button" onClick={() => handlers.onOpenSettings(view.settingsPage!)} className={primary}>
              {t("companion.openSettings")}
            </button>
          )}
          {canShowProject && (
            <>
              <button type="button" onClick={handlers.onShowPreview} className={view.settingsPage ? secondary : primary}>
                {t("companion.build.showPreview")}
              </button>
              <IconButton label={t("companion.build.openInMarven")} onClick={handlers.onOpenInMarven}>
                <MarvenIcon />
              </IconButton>
            </>
          )}
        </div>
      )}
    </div>
  );
}
