// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { saveConversations, loadConversations } from "./storage";
import type { Conversation } from "@/types";

function makeConversation(withImage: boolean): Conversation {
  return {
    id: "c1",
    name: "Test",
    mode: "chat",
    createdAt: new Date("2020-01-01").toISOString(),
    updatedAt: new Date("2020-01-01").toISOString(),
    messages: [
      {
        id: "m1",
        role: "user",
        content: "hello",
        timestamp: new Date("2020-01-01"),
        ...(withImage
          ? { attachments: [{ base64: "data:image/png;base64,AAAA", mimeType: "image/png" as const, name: "x.png" }] }
          : {}),
      },
    ],
  };
}

describe("saveConversations", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((k) => store[k] ?? null);
  });
  afterEach(() => vi.restoreAllMocks());

  it("saves and round-trips normally", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((k, v) => {
      store[k] = v;
    });
    const result = saveConversations([makeConversation(false)]);
    expect(result).toEqual({ ok: true, trimmed: false });
    expect(loadConversations()[0].messages[0].content).toBe("hello");
  });

  it("degrades gracefully on quota error by dropping attachments but keeping text", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((k, v) => {
      if (v.includes('"base64"')) {
        const e = new Error("quota");
        e.name = "QuotaExceededError";
        throw e;
      }
      store[k] = v;
    });
    const result = saveConversations([makeConversation(true)]);
    expect(result.ok).toBe(true);
    expect(result.trimmed).toBe(true);
    // Persisted payload keeps the message text but not the image blob.
    const persisted = loadConversations();
    expect(persisted[0].messages[0].content).toBe("hello");
    expect(persisted[0].messages[0].attachments).toBeUndefined();
  });

  it("reports failure when even the trimmed payload cannot be stored", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      const e = new Error("quota");
      e.name = "QuotaExceededError";
      throw e;
    });
    const result = saveConversations([makeConversation(true)]);
    expect(result.ok).toBe(false);
  });
});
