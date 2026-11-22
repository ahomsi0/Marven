import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getIndexer, isEnabled } from "../_state";

interface Body {
  workspaceRoot?: string;
  // Either absolute path or workspace-relative — we resolve against
  // workspaceRoot when relative.
  path?: string;
}

export async function POST(req: NextRequest) {
  if (!isEnabled()) return NextResponse.json({ ok: false, disabled: true });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const workspaceRoot = body.workspaceRoot?.trim();
  const rel = body.path?.trim();
  if (!workspaceRoot || !rel) {
    return NextResponse.json(
      { error: "workspaceRoot and path are required" },
      { status: 400 },
    );
  }
  const abs = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
  try {
    await getIndexer(workspaceRoot).updateFile(abs);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
