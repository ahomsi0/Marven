"use client";

import type { Conversation, Message, CustomShortcut, ConversationMode } from "@/types";

const CONVERSATIONS_KEY = "marven_conversations";
const SHORTCUTS_KEY = "marven_custom_shortcuts";

// ─── Serialization helpers ────────────────────────────────────────────────────
// Messages have Date objects; localStorage stores JSON strings.

function hydrateMessage(raw: Record<string, unknown>): Message {
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
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  } catch {
    // Ignore storage quota errors
  }
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
