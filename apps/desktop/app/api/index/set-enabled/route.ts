import { NextRequest, NextResponse } from "next/server";
import { setEnabled, cancelRun } from "../_state";

interface Body {
  enabled?: boolean;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  setEnabled(body.enabled);
  if (!body.enabled) cancelRun();
  return NextResponse.json({ ok: true });
}
