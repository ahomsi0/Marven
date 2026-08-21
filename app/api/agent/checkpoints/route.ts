import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import { assertRealpathInsideWorkspace } from "@/lib/workspacePaths";
import { getActiveWorkspaceRoot } from "@/lib/workspaceState";
import {
  CHECKPOINT_TOO_LARGE,
  getCheckpoint,
  getCheckpointWorkspaceRoot,
  listCheckpoints,
} from "@/lib/agent/checkpointStore";

function ownedCheckpointPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  // Validate against the checkpoint's OWN recorded workspace rather than
  // whichever conversation is currently active — with multiple agent
  // conversations pinned to different folders, the global active root would
  // make reverts 403 depending on which conversation was opened last.
  const root = getCheckpointWorkspaceRoot(value) || getActiveWorkspaceRoot();
  if (!root) return null;

  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(value);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) return null;
  try {
    assertRealpathInsideWorkspace(resolvedRoot, resolved);
    return resolved;
  } catch {
    return null;
  }
}

export async function GET() {
  const items = listCheckpoints()
    .map((checkpointPath) => {
      const safePath = ownedCheckpointPath(checkpointPath);
      return safePath ? { path: safePath, before: getCheckpoint(safePath) } : null;
    })
    .filter((item): item is { path: string; before: string | null | undefined } => item !== null)
    .filter((item) => item.before !== undefined);
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { path: requestedPath, action } = body as { path: string; action: "revert" };
  if (action !== "revert") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const safePath = ownedCheckpointPath(requestedPath);
  if (!safePath) {
    return NextResponse.json({ error: "Checkpoint path is outside the active workspace" }, { status: 403 });
  }
  const before = getCheckpoint(safePath);
  if (before === undefined) {
    return NextResponse.json({ error: "No checkpoint for that path" }, { status: 404 });
  }
  if (before === CHECKPOINT_TOO_LARGE) {
    return NextResponse.json({ error: "This file is too large to restore from a checkpoint" }, { status: 409 });
  }
  try {
    if (before === null) {
      await unlink(safePath);
    } else {
      await writeFile(safePath, before, "utf8");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
