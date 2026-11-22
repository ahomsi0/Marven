import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import type { AgentActivity } from "@/lib/inAppBrowser";
import { actionKey } from "./actionText";
import { isolate, marked } from "./isolate";

/**
 * The agent strip's line: what the agent is doing, or why it waits. Between
 * actions it is thinking, unless one of its approval cards is waiting for
 * the user (`approvalWaiting`). The action's target is page text: isolated.
 */
export function agentLine(t: TFunction, activity: AgentActivity, approvalWaiting: boolean): ReactNode {
  if (activity.state === "acting") {
    if (!activity.action && approvalWaiting) return t("browser.agent.waitingApproval");
    const target = activity.action?.target ?? "";
    const doing = activity.action ? t(actionKey(activity.action.kind, target), marked({ target })) : t("browser.agent.actions.idle");
    return isolate(t("browser.agent.acting", { action: doing }), { target });
  }
  if (activity.reason === "sign-in") return t("browser.agent.waitingSignIn");
  if (activity.reason === "hidden") return t("browser.agent.hidden");
  if (activity.reason === "background") return t("browser.agent.background");
  return t("browser.agent.paused");
}
