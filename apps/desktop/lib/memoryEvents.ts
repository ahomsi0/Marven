// Memory notifications shared by the chat, the agent stream, Settings → Memory
// and the "Remembered" toast.
//
//   marven:memory-saved    detail: MemorySavedDetail
//     A memory was just added (chat "remember that …" or the agent's
//     `remember` tool). <MemoryToast> shows "Remembered: …" with Undo/Manage.
//
//   marven:memory-changed  (no detail)
//     Memory was edited, deleted or cleared from the UI; anything holding a
//     copy (e.g. the chat's memory context) should refetch.

export type MemoryEventScope = "global" | "project" | "conversation";

export const MEMORY_SAVED_EVENT = "marven:memory-saved";
export const MEMORY_CHANGED_EVENT = "marven:memory-changed";

export interface MemorySavedDetail {
  scope: MemoryEventScope;
  text: string;
  /** The entry id from /api/memory (used by Undo). */
  id: string;
  /** Context needed to address project / conversation entries. */
  workspaceRoot?: string | null;
  conversationId?: string | null;
}

export function dispatchMemorySaved(detail: MemorySavedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<MemorySavedDetail>(MEMORY_SAVED_EVENT, { detail }));
}

export function dispatchMemoryChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MEMORY_CHANGED_EVENT));
}

// ── Agent `remember` tool result ─────────────────────────────────────────────
// The tool runs on the server; its text result is the only thing the client
// sees, so it carries the new entry's id in a fixed, parseable form.

export function formatRememberToolResult(scope: MemoryEventScope, id?: string | null): string {
  return id ? `Remembered in ${scope} memory (memory id ${id}).` : `Remembered in ${scope} memory.`;
}

const REMEMBER_RESULT_RE = /^Remembered in (global|project|conversation) memory \(memory id ([A-Za-z0-9:._~+-]{1,64})\)\.$/;

export function parseRememberToolResult(output: string): { scope: MemoryEventScope; id: string } | null {
  const m = output.trim().match(REMEMBER_RESULT_RE);
  return m ? { scope: m[1] as MemoryEventScope, id: m[2] } : null;
}
