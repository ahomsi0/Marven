// Message versions: editing or retrying a chat message starts a new version
// instead of throwing the old branch away.
//
// Model: the user message that starts a turn carries `versions` (every
// version of that message, each with the messages that followed it) and
// `activeVersion`. The conversation's `messages` array is always the active
// path, so everything that reads a thread (rendering, history sent to the
// model, search, export) keeps working unchanged. The active version's
// `replies` is left empty — the live thread after the message holds them —
// and is filled in when you switch away. Older messages simply have no
// `versions`. Replies inside a stored version can carry their own versions,
// so branches nest naturally and survive JSON storage.

import type { Message, MessageVersion } from "@/types";

/** Undo JSON's Date → string on a message restored from a stored version. */
export function reviveMessage(m: Message): Message {
  return m.timestamp instanceof Date ? m : { ...m, timestamp: new Date(m.timestamp as unknown as string) };
}

function versionOf(message: Message, replies: Message[]): MessageVersion {
  const v: MessageVersion = { content: message.content, timestamp: message.timestamp, replies };
  if (message.attachments?.length) v.attachments = message.attachments;
  if (message.docs?.length) v.docs = message.docs;
  return v;
}

function withoutVersions(message: Message): Message {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { versions, activeVersion, ...rest } = message;
  return rest;
}

function activeIndex(message: Message): number {
  const n = message.versions?.length ?? 0;
  const i = message.activeVersion ?? n - 1;
  return Math.min(Math.max(i, 0), Math.max(n - 1, 0));
}

/** Every version of the user message at `index`, with the live thread saved into the active one. */
function snapshotVersions(messages: Message[], index: number): MessageVersion[] {
  const message = messages[index];
  const live = versionOf(message, messages.slice(index + 1));
  if (!message.versions?.length) return [live];
  const active = activeIndex(message);
  return message.versions.map((v, i) => (i === active ? live : v));
}

// ─── Starting a new version (edit / retry) ───────────────────────────────────

export interface PendingVersion {
  /** Where the new version's user message will land in the thread. */
  index: number;
  /** The user message being replaced, without its versions. */
  previous: Message;
  previousActive: number;
  /** All existing versions, the one being replaced filled in from the live thread. */
  versions: MessageVersion[];
}

/**
 * Snapshot the user message at `userIndex` and everything after it, before the
 * thread is cut back to resend. Returns null if that isn't a user message.
 */
export function beginNewVersion(messages: Message[], userIndex: number): PendingVersion | null {
  const message = messages[userIndex];
  if (!message || message.role !== "user") return null;
  return {
    index: userIndex,
    previous: withoutVersions(message),
    previousActive: message.versions?.length ? activeIndex(message) : 0,
    versions: snapshotVersions(messages, userIndex),
  };
}

/** The resent user message, carrying the older versions and active as the newest. */
export function attachPendingVersion(message: Message, pending: PendingVersion): Message {
  return {
    ...message,
    versions: [...pending.versions, versionOf(message, [])],
    activeVersion: pending.versions.length,
  };
}

function landed(messages: Message[], pending: PendingVersion): boolean {
  const at = messages[pending.index];
  return !!at && at.role === "user" && at.versions?.length === pending.versions.length + 1;
}

/**
 * After the resend finishes: if the new version never landed (the send bailed
 * out before adding the message), put the previous branch back so nothing is
 * lost. Returns `messages` unchanged when there's nothing to do.
 */
export function settlePendingVersion(messages: Message[], pending: PendingVersion): Message[] {
  if (landed(messages, pending)) return messages;
  const restoredVersion = pending.versions[pending.previousActive];
  const versions = pending.versions.map((v, i) => (i === pending.previousActive ? { ...v, replies: [] } : v));
  const user: Message =
    versions.length > 1 ? { ...pending.previous, versions, activeVersion: pending.previousActive } : pending.previous;
  return [
    ...messages.slice(0, pending.index),
    user,
    ...restoredVersion.replies.map(reviveMessage),
    ...messages.slice(pending.index),
  ];
}

// ─── Switching ───────────────────────────────────────────────────────────────

/**
 * Show version `target` of user message `userMessageId`: the live branch is
 * saved into its version and the target's messages replace it.
 */
export function switchVersion(messages: Message[], userMessageId: string, target: number): Message[] {
  const index = messages.findIndex((m) => m.id === userMessageId);
  const message = messages[index];
  if (!message?.versions || target < 0 || target >= message.versions.length) return messages;
  const active = activeIndex(message);
  if (target === active) return messages;

  const versions = snapshotVersions(messages, index);
  const next = versions[target];
  versions[target] = { ...next, replies: [] };

  const user: Message = {
    ...message,
    content: next.content,
    attachments: next.attachments,
    docs: next.docs,
    timestamp: next.timestamp instanceof Date ? next.timestamp : new Date(next.timestamp),
    versions,
    activeVersion: target,
  };
  if (!user.attachments) delete user.attachments;
  if (!user.docs) delete user.docs;
  return [...messages.slice(0, index), user, ...next.replies.map(reviveMessage)];
}

// ─── Rendering ───────────────────────────────────────────────────────────────

export interface VersionControl {
  /** The user message whose versions this switches. */
  ownerId: string;
  /** 0-based active version. */
  index: number;
  total: number;
}

/**
 * Where to draw a ‹ n/m › switcher. Edits put it on the user message; when
 * every version has the same text (only retries), it goes on the reply below
 * instead, since that's what differs.
 */
export function versionControls(messages: Message[]): Map<string, VersionControl> {
  const out = new Map<string, VersionControl>();
  messages.forEach((m, i) => {
    if (m.role !== "user" || !m.versions || m.versions.length < 2) return;
    const index = activeIndex(m);
    const control: VersionControl = { ownerId: m.id, index, total: m.versions.length };
    const texts = m.versions.map((v, vi) => (vi === index ? m.content : v.content));
    const retriesOnly = texts.every((tx) => tx === texts[0]);
    const reply = messages[i + 1];
    if (retriesOnly && reply?.role === "assistant") out.set(reply.id, control);
    else out.set(m.id, control);
  });
  return out;
}

// ─── Branching / retry helpers ───────────────────────────────────────────────

/** Index of the user message a reply at `index` answers, or -1. */
export function userIndexBefore(messages: Message[], index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

/**
 * The active thread up to and including `messageId`, as plain messages with
 * fresh ids (versions dropped) — the start of a branched conversation.
 */
export function branchThread(messages: Message[], messageId: string, makeId: () => string): Message[] | null {
  const index = messages.findIndex((m) => m.id === messageId);
  if (index === -1) return null;
  return messages.slice(0, index + 1).map((m) => ({ ...withoutVersions(m), id: makeId(), isStreaming: false }));
}

/** Drop image/document payloads everywhere, including inside stored versions. */
export function stripAttachmentsDeep(message: Message): Message {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { attachments, docs, ...rest } = message;
  if (!rest.versions) return rest;
  return {
    ...rest,
    versions: rest.versions.map((v) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { attachments: _a, docs: _d, ...version } = v;
      return { ...version, replies: version.replies.map(stripAttachmentsDeep) };
    }),
  };
}
