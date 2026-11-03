import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// Point ~/.marven/memory at a temp dir before memoryClient loads.
const home = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("path") as typeof import("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require("os") as typeof import("os");
  return mkdtempSync(join(tmpdir(), "marven-memory-route-"));
});

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, homedir: () => home, default: { ...actual, homedir: () => home } };
});

const { rmSync } = await import("fs");
const { GET, POST, PATCH, DELETE } = await import("./route");
const { resolveMemoryPath } = await import("@/lib/memoryClient");

// These tests clear the global scope; never let that reach the real ~/.marven.
if (!resolveMemoryPath("global").startsWith(home)) {
  throw new Error("memory route test is not using the temp home directory");
}

function makeReq(body?: unknown, query = ""): NextRequest {
  return {
    nextUrl: new URL(`http://localhost:47891/api/memory${query}`),
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as NextRequest;
}

async function add(content: string, extra: Record<string, unknown> = {}) {
  const res = await POST(makeReq({ content, ...extra }));
  return (await res.json()) as { entry: { id: string; text: string } };
}

beforeEach(async () => {
  await DELETE(makeReq({ scope: "global" }));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("/api/memory per-entry operations", () => {
  it("POST returns the new entry and GET lists entries with ids", async () => {
    const { entry } = await add("prefers dark mode");
    expect(entry.text).toBe("prefers dark mode");
    const data = await (await GET(makeReq())).json();
    expect(data.scopes.global).toEqual(["prefers dark mode"]);
    expect(data.entries.global).toEqual([{ id: entry.id, timestamp: entry.id, text: "prefers dark mode" }]);
  });

  it("PATCH edits one entry", async () => {
    const a = await add("first");
    await add("second");
    const res = await PATCH(makeReq({ scope: "global", id: a.entry.id, text: "first, edited" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scopes.global).toEqual(["first, edited", "second"]);
  });

  it("DELETE with an id removes only that entry", async () => {
    const a = await add("keep");
    const b = await add("drop");
    const res = await DELETE(makeReq({ scope: "global", id: b.entry.id }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries.global.map((e: { id: string }) => e.id)).toEqual([a.entry.id]);
  });

  it("DELETE accepts scope and id in the query string", async () => {
    const a = await add("query delete");
    const res = await DELETE(makeReq(undefined, `?scope=global&id=${encodeURIComponent(a.entry.id)}`));
    expect(res.status).toBe(200);
    expect((await res.json()).scopes.global).toEqual([]);
  });

  it("DELETE without an id still clears the whole scope", async () => {
    await add("one");
    await add("two");
    const data = await (await DELETE(makeReq({ scope: "global" }))).json();
    expect(data.scopes.global).toEqual([]);
  });

  it("returns 404 for an unknown id", async () => {
    expect((await PATCH(makeReq({ scope: "global", id: "2030-01-01T00:00:00.000Z", text: "x" }))).status).toBe(404);
    expect((await DELETE(makeReq({ scope: "global", id: "2030-01-01T00:00:00.000Z" }))).status).toBe(404);
  });

  it("validates scope, id, text and context", async () => {
    const { entry } = await add("x");
    expect((await PATCH(makeReq({ id: entry.id, text: "y" }))).status).toBe(400);
    expect((await PATCH(makeReq({ scope: "global", id: "../../etc", text: "y" }))).status).toBe(400);
    expect((await PATCH(makeReq({ scope: "global", id: entry.id, text: "  " }))).status).toBe(400);
    expect((await PATCH(makeReq({ scope: "global", id: entry.id, text: "z".repeat(5000) }))).status).toBe(400);
    expect((await DELETE(makeReq({ id: entry.id }))).status).toBe(400);
    // Project scope without a workspace is a client error, not a crash.
    expect((await PATCH(makeReq({ scope: "project", id: entry.id, text: "y" }))).status).toBe(400);
  });

  it("keeps project memory separate per workspace", async () => {
    const { entry } = await add("uses pnpm", { scope: "project", workspaceRoot: "/tmp/proj-a" });
    const data = await (await GET(makeReq(undefined, "?workspaceRoot=/tmp/proj-a"))).json();
    expect(data.entries.project.map((e: { text: string }) => e.text)).toEqual(["uses pnpm"]);
    const other = await (await GET(makeReq(undefined, "?workspaceRoot=/tmp/proj-b"))).json();
    expect(other.entries.project).toEqual([]);
    const res = await DELETE(makeReq({ scope: "project", id: entry.id, workspaceRoot: "/tmp/proj-a" }));
    expect(res.status).toBe(200);
  });
});
