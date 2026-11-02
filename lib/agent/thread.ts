// lib/agent/thread.ts — pure helpers for the client-side agent message thread
// (used by hooks/useAgentStream). No Node or React imports: runs in the browser.

import type { AgentMessage } from "@/types";

export const SWITCH_CANCEL_NOTE =
  "Cancelled — you switched to another conversation while this was running.";

/**
 * Mark every tool call still in flight as ended, with a short note, so an
 * interrupted run never stays "running" (or waiting on an approval that no
 * longer exists) forever — including after it is saved and reloaded.
 * Plan approvals are client-side and still valid, so they're left alone.
 * Returns the same array when nothing needed changing.
 */
export function cancelInFlightToolCalls(messages: AgentMessage[], note: string): AgentMessage[] {
  let changed = false;
  const next = messages.map((m) => {
    if (!m.toolCalls?.length) return m;
    let msgChanged = false;
    const toolCalls = m.toolCalls.map((tc) => {
      const inFlight =
        tc.status === "running" ||
        tc.status === "pending" ||
        (tc.status === "awaiting_approval" && tc.tool !== "__plan__");
      if (!inFlight) return tc;
      msgChanged = true;
      const partial = tc.output ?? tc.liveOutput ?? "";
      return {
        ...tc,
        status: "error" as const,
        output: partial ? `${partial.replace(/\s+$/, "")}\n\n${note}` : note,
      };
    });
    if (!msgChanged) return m;
    changed = true;
    return { ...m, toolCalls };
  });
  return changed ? next : messages;
}
