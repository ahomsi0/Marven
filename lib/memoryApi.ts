"use client";

// Browser-side calls to /api/memory used by Settings → Memory and the
// "Remembered" toast. Each mutation also fires marven:memory-changed so other
// holders of memory (the chat's memory context) can refresh.

import { dispatchMemoryChanged, type MemoryEventScope } from "./memoryEvents";
import type { MemoryViewEntry } from "./memoryView";

export interface MemoryApiContext {
  workspaceRoot?: string | null;
  conversationId?: string | null;
}

export type MemoryEntriesByScope = Record<MemoryEventScope, MemoryViewEntry[]>;

async function send(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/memory", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Memory request failed (${res.status})`);
  return data;
}

function contextBody(ctx: MemoryApiContext) {
  return {
    workspaceRoot: ctx.workspaceRoot ?? undefined,
    conversationId: ctx.conversationId ?? undefined,
  };
}

export async function fetchMemoryEntries(ctx: MemoryApiContext): Promise<MemoryEntriesByScope> {
  const params = new URLSearchParams();
  if (ctx.workspaceRoot) params.set("workspaceRoot", ctx.workspaceRoot);
  if (ctx.conversationId) params.set("conversationId", ctx.conversationId);
  const qs = params.toString();
  const res = await fetch(`/api/memory${qs ? `?${qs}` : ""}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Memory request failed (${res.status})`);
  const entries = data?.entries ?? {};
  const list = (v: unknown) => (Array.isArray(v) ? (v as MemoryViewEntry[]) : []);
  return { global: list(entries.global), project: list(entries.project), conversation: list(entries.conversation) };
}

export async function addMemoryEntry(scope: MemoryEventScope, content: string, ctx: MemoryApiContext): Promise<MemoryViewEntry | null> {
  const data = await send("POST", { scope, content, ...contextBody(ctx) });
  dispatchMemoryChanged();
  return (data.entry as MemoryViewEntry | undefined) ?? null;
}

export async function editMemoryEntry(scope: MemoryEventScope, id: string, text: string, ctx: MemoryApiContext): Promise<void> {
  await send("PATCH", { scope, id, text, ...contextBody(ctx) });
  dispatchMemoryChanged();
}

export async function deleteMemoryEntry(scope: MemoryEventScope, id: string, ctx: MemoryApiContext): Promise<void> {
  await send("DELETE", { scope, id, ...contextBody(ctx) });
  dispatchMemoryChanged();
}

export async function clearMemoryScope(scope: MemoryEventScope, ctx: MemoryApiContext): Promise<void> {
  await send("DELETE", { scope, ...contextBody(ctx) });
  dispatchMemoryChanged();
}
