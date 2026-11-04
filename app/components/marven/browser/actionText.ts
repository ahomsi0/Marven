import type { BrowserActionKind } from "@/types";

const HISTORY_ACTIONS = ["back", "forward", "reload"] as const;
type HistoryAction = (typeof HISTORY_ACTIONS)[number];
const isHistoryAction = (target: string): target is HistoryAction => (HISTORY_ACTIONS as readonly string[]).includes(target);

/**
 * The translation key for what the agent is doing ("clicking “{{target}}”").
 * Going back, forward or reloading has a sentence of its own: the target
 * there is the tool's enum, not something to show.
 */
export function actionKey(kind: BrowserActionKind, target: string): `browser.agent.actions.${BrowserActionKind}` | `browser.agent.history.${HistoryAction}` {
  if (kind === "history" && isHistoryAction(target)) return `browser.agent.history.${target}`;
  return `browser.agent.actions.${kind}`;
}
