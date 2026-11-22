// Whether one of the agent's browser approval cards is waiting for the user.
// useAgentStream knows (it gets the pending_approval event); the agent strip
// (AgentBrowserBar) shows it, and isn't where the agent's messages are.

const EVENT = "marven:browser-approval-waiting";
let waiting = false;

export function setBrowserApprovalWaiting(value: boolean): void {
  if (waiting === value) return;
  waiting = value;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function isBrowserApprovalWaiting(): boolean {
  return waiting;
}

/** Calls `cb` whenever it changes; returns the unsubscribe (for useSyncExternalStore). */
export function onBrowserApprovalWaiting(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
