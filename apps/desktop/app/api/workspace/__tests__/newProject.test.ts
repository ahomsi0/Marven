import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { NextRequest } from "next/server";

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe("POST /api/workspace/new-project", () => {
  let home = "";
  let state: typeof import("@/lib/workspaceState");
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    if (home) await fs.rm(home, { recursive: true, force: true });
  });

  async function setup() {
    home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "marven-newproj-")));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.resetModules();
    // Import after resetModules so the test and the route share one workspaceState instance.
    state = await import("@/lib/workspaceState");
    return (await import("../new-project/route")).POST;
  }

  it("creates a unique, approved folder without changing the active workspace", async () => {
    const POST = await setup();
    state.setActiveWorkspaceRoot(path.join(home, "my-active-workspace"));
    const before = state.getActiveWorkspaceRoot();
    expect(before).toBe(path.join(home, "my-active-workspace"));
    const a = await (await POST(req({ name: "Cafe Menu", parent: "~/Marven Projects" }))).json();
    const b = await (await POST(req({ name: "Cafe Menu", parent: "~/Marven Projects" }))).json();
    expect(a.root).toBe(path.join(home, "Marven Projects", "cafe-menu"));
    expect(b.root).toBe(path.join(home, "Marven Projects", "cafe-menu-2"));
    expect((await fs.stat(a.root)).isDirectory()).toBe(true);
    expect(state.isApprovedWorkspaceRoot(a.root)).toBe(true);
    expect(state.getActiveWorkspaceRoot()).toBe(before);
  });

  it("rejects parents outside home, including .. escapes and symlinks", async () => {
    const POST = await setup();
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "marven-outside-")));
    try {
      await fs.symlink(outside, path.join(home, "link"));
      for (const parent of ["/tmp/nope", `${home}/../escape`, "~/../escape", "~", "~/link", "~/link/sub", "relative/path"]) {
        const res = await POST(req({ name: "x", parent }));
        expect(res.status, parent).toBe(400);
      }
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects hidden and Library parents with a clear message", async () => {
    const POST = await setup();
    for (const parent of ["~/.ssh", "~/Work/.hidden", "~/Library", "~/Library/Application Support"]) {
      const res = await POST(req({ name: "x", parent }));
      expect(res.status, parent).toBe(400);
      expect((await res.json()).error).toMatch(/hidden|Library/);
    }
    await fs.mkdir(path.join(home, ".real"));
    await fs.symlink(path.join(home, ".real"), path.join(home, "visible"));
    expect((await POST(req({ name: "x", parent: "~/visible" }))).status).toBe(400);
  });

  it("validates the body", async () => {
    const POST = await setup();
    expect((await POST(req({ name: "  " }))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ name: "x", parent: 5 }))).status).toBe(400);
    expect((await POST({ json: async () => { throw new Error("bad"); } } as unknown as NextRequest)).status).toBe(400);
  });
});
