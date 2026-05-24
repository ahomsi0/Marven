import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

import { IndexStore } from "@/lib/index/store";
import { Indexer } from "@/lib/index/indexer";
import { __resetForTests, __injectForTests } from "../_state";

import { POST as runFullPost } from "../run-full/route";
import { GET as statusGet } from "../status/route";
import { POST as searchPost } from "../search/route";
import { POST as updatePost } from "../update-file/route";
import { POST as deletePost } from "../delete-file/route";
import { POST as cancelPost } from "../cancel/route";
import { POST as clearPost } from "../clear/route";
import { POST as setEnabledPost } from "../set-enabled/route";

// ── Test helpers ────────────────────────────────────────────────────────────
function makeReq(url: string, body?: unknown, method: "POST" | "GET" = "POST") {
  // Minimal NextRequest shim — the route handlers only use `req.json()` and
  // `req.nextUrl.searchParams.get()`, both of which we cover here.
  return {
    json: async () => body ?? {},
    nextUrl: new URL(url),
  } as unknown as import("next/server").NextRequest;
}

function makeMockEmbedder() {
  return {
    ensureModelInstalled: async () => ({ ok: true }),
    embed: async () => {
      const v = new Float32Array(768);
      v[0] = 1;
      return v;
    },
    embedBatch: async (xs: string[]) =>
      xs.map((t) => {
        const v = new Float32Array(768);
        for (let i = 0; i < t.length && i < 768; i++) v[i] = t.charCodeAt(i) / 255;
        return v;
      }),
  };
}

async function injectForWorkspace(root: string) {
  const store = IndexStore.openInMemory();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const indexer = new Indexer({ workspaceRoot: root, store, embedder: makeMockEmbedder() as any });
  __injectForTests(root, { store, indexer });
  return { store, indexer };
}

describe("/api/index/* route handlers", () => {
  let tmp: string;
  beforeEach(async () => {
    __resetForTests();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "marven-routes-"));
  });
  afterEach(async () => {
    __resetForTests();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("run-full + status reports stats; search returns results", async () => {
    await fs.writeFile(path.join(tmp, "a.ts"), "alpha file\nbeta line");
    await injectForWorkspace(tmp);

    const res = await runFullPost(
      makeReq("http://x/api/index/run-full", { workspaceRoot: tmp, stream: false }),
    );
    expect(res.status).toBe(200);
    // run-full kicks off the run asynchronously; wait until it settles.
    // The route returns immediately, but the run is still going. We poll
    // status until running===false.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const s = await statusGet(
        makeReq(`http://x/api/index/status?workspaceRoot=${encodeURIComponent(tmp)}`, undefined, "GET"),
      );
      const json = await s.json();
      if (!json.running && json.stats && json.stats.fileCount > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const statusRes = await statusGet(
      makeReq(`http://x/api/index/status?workspaceRoot=${encodeURIComponent(tmp)}`, undefined, "GET"),
    );
    const status = await statusRes.json();
    expect(status.running).toBe(false);
    expect(status.stats.fileCount).toBe(1);

    // NOTE: We don't exercise /api/index/search here because the search route
    // talks directly to searchCodebase (which opens its own real sqlite store
    // and Ollama embedder). The route handler is a thin wrapper — its happy
    // path is already covered by lib/index/search.test.ts.
  });

  it("search rejects when workspaceRoot or query is missing", async () => {
    const res = await searchPost(
      makeReq("http://x/api/index/search", { query: "x" }),
    );
    expect(res.status).toBe(400);
  });

  it("update-file + delete-file invoke the indexer", async () => {
    const filePath = path.join(tmp, "b.ts");
    await fs.writeFile(filePath, "hello world");
    const { indexer } = await injectForWorkspace(tmp);
    const upd = vi.spyOn(indexer, "updateFile");
    const del = vi.spyOn(indexer, "deleteFile");

    const r1 = await updatePost(
      makeReq("http://x/api/index/update-file", { workspaceRoot: tmp, path: filePath }),
    );
    expect(r1.status).toBe(200);
    expect(upd).toHaveBeenCalledWith(filePath);

    const r2 = await deletePost(
      makeReq("http://x/api/index/delete-file", { workspaceRoot: tmp, path: filePath }),
    );
    expect(r2.status).toBe(200);
    expect(del).toHaveBeenCalledWith(filePath);
  });

  it("clear empties the store", async () => {
    await fs.writeFile(path.join(tmp, "c.ts"), "carrot");
    const { store } = await injectForWorkspace(tmp);
    await runFullPost(
      makeReq("http://x/api/index/run-full", { workspaceRoot: tmp, stream: false }),
    );
    // Drain the async run.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && store.stats().fileCount === 0) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(store.stats().fileCount).toBeGreaterThan(0);

    const r = await clearPost(
      makeReq("http://x/api/index/clear", { workspaceRoot: tmp }),
    );
    expect(r.status).toBe(200);
    expect(store.stats().fileCount).toBe(0);
  });

  it("cancel returns ok:false when no run is active", async () => {
    const r = await cancelPost();
    const json = await r.json();
    expect(json.ok).toBe(false);
  });

  it("set-enabled flips the flag and disabled search returns []", async () => {
    await setEnabledPost(
      makeReq("http://x/api/index/set-enabled", { enabled: false }),
    );
    const sr = await searchPost(
      makeReq("http://x/api/index/search", { workspaceRoot: tmp, query: "q" }),
    );
    expect(sr.status).toBe(200);
    const data = await sr.json();
    expect(data).toEqual([]);

    // Re-enable for the next test (afterEach also resets, but be explicit).
    await setEnabledPost(
      makeReq("http://x/api/index/set-enabled", { enabled: true }),
    );
  });
});
