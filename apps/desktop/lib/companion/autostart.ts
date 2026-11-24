// When the main window may send a request Mini Me handed over with autostart
// ("Open in Marven" on a build). Pure, so the page's effect only applies it.

export interface PendingAutostart {
  convId: string;
  root: string;
  /** The conversation has been the active one at least once. */
  activated: boolean;
  /** After this (ms epoch) the request stops waiting. */
  expiresAt: number;
}

export interface AutostartInput {
  pending: PendingAutostart | null;
  now: number;
  activeConversationId: string | null;
  /** The agent conversation the switch effect last swapped in. */
  lastAgentConvId: string | null;
  mode: "agent" | "chat";
  /** The open workspace. */
  workspaceRoot: string | null;
  /** The trust the Agent run would use, and the folder is really trusted. */
  workspaceTrusted: boolean;
  /** The user's agent settings (safety profile, lite mode) have been read. */
  settingsLoaded: boolean;
  /** An Agent run is going. */
  running: boolean;
  /** Messages in the Agent thread on screen. */
  messageCount: number;
}

/**
 * - "send": everything has settled; send it as if the user pressed Send.
 * - "wait": not yet (or nothing queued).
 * - "drop": forget it (the user moved on, or started the thread themselves).
 * - "fallback": it waited too long; put it in the input instead.
 */
export type AutostartDecision = "wait" | "send" | "drop" | "fallback";

export function autostartDecision(input: AutostartInput): AutostartDecision {
  const { pending } = input;
  if (!pending) return "wait";
  const expired = input.now >= pending.expiresAt;
  if (input.activeConversationId !== pending.convId) {
    // Not opened yet: keep waiting. Opened and then left: the user moved on.
    return pending.activated || expired ? "drop" : "wait";
  }
  if (expired) return input.messageCount === 0 ? "fallback" : "drop";
  if (input.mode !== "agent" || input.lastAgentConvId !== pending.convId) return "wait";
  if (!input.settingsLoaded) return "wait";
  if (input.workspaceRoot !== pending.root || !input.workspaceTrusted) return "wait";
  if (input.running) return "wait";
  // Checked only once the folder is open — well after the switch loaded this
  // conversation's empty thread — so a stale outgoing thread can't count.
  if (input.messageCount > 0) return "drop";
  return "send";
}
