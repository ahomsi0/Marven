import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hydrateConversationsFromServer,
  scheduleServerPush,
  pushConversationsToServer,
} from "./conversationSync";
import type { Conversation } from "@/types";

const conv = (id: string, updatedAt: string): Conversation => ({
  id,
  name: `conv ${id}`,
  mode: "chat",
  messages: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt,
});

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe("hydrateConversationsFromServer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns null when the server is unreachable (local stays authoritative)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    expect(await hydrateConversationsFromServer([conv("a", "2026-01-02T00:00:00Z")])).toBeNull();
  });

  it("returns null on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "boom" }, false)));
    expect(await hydrateConversationsFromServer([])).toBeNull();
  });

  it("pushes local history up (migration) when the server is empty", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return jsonResponse({ ok: true });
      return jsonResponse({ conversations: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const local = [conv("a", "2026-01-02T00:00:00Z")];
    const result = await hydrateConversationsFromServer(local);

    expect(result).toBeNull(); // nothing to adopt
    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit).method === "PUT");
    expect(putCall).toBeDefined();
    expect(JSON.parse(putCall![1]!.body as string).conversations[0].id).toBe("a");
  });

  it("revives server message timestamps into Date objects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      conversations: [{
        id: "s1",
        name: "server one",
        updatedAt: "2026-03-01T00:00:00Z",
        messages: [{ id: "m1", role: "user", content: "hi", timestamp: "2026-03-01T10:30:00.000Z" }],
      }],
    })));

    const result = await hydrateConversationsFromServer([]);
    const ts = result![0].messages[0].timestamp;
    expect(ts).toBeInstanceOf(Date);
    expect(ts.toISOString()).toBe("2026-03-01T10:30:00.000Z");
  });

  it("adopts server-only conversations and keeps stored order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      conversations: [
        { id: "s1", name: "server one", messages: [], updatedAt: "2026-03-01T00:00:00Z" },
        { id: "s2", name: "server two", messages: [], updatedAt: "2026-03-02T00:00:00Z" },
      ],
    })));

    const merged = await hydrateConversationsFromServer([]);
    expect(merged?.map((c) => c.id)).toEqual(["s1", "s2"]);
    expect(merged?.[0].name).toBe("server one");
  });

  it("prefers the newer copy per shared conversation (offline edits win)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      conversations: [
        { id: "shared", name: "OLD SERVER NAME", messages: [], updatedAt: "2026-01-01T00:00:00Z" },
      ],
    })));

    const localNewer = conv("shared", "2026-05-01T00:00:00Z");
    localNewer.name = "NEW LOCAL NAME";
    const merged = await hydrateConversationsFromServer([localNewer]);
    expect(merged?.[0].name).toBe("NEW LOCAL NAME");

    // And when the server copy is newer, it wins.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      conversations: [
        { id: "shared", name: "NEWER SERVER", messages: [], updatedAt: "2026-09-01T00:00:00Z" },
      ],
    })));
    const localOlder = conv("shared", "2026-01-01T00:00:00Z");
    localOlder.name = "STALE LOCAL";
    const merged2 = await hydrateConversationsFromServer([localOlder]);
    expect(merged2?.[0].name).toBe("NEWER SERVER");
  });

  it("appends local-only conversations after server ones", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      conversations: [{ id: "srv", messages: [], updatedAt: "2026-02-01T00:00:00Z" }],
    })));

    const offline = conv("made-offline", "2026-06-01T00:00:00Z");
    const merged = await hydrateConversationsFromServer([offline]);
    expect(merged?.map((c) => c.id)).toEqual(["srv", "made-offline"]);
  });
});

describe("scheduleServerPush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("debounces bursts into one PUT with the latest payload", async () => {
    const putCalls: Array<unknown> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") putCalls.push(JSON.parse(init.body as string));
      return jsonResponse({ ok: true });
    }));

    scheduleServerPush([conv("v1", "2026-01-01T00:00:00Z")]);
    scheduleServerPush([conv("v1", "2026-01-01T00:00:00Z"), conv("v2", "2026-01-01T00:00:01Z")]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(putCalls).toHaveLength(1);
    expect((putCalls[0] as { conversations: Array<{ id: string }> }).conversations.map((c) => c.id))
      .toEqual(["v1", "v2"]);
  });

  it("immediate migration push bypasses the debounce", async () => {
    let puts = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") puts++;
      return jsonResponse({ ok: true });
    }));

    scheduleServerPush([conv("queued", "2026-01-01T00:00:00Z")]);
    await pushConversationsToServer([conv("migrate", "2026-01-01T00:00:00Z")]);
    expect(puts).toBe(1);

    // The queued debounce timer was cancelled by the immediate push.
    await vi.advanceTimersByTimeAsync(2000);
    expect(puts).toBe(1);
  });
});
