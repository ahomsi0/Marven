"use client";

// Client-side bridge between the React conversation state and the SQLite
// persistence layer (/api/storage/conversations). localStorage remains the
// fast local copy; the server database is the durable, quota-free store.
//
// Hydration merges both sources per-conversation by `updatedAt` so offline or
// pre-upgrade local history is never clobbered by an older server snapshot.
// Pushes are debounced — the persist effect fires on every streamed delta.

import type { Conversation } from "@/types";
import { hydrateMessage } from "@/lib/storage";

const PUSH_DEBOUNCE_MS = 800;

interface ServerListResponse {
  conversations?: Array<Record<string, unknown>>;
}

function updatedAtOf(c: Conversation): number {
  const t = c.updatedAt ? Date.parse(c.updatedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/**
 * Fetch the server copy and merge it with the freshly-loaded localStorage
 * list. Returns the list to adopt, or null when the server is unavailable
 * (caller keeps its local-only state).
 *
 * Merge rules:
 *  - union by id
 *  - per shared id, keep whichever copy has the newer `updatedAt`
 *  - ordering follows the server's stored order; local-only conversations
 *    (first launch after upgrade / offline creations) are appended at the end
 */
export async function hydrateConversationsFromServer(
  local: Conversation[],
): Promise<Conversation[] | null> {
  let serverDocs: Array<Record<string, unknown>>;
  try {
    const res = await fetch("/api/storage/conversations", { method: "GET" });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerListResponse;
    if (!Array.isArray(data.conversations)) return null;
    serverDocs = data.conversations;
  } catch {
    return null; // server unreachable — localStorage remains authoritative
  }

  // Server empty → first run after upgrade: push local up (migration).
  if (serverDocs.length === 0) {
    if (local.length > 0) void pushConversationsToServer(local);
    return null;
  }

  const serverById = new Map<string, Record<string, unknown>>();
  for (const doc of serverDocs) {
    const id = typeof doc.id === "string" ? doc.id : null;
    if (id) serverById.set(id, doc);
  }

  const asConversation = (raw: unknown): Conversation | null => {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) return null;
    return {
      ...(r as unknown as Conversation),
      // JSON carries timestamps as ISO strings; the UI expects Date objects.
      messages: Array.isArray(r.messages)
        ? (r.messages as Record<string, unknown>[]).map(hydrateMessage)
        : [],
    };
  };

  const merged: Conversation[] = [];
  const seen = new Set<string>();
  for (const doc of serverDocs) {
    const id = typeof doc.id === "string" ? doc.id : null;
    if (!id || seen.has(id)) continue;
    const serverConv = asConversation(doc);
    if (!serverConv) continue;
    seen.add(id);

    const localMatch = local.find((c) => c.id === id);
    if (!localMatch) {
      merged.push(serverConv);
      continue;
    }
    merged.push(updatedAtOf(localMatch) > updatedAtOf(serverConv) ? localMatch : serverConv);
  }

  // Local-only conversations survive (offline creations, pre-upgrade data).
  for (const c of local) {
    if (!seen.has(c.id)) merged.push(c);
  }

  return merged;
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPayload: Conversation[] | null = null;

async function doPush(convs: Conversation[]): Promise<void> {
  try {
    const res = await fetch("/api/storage/conversations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversations: convs }),
    });
    if (!res.ok) {
      console.warn("[Marven] conversation sync failed:", res.status);
    }
  } catch {
    console.warn("[Marven] conversation sync unavailable (server unreachable)");
  }
}

/** Debounced full-list push. Trailing edge — latest state always wins. */
export function scheduleServerPush(convs: Conversation[]): void {
  pendingPayload = convs;
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const payload = pendingPayload;
    pendingPayload = null;
    if (payload) void doPush(payload);
  }, PUSH_DEBOUNCE_MS);
}

/** Immediate push, bypassing the debounce (used for migration). */
export async function pushConversationsToServer(convs: Conversation[]): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
    pendingPayload = null;
  }
  await doPush(convs);
}
