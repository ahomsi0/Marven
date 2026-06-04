import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import type { NextRequest } from "next/server";

import { setActiveWorkspaceRoot } from "@/lib/workspaceState";

import { POST as filesReadPost } from "../files/route";
import { GET as rawGet } from "../files/raw/route";
import { GET as serveGet } from "../serve/route";
import { GET as previewGet } from "../preview/[...slug]/route";
import { POST as searchPost } from "../search/route";
import { POST as replacePost } from "../search-replace/route";

function makeReq(url: string, body?: unknown): NextRequest {
  return {
    url,
    nextUrl: new URL(url),
    json: async () => body ?? {},
  } as unknown as NextRequest;
}

describe("/api/workspace/* route handlers", () => {
  let parentDir: string;
  let workspaceRoot: string;
  let siblingRoot: string;

  beforeEach(async () => {
    parentDir = await fs.mkdtemp(path.join(os.tmpdir(), "marven-workspace-routes-"));
    workspaceRoot = path.join(parentDir, "repo");
    siblingRoot = path.join(parentDir, "repo-copy");
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(siblingRoot, { recursive: true });

    await fs.writeFile(path.join(workspaceRoot, "inside.txt"), "needle inside\n", "utf8");
    await fs.writeFile(path.join(workspaceRoot, "index.html"), "<h1>ok</h1>\n", "utf8");
    await fs.writeFile(path.join(siblingRoot, "outside.txt"), "needle outside\n", "utf8");

    setActiveWorkspaceRoot(null);
  });

  afterEach(async () => {
    setActiveWorkspaceRoot(null);
    await fs.rm(parentDir, { recursive: true, force: true });
  });

  it("files read uses the explicit root instead of the global active workspace", async () => {
    setActiveWorkspaceRoot(siblingRoot);

    const res = await filesReadPost(
      makeReq("http://x/api/workspace/files", {
        root: workspaceRoot,
        path: "inside.txt",
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.content).toContain("needle inside");
  });

  it("files read rejects sibling-directory escapes", async () => {
    const res = await filesReadPost(
      makeReq("http://x/api/workspace/files", {
        root: workspaceRoot,
        path: "../repo-copy/outside.txt",
      }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Path outside workspace");
  });

  it("raw file route rejects sibling-directory escapes", async () => {
    const res = await rawGet(
      makeReq(
        `http://x/api/workspace/files/raw?root=${encodeURIComponent(workspaceRoot)}&path=${encodeURIComponent("../repo-copy/outside.txt")}`,
      ),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Path outside workspace");
  });

  it("serve route rejects sibling-directory escapes", async () => {
    const res = await serveGet(
      makeReq(
        `http://x/api/workspace/serve?root=${encodeURIComponent(workspaceRoot)}&path=${encodeURIComponent("../repo-copy/outside.txt")}`,
      ),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Path outside workspace");
  });

  it("preview route rejects sibling-directory escapes", async () => {
    const res = await previewGet(
      makeReq(`http://x/api/workspace/preview/..%2Frepo-copy%2Foutside.txt?root=${encodeURIComponent(workspaceRoot)}`),
      { params: Promise.resolve({ slug: ["..", "repo-copy", "outside.txt"] }) },
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Path outside workspace");
  });

  it("search uses the explicit workspace root", async () => {
    setActiveWorkspaceRoot(siblingRoot);

    const res = await searchPost(
      makeReq("http://x/api/workspace/search", {
        workspaceRoot,
        query: "needle",
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0].path).toBe("inside.txt");
  });

  it("search-replace rejects absolute paths outside the workspace", async () => {
    const outsideAbs = path.join(siblingRoot, "outside.txt");

    const res = await replacePost(
      makeReq("http://x/api/workspace/search-replace", {
        workspaceRoot,
        query: "needle",
        replacement: "patched",
        files: [outsideAbs],
      }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Path outside workspace");
  });
});
