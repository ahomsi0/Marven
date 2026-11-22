import { NextRequest, NextResponse } from "next/server";
import { clearWorkspace } from "../_state";

interface Body {
  workspaceRoot?: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const workspaceRoot = body.workspaceRoot?.trim();
  if (!workspaceRoot) {
    return NextResponse.json({ error: "workspaceRoot is required" }, { status: 400 });
  }
  try {
    await clearWorkspace(workspaceRoot);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
