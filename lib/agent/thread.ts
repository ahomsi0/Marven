// lib/agent/thread.ts — pure helpers for the client-side agent message thread
// (used by hooks/useAgentStream). No Node or React imports: runs in the browser.

import type { AgentMessage, ImageAttachment } from "@/types";

export const SUMMARIZE_THRESHOLD = 30; // auto-summarize when thread exceeds this many messages
export const KEEP_RECENT = 10; // always keep this many recent messages uncompressed

/**
 * Split a thread (already including the new user + empty assistant turn) into
 * the part to summarize and the recent window to keep, or null when it's
 * short enough to send as-is. Works only on the thread it's given, so a caller
 * that truncated the thread (message edit) can't get removed turns back.
 */
export function condenseWindow(
  threadWithTurn: AgentMessage[],
): { oldMessages: AgentMessage[]; recentMessages: AgentMessage[] } | null {
  if (threadWithTurn.length <= SUMMARIZE_THRESHOLD) return null;
  return {
    oldMessages: threadWithTurn.slice(0, threadWithTurn.length - KEEP_RECENT),
    recentMessages: threadWithTurn.slice(threadWithTurn.length - KEEP_RECENT),
  };
}

export interface WireHistoryRow {
  role: "user" | "assistant";
  content: string;
  attachments?: ImageAttachment[];
}

/**
 * History sent to /api/agent/stream. Excludes the trailing user + assistant
 * pair of the current turn — the stream route appends the prompt itself.
 */
export function buildWireHistory(activeMessages: AgentMessage[]): WireHistoryRow[] {
  return activeMessages
    .slice(0, Math.max(0, activeMessages.length - 2))
    .map((m) => {
      const content =
        m.role === "assistant"
          ? (m.content || (m.toolCalls?.length
            ? `[Used tools: ${m.toolCalls.map((tc) => tc.tool).join(", ")}]`
            : ""))
          : (m.content || "");
      const row: WireHistoryRow = { role: m.role, content };
      if (m.role === "user" && m.attachments?.length) {
        row.attachments = m.attachments;
      }
      return row;
    })
    .filter(
      (m) =>
        m.content.trim().length > 0
        || (m.role === "user" && (m.attachments?.length ?? 0) > 0),
    );
}

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
