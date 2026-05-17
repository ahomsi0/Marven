import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { getCheckpoint } from "@/lib/agent/checkpointStore";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  // Only allow reads of files currently in the checkpoint store
  // (these are paths the agent has actively snapshotted in this session)
  if (getCheckpoint(path) === undefined) {
    return NextResponse.json({ error: "path is not a tracked checkpoint" }, { status: 403 });
  }
  try {
    const content = await readFile(path, "utf8");
    return NextResponse.json({ content });
  } catch (err) {
    return NextResponse.json({
      content: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
