import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import { getCheckpoint, listCheckpoints } from "@/lib/agent/checkpointStore";

export async function GET() {
  const paths = listCheckpoints();
  const items = paths.map((path) => ({ path, before: getCheckpoint(path) }));
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { path, action } = body as { path: string; action: "revert" };
  if (action !== "revert") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const before = getCheckpoint(path);
  if (before === undefined) {
    return NextResponse.json({ error: "No checkpoint for that path" }, { status: 404 });
  }
  try {
    if (before === null) {
      await unlink(path);
    } else {
      await writeFile(path, before, "utf8");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
