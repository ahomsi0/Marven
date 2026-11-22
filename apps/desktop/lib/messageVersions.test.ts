import { describe, it, expect } from "vitest";
import type { Message } from "@/types";
import {
  attachPendingVersion,
  beginNewVersion,
  branchThread,
  settlePendingVersion,
  stripAttachmentsDeep,
  switchVersion,
  userIndexBefore,
  versionControls,
} from "./messageVersions";
import { hydrateMessage } from "./storage";

let seq = 0;
function msg(role: Message["role"], content: string, extra: Partial<Message> = {}): Message {
  seq += 1;
  return { id: `m${seq}`, role, content, timestamp: new Date(2026, 0, 1, 12, seq), ...extra };
}

/** Simulate an edit/retry the way page.tsx drives it. */
function resend(thread: Message[], userIndex: number, newText: string, reply: string, model?: string) {
  const pending = beginNewVersion(thread, userIndex)!;
  let next = thread.slice(0, userIndex);
  next = [...next, attachPendingVersion(msg("user", newText), pending)];
  next = [...next, msg("assistant", reply, model ? { model, provider: "groq" } : {})];
  return settlePendingVersion(next, pending);
}

const contents = (thread: Message[]) => thread.map((m) => m.content);

describe("message versions", () => {
  it("keeps the old branch when a message is edited", () => {
    const thread = [msg("user", "hi"), msg("assistant", "hello"), msg("user", "tell a joke"), msg("assistant", "joke 1"), msg("user", "another"), msg("assistant", "joke 2")];
    const edited = resend(thread, 2, "tell a pun", "pun 1");

    expect(contents(edited)).toEqual(["hi", "hello", "tell a pun", "pun 1"]);
    expect(edited[2].versions).toHaveLength(2);
    expect(edited[2].activeVersion).toBe(1);
    // The old version remembers the whole rest of its branch.
    expect(contents(edited[2].versions![0].replies)).toEqual(["joke 1", "another", "joke 2"]);
    expect(edited[2].versions![1].replies).toEqual([]);
  });

  it("switches between versions without losing either branch", () => {
    const thread = [msg("user", "tell a joke"), msg("assistant", "joke 1"), msg("user", "more"), msg("assistant", "joke 2")];
    const edited = resend(thread, 0, "tell a pun", "pun 1");
    const userId = edited[0].id;

    const back = switchVersion(edited, userId, 0);
    expect(contents(back)).toEqual(["tell a joke", "joke 1", "more", "joke 2"]);
    expect(back[0].id).toBe(userId);
    expect(back[0].activeVersion).toBe(0);
    expect(back[0].versions![0].replies).toEqual([]);
    expect(contents(back[0].versions![1].replies)).toEqual(["pun 1"]);

    const forward = switchVersion(back, userId, 1);
    expect(contents(forward)).toEqual(["tell a pun", "pun 1"]);
  });

  it("adds a third version and keeps all three", () => {
    const thread = [msg("user", "a"), msg("assistant", "A")];
    const v2 = resend(thread, 0, "b", "B");
    const onFirst = switchVersion(v2, v2[0].id, 0);
    const v3 = resend(onFirst, 0, "c", "C");
    expect(v3[0].versions!.map((v) => v.content)).toEqual(["a", "b", "c"]);
    expect(v3[0].activeVersion).toBe(2);
    expect(contents(switchVersion(v3, v3[0].id, 1))).toEqual(["b", "B"]);
    expect(contents(switchVersion(v3, v3[0].id, 0))).toEqual(["a", "A"]);
  });

  it("keeps nested versions inside a stored branch", () => {
    const thread = [msg("user", "q1"), msg("assistant", "a1"), msg("user", "q2"), msg("assistant", "a2")];
    const innerEdit = resend(thread, 2, "q2b", "a2b"); // versions on the second question
    const outerEdit = resend(innerEdit, 0, "q1b", "a1b"); // then edit the first question
    const restored = switchVersion(outerEdit, outerEdit[0].id, 0);
    expect(contents(restored)).toEqual(["q1", "a1", "q2b", "a2b"]);
    const inner = switchVersion(restored, restored[2].id, 0);
    expect(contents(inner)).toEqual(["q1", "a1", "q2", "a2"]);
  });

  it("ignores out-of-range or no-op switches and messages without versions", () => {
    const thread = [msg("user", "a"), msg("assistant", "A")];
    expect(switchVersion(thread, thread[0].id, 1)).toBe(thread);
    const v2 = resend(thread, 0, "b", "B");
    expect(switchVersion(v2, v2[0].id, 1)).toBe(v2);
    expect(switchVersion(v2, v2[0].id, 5)).toBe(v2);
    expect(switchVersion(v2, "missing", 0)).toBe(v2);
  });

  it("puts the previous branch back if the resend never added a message", () => {
    const thread = [msg("user", "hi"), msg("assistant", "hello"), msg("user", "q"), msg("assistant", "a")];
    const pending = beginNewVersion(thread, 2)!;
    const truncated = thread.slice(0, 2);
    const settled = settlePendingVersion(truncated, pending);
    expect(contents(settled)).toEqual(["hi", "hello", "q", "a"]);
    expect(settled[2].versions).toBeUndefined();
  });

  it("restores the active version (and keeps the others) when a later resend bails", () => {
    const thread = [msg("user", "a"), msg("assistant", "A")];
    const v2 = resend(thread, 0, "b", "B");
    const pending = beginNewVersion(v2, 0)!;
    const settled = settlePendingVersion([], pending);
    expect(contents(settled)).toEqual(["b", "B"]);
    expect(settled[0].versions).toHaveLength(2);
    expect(settled[0].activeVersion).toBe(1);
    expect(settled[0].versions![1].replies).toEqual([]);
  });

  it("returns null for a non-user message", () => {
    const thread = [msg("user", "a"), msg("assistant", "A")];
    expect(beginNewVersion(thread, 1)).toBeNull();
    expect(beginNewVersion(thread, 9)).toBeNull();
  });

  it("round-trips through JSON storage", () => {
    const thread = [msg("user", "a"), msg("assistant", "A", { model: "llama", provider: "groq" })];
    const v2 = resend(thread, 0, "b", "B", "gpt-oss-120b");
    const stored = (JSON.parse(JSON.stringify(v2)) as Record<string, unknown>[]).map(hydrateMessage);
    const back = switchVersion(stored, stored[0].id, 0);
    expect(contents(back)).toEqual(["a", "A"]);
    expect(back[0].timestamp).toBeInstanceOf(Date);
    expect(back[1].timestamp).toBeInstanceOf(Date);
    expect(back[1].model).toBe("llama");
    const forward = switchVersion(back, back[0].id, 1);
    expect(forward[1].model).toBe("gpt-oss-120b");
  });

  it("loads conversations stored before versions existed", () => {
    const old = [{ id: "x", role: "user", content: "hi", timestamp: "2025-01-01T00:00:00.000Z" }];
    const hydrated = old.map((m) => hydrateMessage(m));
    expect(versionControls(hydrated).size).toBe(0);
    expect(beginNewVersion(hydrated, 0)!.versions).toHaveLength(1);
  });

  it("keeps attachments with the version they belong to", () => {
    const image = { base64: "data:image/png;base64,AAAA", mimeType: "image/png" as const, name: "a.png" };
    const thread = [msg("user", "look", { attachments: [image] }), msg("assistant", "a cat")];
    const v2 = resend(thread, 0, "look again", "a dog");
    expect(v2[0].attachments).toBeUndefined();
    const back = switchVersion(v2, v2[0].id, 0);
    expect(back[0].attachments).toEqual([image]);
  });
});

describe("versionControls", () => {
  it("puts the switcher on the user message after an edit", () => {
    const v2 = resend([msg("user", "a"), msg("assistant", "A")], 0, "b", "B");
    const controls = versionControls(v2);
    expect(controls.get(v2[0].id)).toEqual({ ownerId: v2[0].id, index: 1, total: 2 });
    expect(controls.has(v2[1].id)).toBe(false);
  });

  it("puts the switcher on the reply when only retried", () => {
    const v2 = resend([msg("user", "a"), msg("assistant", "A")], 0, "a", "A again", "other-model");
    const controls = versionControls(v2);
    expect(controls.get(v2[1].id)).toEqual({ ownerId: v2[0].id, index: 1, total: 2 });
    expect(controls.has(v2[0].id)).toBe(false);
  });
});

describe("helpers", () => {
  it("finds the user message a reply answers", () => {
    const thread = [msg("assistant", "greeting"), msg("user", "q"), msg("assistant", "a"), msg("assistant", "a2")];
    expect(userIndexBefore(thread, 3)).toBe(1);
    expect(userIndexBefore(thread, 0)).toBe(-1);
  });

  it("branches the active thread up to a message with fresh ids and no versions", () => {
    const v2 = resend([msg("user", "a"), msg("assistant", "A"), msg("user", "b"), msg("assistant", "B")], 2, "c", "C");
    let n = 0;
    const branch = branchThread(v2, v2[2].id, () => `new-${++n}`)!;
    expect(contents(branch)).toEqual(["a", "A", "c"]);
    expect(branch.map((m) => m.id)).toEqual(["new-1", "new-2", "new-3"]);
    expect(branch[2].versions).toBeUndefined();
    expect(branch[2].activeVersion).toBeUndefined();
    expect(branchThread(v2, "missing", () => "x")).toBeNull();
  });

  it("strips attachments inside stored versions", () => {
    const image = { base64: "data:image/png;base64,AAAA", mimeType: "image/png" as const, name: "a.png" };
    const thread = [msg("user", "look", { attachments: [image] }), msg("assistant", "A")];
    const v2 = resend(thread, 0, "look again", "B");
    const withImage = { ...v2[0], attachments: [image] };
    const stripped = stripAttachmentsDeep(withImage);
    expect(stripped.attachments).toBeUndefined();
    expect(stripped.versions![0].attachments).toBeUndefined();
    expect(stripped.versions![0].content).toBe("look");
  });
});
