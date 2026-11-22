"use client";

// Client-side bridge between the React conversation state and the SQLite
// persistence layer (/api/storage/conversations). localStorage remains the
// fast local copy; the server database is the durable, quota-free store.
//
// Hydration merges both sources per-conversation by `updatedAt` so offline or
// pre-upgrade local history is never clobbered by an older server snapshot.
// Pushes are debounced — the persist effect fires on every streamed delta —
// and flushed (keepalive) when the page is hidden or unloading.

import type { Conversation } from "@/types";
import { hydrateMessage } from "@/lib/storage";

const PUSH_DEBOUNCE_MS = 800;
const SYNC_URL = "/api/storage/conversations";

// ─── Tombstones ──────────────────────────────────────────────────────────────
// Deleting a conversation removes it from the list, but the server copy lives
// until the debounced push lands. If the app quits first, the next hydration
// would resurrect it from the server. A tombstone ({ id, deletedAt }) records
// the deletion locally (synchronously, in localStorage) so hydration can
// exclude the id, and is sent to the server so it deletes / refuses the id.
//
// Deletions are detected by diffing each pushed list against the previous one,
// so callers just keep passing the current conversation list.

export interface Tombstone {
  id: string;
  deletedAt: string;
}

export const TOMBSTONES_KEY = "marven_conversation_tombstones";
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_TOMBSTONES = 500;
// fetch keepalive / sendBeacon bodies are capped at 64KB by browsers.
const KEEPALIVE_BODY_LIMIT = 60_000;

/** Drop expired tombstones and cap the list to the newest MAX_TOMBSTONES. */
export function pruneTombstones(list: Tombstone[], now = Date.now()): Tombstone[] {
  const live = list.filter((t) => {
    const at = Date.parse(t.deletedAt);
    return Number.isFinite(at) && now - at <= TOMBSTONE_TTL_MS;
  });
  live.sort((a, b) => Date.parse(a.deletedAt) - Date.parse(b.deletedAt));
  return live.length > MAX_TOMBSTONES ? live.slice(live.length - MAX_TOMBSTONES) : live;
}

let tombstones: Tombstone[] | null = null;
// Ids present in the most recent list we saw (hydrated or pushed); used to
// detect deletions. Null until the first list is known.
let lastKnownIds: Set<string> | null = null;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function loadTombstones(): Tombstone[] {
  if (tombstones) return tombstones;
  let parsed: Tombstone[] = [];
  try {
    const raw = storage()?.getItem(TOMBSTONES_KEY);
    const data = raw ? JSON.parse(raw) : [];
    if (Array.isArray(data)) {
      parsed = data.filter(
        (t): t is Tombstone =>
          !!t && typeof t.id === "string" && !!t.id && typeof t.deletedAt === "string",
      );
    }
  } catch {
    parsed = [];
  }
  tombstones = pruneTombstones(parsed);
  return tombstones;
}

function saveTombstones(): void {
  try {
    storage()?.setItem(TOMBSTONES_KEY, JSON.stringify(tombstones ?? []));
  } catch {
    // best effort — the in-memory list still covers this session
  }
}

function tombstoneIdSet(): Set<string> {
  return new Set(loadTombstones().map((t) => t.id));
}

/** Update tombstones from a new full list: new absences are deletions. */
function trackDeletions(convs: Conversation[]): void {
  const ids = new Set(convs.map((c) => c.id));
  let list = loadTombstones();
  let changed = false;

  // An id that is present again was deliberately restored — drop its tombstone.
  if (list.some((t) => ids.has(t.id))) {
    list = list.filter((t) => !ids.has(t.id));
    changed = true;
  }

  if (lastKnownIds) {
    const now = new Date().toISOString();
    const have = new Set(list.map((t) => t.id));
    for (const id of lastKnownIds) {
      if (!ids.has(id) && !have.has(id)) {
        list.push({ id, deletedAt: now });
        changed = true;
      }
    }
  }
  lastKnownIds = ids;

  if (changed) {
    tombstones = pruneTombstones(list);
    saveTombstones();
  }
}

// ─── Hydration / merge ───────────────────────────────────────────────────────

interface ServerListResponse {
  conversations?: Array<Record<string, unknown>>;
}

function updatedAtOf(c: Conversation): number {
  const t = c.updatedAt ? Date.parse(c.updatedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function asConversation(raw: unknown): Conversation | null {
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
}

/**
 * Pure merge of the local list with the server documents.
 *  - union by id, minus any tombstoned id (a deletion beats both copies)
 *  - per shared id, keep whichever copy has the newer `updatedAt`
 *  - ordering follows the server's stored order; local-only conversations
 *    (first launch after upgrade / offline creations) are appended at the end
 */
export function mergeConversations(
  local: Conversation[],
  serverDocs: Array<Record<string, unknown>>,
  tombstonedIds: ReadonlySet<string> = new Set(),
): Conversation[] {
  const merged: Conversation[] = [];
  const seen = new Set<string>();
  for (const doc of serverDocs) {
    const id = typeof doc.id === "string" ? doc.id : null;
    if (!id || seen.has(id) || tombstonedIds.has(id)) continue;
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
    if (!seen.has(c.id) && !tombstonedIds.has(c.id)) merged.push(c);
  }

  return merged;
}

/**
 * Fetch the server copy and merge it with the freshly-loaded localStorage
 * list. Returns the list to adopt, or null when the server is unavailable
 * (caller keeps its local-only state).
 *
 * See `mergeConversations` for the merge rules; tombstoned (user-deleted)
 * ids are excluded from the result.
 */
export async function hydrateConversationsFromServer(
  local: Conversation[],
): Promise<Conversation[] | null> {
  // Baseline for deletion detection: anything that later disappears from the
  // list was deleted by the user. Tombstoned ids never enter the baseline.
  const initialTombstoned = tombstoneIdSet();
  if (!lastKnownIds) {
    lastKnownIds = new Set(local.map((c) => c.id).filter((id) => !initialTombstoned.has(id)));
  }

  let serverDocs: Array<Record<string, unknown>>;
  try {
    const res = await fetch(SYNC_URL, { method: "GET" });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerListResponse;
    if (!Array.isArray(data.conversations)) return null;
    serverDocs = data.conversations;
  } catch {
    return null; // server unreachable — localStorage remains authoritative
  }

  // Server empty → first run after upgrade: push local up (migration).
  if (serverDocs.length === 0) {
    const keep = local.filter((c) => !initialTombstoned.has(c.id));
    if (keep.length > 0) void pushConversationsToServer(keep);
    return null;
  }

  const tombstoned = tombstoneIdSet();
  const merged = mergeConversations(local, serverDocs, tombstoned);

  // The server still holds conversations the user deleted: tell it to drop them.
  if (serverDocs.some((d) => typeof d.id === "string" && tombstoned.has(d.id))) {
    void sendDeletions();
  }

  lastKnownIds = new Set(merged.map((c) => c.id));
  return merged;
}

// ─── Push ────────────────────────────────────────────────────────────────────

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPayload: Conversation[] | null = null;

function buildBody(convs: Conversation[]): string {
  return JSON.stringify({ conversations: convs, tombstones: loadTombstones() });
}

async function doPush(convs: Conversation[]): Promise<void> {
  try {
    const res = await fetch(SYNC_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: buildBody(convs),
    });
    if (!res.ok) {
      console.warn("[Marven] conversation sync failed:", res.status);
    }
  } catch {
    console.warn("[Marven] conversation sync unavailable (server unreachable)");
  }
}

/** Delete-only request: tells the server about tombstones, nothing else. */
async function sendDeletions(keepalive = false): Promise<void> {
  const list = loadTombstones();
  if (list.length === 0) return;
  try {
    await fetch(SYNC_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tombstones: list }),
      ...(keepalive ? { keepalive: true } : {}),
    });
  } catch {
    // The tombstone persists locally; hydration will still exclude the id.
  }
}

/** Debounced full-list push. Trailing edge — latest state always wins. */
export function scheduleServerPush(convs: Conversation[]): void {
  // Record deletions synchronously so they survive a quit inside the debounce.
  trackDeletions(convs);
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
  trackDeletions(convs);
  await doPush(convs);
}

/**
 * Send any pending debounced push right now using a keepalive request so it
 * survives the page being closed. Browsers cap keepalive bodies at 64KB; when
 * the full list is larger, only the (small) deletions go out — localStorage
 * already holds the full snapshot and the next launch merges it.
 */
export function flushPendingPush(): void {
  if (!pushTimer && !pendingPayload) return;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  const payload = pendingPayload;
  pendingPayload = null;
  if (!payload || typeof fetch !== "function") return;

  const body = buildBody(payload);
  if (body.length > KEEPALIVE_BODY_LIMIT) {
    void sendDeletions(true);
    return;
  }
  try {
    void fetch(SYNC_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore — the localStorage copy + tombstones cover the next launch
  }
}

/** Test-only: forget module state. */
export function __resetSyncStateForTests(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  pendingPayload = null;
  tombstones = null;
  lastKnownIds = null;
}

// Flush on the way out. visibilitychange→hidden is the most reliable signal;
// pagehide / beforeunload cover window close and app quit.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const w = window as typeof window & { __marvenSyncFlushInstalled?: boolean };
  if (!w.__marvenSyncFlushInstalled) {
    w.__marvenSyncFlushInstalled = true;
    window.addEventListener("pagehide", flushPendingPush);
    window.addEventListener("beforeunload", flushPendingPush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushPendingPush();
    });
  }
}
