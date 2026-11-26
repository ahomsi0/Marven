import { NextRequest, NextResponse } from "next/server";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { approveWorkspaceRoot } from "@/lib/workspaceState";
import { DEFAULT_PROJECTS_DIR, expandHome, isDirectChild, parentRejection } from "@/lib/companion/projectFolder";

const MAX_PATH = 4096;

// Approves a project Mini Me made earlier for the Agent again, so a follow-up
// change ("make the background red") can edit it after Marven restarts (the
// approved roots live in memory). Only a real folder directly inside the
// projects folder (the same rules as new-project) is accepted, and it never
// becomes the main window's active workspace.
export async function POST(req: NextRequest) {
  let body: { root?: unknown; parent?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const root = typeof body.root === "string" ? body.root : "";
  if (!root || root.length > MAX_PATH || root.includes("\0") || !path.isAbsolute(root)) {
    return NextResponse.json({ error: "root must be an absolute path" }, { status: 400 });
  }
  if (body.parent !== undefined && typeof body.parent !== "string") {
    return NextResponse.json({ error: "parent must be a string" }, { status: 400 });
  }

  try {
    const home = await fs.realpath(os.homedir());
    const requested = expandHome(body.parent?.trim() || DEFAULT_PROJECTS_DIR, home);
    if (!path.isAbsolute(requested)) {
      return NextResponse.json({ error: "parent must be an absolute path or start with ~" }, { status: 400 });
    }
    const parent = await fs.realpath(requested);
    const rejected = parentRejection(parent, home);
    if (rejected) return NextResponse.json({ error: rejected }, { status: 400 });

    const stat = await fs.lstat(root);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return NextResponse.json({ error: "not a project folder" }, { status: 403 });
    }
    const realRoot = await fs.realpath(root);
    if (!isDirectChild(realRoot, parent)) {
      return NextResponse.json({ error: "not a project folder" }, { status: 403 });
    }
    approveWorkspaceRoot(realRoot);
    return NextResponse.json({ root: realRoot });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return NextResponse.json({ error: "the project folder is gone" }, { status: 404 });
    return NextResponse.json({ error: `Could not open the project: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
