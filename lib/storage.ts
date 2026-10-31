"use client";

import type { Conversation, ConversationFolder, Message, CustomShortcut, ConversationMode } from "@/types";

const CONVERSATIONS_KEY = "marven_conversations";
const SHORTCUTS_KEY = "marven_custom_shortcuts";
const FOLDERS_KEY = "marven_conversation_folders";
const CORRUPT_BACKUP_KEY = "marven_storage_corrupt_backup_v1";

function preserveCorruptPayload(key: string, raw: string | null): void {
  if (!raw || typeof window === "undefined") return;
  try {
    localStorage.setItem(CORRUPT_BACKUP_KEY, JSON.stringify({ key, raw, savedAt: new Date().toISOString() }));
  } catch {
    // A full quota should not prevent the app from recovering into an empty list.
  }
}

// ─── Serialization helpers ────────────────────────────────────────────────────
// Messages have Date objects; localStorage stores JSON strings.

export function hydrateMessage(raw: Record<string, unknown>): Message {
  return {
    ...(raw as Omit<Message, "timestamp">),
    timestamp: new Date(raw.timestamp as string),
  };
}

function hydrateConversation(raw: Record<string, unknown>): Conversation {
  const messages = ((raw.messages as Record<string, unknown>[]) ?? []).map(
    hydrateMessage
  );
  return {
    ...(raw as Omit<Conversation, "messages">),
    mode: (raw.mode as Conversation["mode"]) ?? "chat",
    messages,
  };
}

// ─── Conversations ────────────────────────────────────────────────────────────

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, unknown>[];
    return parsed.map(hydrateConversation);
  } catch {
    let raw: string | null = null;
    try { raw = localStorage.getItem(CONVERSATIONS_KEY); } catch { /* best effort */ }
    preserveCorruptPayload(CONVERSATIONS_KEY, raw);
    return [];
  }
}

export interface SaveResult {
  ok: boolean;
  /** true when the save succeeded only after dropping image/document blobs */
  trimmed: boolean;
  error?: string;
}

/** Drop the heavy, non-text payloads (image data URLs, extracted doc text) so a
 *  conversation's text history can still be persisted when it would otherwise
 *  exceed the localStorage quota. */
function stripHeavyAttachments(conversations: Conversation[]): Conversation[] {
  return conversations.map((c) => ({
    ...c,
    messages: c.messages.map((m) => {
      if (!m.attachments && !m.docs) return m;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { attachments, docs, ...rest } = m;
      return rest;
    }),
  }));
}

export function saveConversations(conversations: Conversation[]): SaveResult {
  if (typeof window === "undefined") return { ok: false, trimmed: false };
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
    return { ok: true, trimmed: false };
  } catch (err) {
    // Almost always QuotaExceededError, usually from large base64 image
    // attachments. Retry without the heavy blobs so the conversation TEXT
    // still persists instead of everything being silently lost on restart.
    try {
      localStorage.setItem(
        CONVERSATIONS_KEY,
        JSON.stringify(stripHeavyAttachments(conversations)),
      );
      console.warn(
        "[Marven] localStorage quota exceeded — conversations saved without image/document attachments.",
      );
      return { ok: true, trimmed: true, error: err instanceof Error ? err.message : String(err) };
    } catch (err2) {
      console.error("[Marven] Failed to persist conversations:", err2);
      return { ok: false, trimmed: false, error: err2 instanceof Error ? err2.message : String(err2) };
    }
  }
}

// ─── Conversation folders ─────────────────────────────────────────────────────

export function loadConversationFolders(): ConversationFolder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ConversationFolder[];
  } catch {
    let raw: string | null = null;
    try { raw = localStorage.getItem(FOLDERS_KEY); } catch { /* best effort */ }
    preserveCorruptPayload(FOLDERS_KEY, raw);
    return [];
  }
}

export function saveConversationFolders(folders: ConversationFolder[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  } catch {
    // Ignore quota errors
  }
}

export function createConversationFolder(name: string): ConversationFolder {
  return {
    id: `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: name.trim() || "New folder",
    createdAt: new Date().toISOString(),
  };
}

export function createConversation(firstUserMessage: string): Conversation {
  const now = new Date().toISOString();
  return {
    id: `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: firstUserMessage.slice(0, 35).trim() || "New chat",
    mode: "chat",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createConversationWithMode(
  firstUserMessage: string,
  mode: ConversationMode
): Conversation {
  return {
    ...createConversation(firstUserMessage),
    mode,
  };
}

export function deleteConversation(
  conversations: Conversation[],
  id: string
): Conversation[] {
  return conversations.filter((c) => c.id !== id);
}

// ─── Custom shortcuts ─────────────────────────────────────────────────────────

export function loadCustomShortcuts(): CustomShortcut[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SHORTCUTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CustomShortcut[];
  } catch {
    return [];
  }
}

export function saveCustomShortcuts(shortcuts: CustomShortcut[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts));
  } catch {
    // Ignore storage quota errors
  }
}
