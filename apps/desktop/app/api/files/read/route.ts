import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { getCheckpoint } from "@/lib/agent/checkpointStore";
import { getActiveWorkspaceRoot } from "@/lib/workspaceState";
import { assertRealpathInsideWorkspace } from "@/lib/workspacePaths";

export async function GET(req: NextRequest) {
  const requestedPath = req.nextUrl.searchParams.get("path");
  if (!requestedPath) return NextResponse.json({ error: "path is required" }, { status: 400 });
  const root = getActiveWorkspaceRoot();
  if (!root) return NextResponse.json({ error: "No active workspace" }, { status: 400 });
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(requestedPath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) {
    return NextResponse.json({ error: "Path outside workspace" }, { status: 403 });
  }
  try {
    assertRealpathInsideWorkspace(resolvedRoot, resolvedPath);
  } catch {
    return NextResponse.json({ error: "Path outside workspace" }, { status: 403 });
  }
  // Only allow reads of files currently in the checkpoint store
  // (these are paths the agent has actively snapshotted in this session)
  if (getCheckpoint(resolvedPath) === undefined) {
    return NextResponse.json({ error: "path is not a tracked checkpoint" }, { status: 403 });
  }
  try {
    const content = await readFile(resolvedPath, "utf8");
    return NextResponse.json({ content });
  } catch (err) {
    return NextResponse.json({
      content: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
