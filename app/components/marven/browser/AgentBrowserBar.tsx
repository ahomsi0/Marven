"use client";

import { useT } from "@/lib/i18n";
import type { AgentActivity, BrowserBridge } from "@/lib/inAppBrowser";
import { MarvenLogo } from "../MarvenLogo";

const BUTTON = "shrink-0 rounded-md border border-[var(--m-border)] px-2 py-0.5 text-[11px] text-[var(--m-text)] hover:bg-[var(--m-surface-2)]";

/**
 * Between the toolbar and the page while an agent run uses the browser: what
 * the agent is doing, with Take over / Resume and Stop. Stop goes to
 * useAgentStream through a window event, like the input bar's Stop.
 */
export function AgentBrowserBar({ bridge, activity }: { bridge: BrowserBridge; activity: AgentActivity }) {
  const { t } = useT();
  const doing = activity.action
    ? t(`browser.agent.actions.${activity.action.kind}`, { target: activity.action.target })
    : t("browser.agent.actions.idle");
  const line =
    activity.state === "acting" ? t("browser.agent.acting", { action: doing })
    : activity.reason === "sign-in" ? t("browser.agent.waitingSignIn")
    : activity.reason === "hidden" ? t("browser.agent.hidden")
    : t("browser.agent.paused");

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--m-border-subtle)] bg-[var(--m-accent)]/10 px-2 text-[12px] text-[var(--m-text)]"
    >
      <MarvenLogo size={14} className={activity.state === "acting" ? "animate-pulse" : ""} />
      <span className="min-w-0 flex-1 truncate" dir="auto">{line}</span>
      {activity.state === "acting" ? (
        <button type="button" className={BUTTON} onClick={() => bridge.agent.takeOver()}>{t("browser.agent.takeOver")}</button>
      ) : activity.reason === "user" ? (
        <button type="button" className={BUTTON} onClick={() => bridge.agent.resume()}>{t("browser.agent.resume")}</button>
      ) : null}
      <button
        type="button"
        className={`${BUTTON} hover:border-red-400/40 hover:text-red-400`}
        onClick={() => window.dispatchEvent(new Event("marven:agent-stop"))}
      >
        {t("browser.agent.stop")}
      </button>
    </div>
  );
}
