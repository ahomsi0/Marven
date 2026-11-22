import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { resolveRequestRoot, WorkspaceNotApprovedError } from "@/lib/workspaceState";
import { assertRealpathInsideWorkspace } from "@/lib/workspacePaths";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const relPath = typeof body.path === "string" ? body.path.trim() : "";
    const type = body.type === "folder" ? "folder" : "file";

    if (!relPath) return NextResponse.json({ error: "path is required" }, { status: 400 });

    // Honor only approved workspace roots — a client-supplied root would
    // otherwise re-anchor containment at an arbitrary directory.
    const root = resolveRequestRoot(typeof body.root === "string" ? body.root : undefined);
    if (!root) {
      throw body.root?.trim()
        ? new WorkspaceNotApprovedError()
        : new Error("No workspace folder open.");
    }

    const abs = path.resolve(root, relPath);
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      return NextResponse.json({ error: "Path outside workspace" }, { status: 400 });
    }
    // Same symlink containment the other file routes enforce — cloned trees
    // routinely contain links pointing outside the workspace.
    assertRealpathInsideWorkspace(root, abs);

    const exists = await fs.stat(abs).catch(() => null);
    if (exists) {
      return NextResponse.json({ error: "Already exists" }, { status: 409 });
    }

    if (type === "folder") {
      await fs.mkdir(abs, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, "", "utf-8");
    }
    return NextResponse.json({ ok: true, path: relPath, type });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create.";
    const status =
      message.startsWith("Workspace not approved") ? 403 :
      message === "No workspace folder open." || message === "Path outside workspace" ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
