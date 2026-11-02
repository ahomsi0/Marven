import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hydrateConversationsFromServer,
  scheduleServerPush,
  pushConversationsToServer,
  flushPendingPush,
  mergeConversations,
  pruneTombstones,
  TOMBSTONE_TTL_MS,
  MAX_TOMBSTONES,
  __resetSyncStateForTests,
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

describe("mergeConversations (tombstones)", () => {
  const serverDoc = (id: string, updatedAt: string) => ({ id, name: `srv ${id}`, messages: [], updatedAt });

  it("excludes tombstoned ids from both the server and local copies", () => {
    const merged = mergeConversations(
      [conv("gone", "2026-05-01T00:00:00Z"), conv("keep", "2026-05-01T00:00:00Z")],
      [serverDoc("gone", "2026-04-01T00:00:00Z"), serverDoc("keep", "2026-04-01T00:00:00Z")],
      new Set(["gone"]),
    );
    expect(merged.map((c) => c.id)).toEqual(["keep"]);
  });

  it("drops a tombstoned local-only conversation", () => {
    const merged = mergeConversations(
      [conv("gone", "2026-05-01T00:00:00Z")],
      [serverDoc("s", "2026-01-01T00:00:00Z")],
      new Set(["gone"]),
    );
    expect(merged.map((c) => c.id)).toEqual(["s"]);
  });

  it("still lets the newer edit win for non-tombstoned ids", () => {
    const newer = conv("a", "2026-09-01T00:00:00Z");
    newer.name = "NEWER LOCAL";
    const merged = mergeConversations([newer], [serverDoc("a", "2026-01-01T00:00:00Z")], new Set(["other"]));
    expect(merged[0].name).toBe("NEWER LOCAL");
  });
});

describe("pruneTombstones", () => {
  const now = Date.parse("2026-06-01T00:00:00Z");

  it("drops expired tombstones", () => {
    const old = new Date(now - TOMBSTONE_TTL_MS - 1000).toISOString();
    const fresh = new Date(now - 1000).toISOString();
    const out = pruneTombstones([{ id: "old", deletedAt: old }, { id: "fresh", deletedAt: fresh }], now);
    expect(out.map((t) => t.id)).toEqual(["fresh"]);
  });

  it("caps the list to the newest MAX_TOMBSTONES", () => {
    const list = Array.from({ length: MAX_TOMBSTONES + 10 }, (_, i) => ({
      id: `t${i}`,
      deletedAt: new Date(now - (MAX_TOMBSTONES + 10 - i) * 1000).toISOString(),
    }));
    const out = pruneTombstones(list, now);
    expect(out).toHaveLength(MAX_TOMBSTONES);
    expect(out[out.length - 1].id).toBe(`t${MAX_TOMBSTONES + 9}`);
    expect(out[0].id).toBe("t10");
  });
});

describe("deletion tracking and flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSyncStateForTests();
  });

  afterEach(() => {
    __resetSyncStateForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  type PutBody = {
    conversations?: Array<{ id: string }>;
    tombstones?: Array<{ id: string; deletedAt: string }>;
  };

  function stubFetch(serverDocs: unknown[] = []) {
    const puts: Array<{ body: PutBody; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        puts.push({ body: JSON.parse(init.body as string), init });
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ conversations: serverDocs });
    }));
    return puts;
  }

  it("records a tombstone when a conversation disappears and sends it to the server", async () => {
    const puts = stubFetch();
    const a = conv("a", "2026-01-01T00:00:00Z");
    const b = conv("b", "2026-01-01T00:00:00Z");
    scheduleServerPush([a, b]);
    scheduleServerPush([a]); // b deleted
    await vi.advanceTimersByTimeAsync(1000);

    expect(puts).toHaveLength(1);
    expect(puts[0].body.conversations!.map((c) => c.id)).toEqual(["a"]);
    expect(puts[0].body.tombstones!.map((t) => t.id)).toEqual(["b"]);
    expect(Number.isFinite(Date.parse(puts[0].body.tombstones![0].deletedAt))).toBe(true);
  });

  it("does not resurrect a deleted conversation on the next hydration", async () => {
    const a = conv("a", "2026-01-01T00:00:00Z");
    const b = conv("b", "2026-01-01T00:00:00Z");
    scheduleServerPush([a, b]);
    scheduleServerPush([a]); // delete b, then "quit" before the debounce fires

    // Next launch: the server still has both copies.
    const puts = stubFetch([
      { id: "a", messages: [], updatedAt: "2026-01-01T00:00:00Z" },
      { id: "b", messages: [], updatedAt: "2026-01-01T00:00:00Z" },
    ]);
    const merged = await hydrateConversationsFromServer([a]);
    expect(merged?.map((c) => c.id)).toEqual(["a"]);
    // And the server is told to drop it.
    expect(
      puts.some((p) => p.body.tombstones?.some((t) => t.id === "b") && !p.body.conversations),
    ).toBe(true);
  });

  it("clears a tombstone when the id comes back (undo)", async () => {
    const puts = stubFetch();
    const a = conv("a", "2026-01-01T00:00:00Z");
    const b = conv("b", "2026-01-01T00:00:00Z");
    scheduleServerPush([a, b]);
    scheduleServerPush([a]);
    scheduleServerPush([a, b]); // restored
    await vi.advanceTimersByTimeAsync(1000);
    expect(puts[0].body.tombstones).toEqual([]);
  });

  it("flushPendingPush sends the pending payload immediately with keepalive", async () => {
    const puts = stubFetch();
    scheduleServerPush([conv("a", "2026-01-01T00:00:00Z")]);
    flushPendingPush();
    expect(puts).toHaveLength(1);
    expect((puts[0].init as RequestInit & { keepalive?: boolean }).keepalive).toBe(true);

    // The debounce timer was cancelled: no duplicate push.
    await vi.advanceTimersByTimeAsync(2000);
    expect(puts).toHaveLength(1);
  });

  it("flushPendingPush is a no-op when nothing is pending", () => {
    const puts = stubFetch();
    flushPendingPush();
    expect(puts).toHaveLength(0);
  });

  it("falls back to a deletions-only request when the payload is too big for keepalive", () => {
    const puts = stubFetch();
    const big = conv("big", "2026-01-01T00:00:00Z");
    big.name = "x".repeat(70_000);
    const a = conv("a", "2026-01-01T00:00:00Z");
    scheduleServerPush([a, big]);
    scheduleServerPush([big]); // a deleted
    flushPendingPush();
    expect(puts).toHaveLength(1);
    expect(puts[0].body.conversations).toBeUndefined();
    expect(puts[0].body.tombstones!.map((t) => t.id)).toEqual(["a"]);
  });
});
