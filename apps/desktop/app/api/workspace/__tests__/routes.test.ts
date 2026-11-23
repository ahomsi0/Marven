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
import { encodePreviewRoot } from "@/lib/previewUrl";

function makeReq(url: string, body?: unknown): NextRequest {
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers(),
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

    // Registering via setActiveWorkspaceRoot both activates and approves the
    // root — routes reject client-supplied roots that were never registered.
    setActiveWorkspaceRoot(workspaceRoot);
  });

  afterEach(async () => {
    setActiveWorkspaceRoot(null);
    await fs.rm(parentDir, { recursive: true, force: true });
  });

  it("files read uses the explicit root instead of the global active workspace", async () => {
    // Both roots are approved (workspaceRoot in beforeEach, sibling now);
    // the explicit root must win over the global active one.
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

  it("files read rejects a client-supplied root that was never approved", async () => {
    const res = await filesReadPost(
      makeReq("http://x/api/workspace/files", {
        root: "/",
        path: "etc/hosts",
      }),
    );

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("Workspace not approved");
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

  it("preview route reads the root from the path so relative assets keep it", async () => {
    await fs.writeFile(path.join(workspaceRoot, "style.css"), "body{color:red}", "utf8");
    // A different active workspace proves the root comes from the URL path,
    // not a query string (which relative asset URLs never carry).
    setActiveWorkspaceRoot(siblingRoot);

    const res = await previewGet(
      makeReq(`http://x/api/workspace/preview/@${encodePreviewRoot(workspaceRoot)}/style.css`),
      { params: Promise.resolve({ slug: [`@${encodePreviewRoot(workspaceRoot)}`, "style.css"] }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/css");
    expect(await res.text()).toBe("body{color:red}");
  });

  it("preview route rejects a path-encoded root that was never approved", async () => {
    const unapproved = path.join(parentDir, "never-opened");
    await fs.mkdir(unapproved, { recursive: true });
    const seg = `@${encodePreviewRoot(unapproved)}`;

    const res = await previewGet(
      makeReq(`http://x/api/workspace/preview/${seg}/index.html`),
      { params: Promise.resolve({ slug: [seg, "index.html"] }) },
    );

    expect(res.status).toBe(403);
  });

  it("preview route still blocks escapes with a path-encoded root", async () => {
    const seg = `@${encodePreviewRoot(workspaceRoot)}`;
    const res = await previewGet(
      makeReq(`http://x/api/workspace/preview/${seg}/..%2Frepo-copy%2Foutside.txt`),
      { params: Promise.resolve({ slug: [seg, "..", "repo-copy", "outside.txt"] }) },
    );

    expect(res.status).toBe(400);
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
