import { NextRequest, NextResponse } from "next/server";
import { cancelRun } from "../_state";

export async function POST(req: NextRequest) {
  let workspaceRoot: string | undefined;
  try {
    const body = (await req.json()) as { workspaceRoot?: unknown };
    if (typeof body.workspaceRoot === "string") workspaceRoot = body.workspaceRoot.trim();
  } catch {
    // Optional body for backwards compatibility.
  }
  const ok = cancelRun(workspaceRoot);
  return NextResponse.json({ ok });
}
