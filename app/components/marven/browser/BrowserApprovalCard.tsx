"use client";

import { Fragment } from "react";
import { useT } from "@/lib/i18n";
import { actionKey } from "./actionText";
import { isolate, marked } from "./isolate";
import type { ApprovalScope, BrowserApprovalPreview } from "@/types";

interface BrowserApprovalCardProps {
  callId: string;
  approval: BrowserApprovalPreview;
  secondsLeft: number;
  onApprove?: (callId: string, accept: boolean, scope?: ApprovalScope) => void;
}

const BUTTON = "rounded-md border px-2 py-0.5 text-[10px]";

/**
 * Asks before the agent acts on a site, or submits a form there. The host,
 * the element's name and the form's fields come from the page: React renders
 * them as plain text.
 */
export function BrowserApprovalCard({ callId, approval, secondsLeft, onApprove }: BrowserApprovalCardProps) {
  const { t } = useT();
  const answer = (accept: boolean, scope?: ApprovalScope) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onApprove?.(callId, accept, scope);
  };
  const shown = (value: string) => (value === "(hidden)" ? t("browser.agent.approval.hidden") : value);
  const values = { host: approval.host, target: approval.target };
  const m = marked(values);
  const action = t(actionKey(approval.action, approval.target), m);
  const title = approval.kind === "submit" ? "browser.agent.approval.submitTitle" : "browser.agent.approval.siteTitle";

  return (
    <div className="space-y-2 border-t border-[var(--m-border-subtle)] px-3 py-2">
      <p className="text-[12px] text-[var(--m-text)]">{isolate(t(title, m), values)}</p>
      <p className="text-[11px] text-[var(--m-text-muted)]" dir="auto">{isolate(t("browser.agent.approval.next", { action }), values)}</p>
      {approval.kind === "submit" && approval.fields && approval.fields.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[var(--m-text-faint)]">{t("browser.agent.approval.fields")}</p>
          <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]">
            {approval.fields.map((field, i) => (
              <Fragment key={i}>
                <dt className="max-w-[10rem] [overflow-wrap:anywhere] text-[var(--m-text-muted)]" dir="auto" title={field.name}>{field.name}</dt>
                <dd className="[overflow-wrap:anywhere] text-[var(--m-text)]" dir="auto" title={shown(field.value)}>
                  {shown(field.value)}
                </dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] text-[var(--m-accent)]">
          {secondsLeft > 0 ? t("browser.agent.approval.timeLeft", { n: secondsLeft }) : t("browser.agent.approval.timedOut")}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={answer(false)} className={`${BUTTON} border-[var(--m-border)] text-[var(--m-text-muted)] hover:border-red-400/40 hover:text-red-400`}>
            {t("browser.agent.approval.deny")}
          </button>
          {approval.kind === "site" ? (
            <>
              <button type="button" onClick={answer(true, "once")} className={`${BUTTON} border-[var(--m-accent)]/30 text-[var(--m-accent)] hover:bg-[var(--m-accent)]/10`}>
                {t("browser.agent.approval.allowOnce")}
              </button>
              <button type="button" onClick={answer(true, "site")} className={`${BUTTON} border-[var(--m-accent)]/30 bg-[var(--m-accent)]/10 text-[var(--m-accent)] hover:bg-[var(--m-accent)]/20`}>
                {t("browser.agent.approval.allowSite")}
              </button>
            </>
          ) : (
            <button type="button" onClick={answer(true, "once")} className={`${BUTTON} border-[var(--m-accent)]/30 bg-[var(--m-accent)]/10 text-[var(--m-accent)] hover:bg-[var(--m-accent)]/20`}>
              {t("browser.agent.approval.submit")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
