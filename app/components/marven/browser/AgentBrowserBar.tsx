"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n";
import { isBrowserApprovalWaiting, onBrowserApprovalWaiting } from "@/lib/browserApprovalWait";
import type { AgentActivity, BrowserBridge } from "@/lib/inAppBrowser";
import { MarvenLogo } from "../MarvenLogo";
import { agentLine } from "./agentLine";

const BUTTON = "shrink-0 rounded-md border border-[var(--m-border)] px-2 py-0.5 text-[11px] text-[var(--m-text)] hover:bg-[var(--m-surface-2)]";

/**
 * Between the toolbar and the page while an agent run uses the browser: what
 * the agent is doing, with Take over / Resume and Stop. Stop goes to
 * useAgentStream through a window event, like the input bar's Stop.
 */
export function AgentBrowserBar({ bridge, activity }: { bridge: BrowserBridge; activity: AgentActivity }) {
  const { t } = useT();
  const approvalWaiting = useSyncExternalStore(onBrowserApprovalWaiting, isBrowserApprovalWaiting, () => false);
  const line = agentLine(t, activity, approvalWaiting);

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--m-border-subtle)] bg-[var(--m-accent)]/10 px-2 text-[12px] text-[var(--m-text)]"
    >
      <MarvenLogo size={14} className={activity.state === "acting" ? "animate-pulse" : ""} />
      <span role="status" aria-live="polite" className="min-w-0 flex-1 truncate" dir="auto">{line}</span>
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
