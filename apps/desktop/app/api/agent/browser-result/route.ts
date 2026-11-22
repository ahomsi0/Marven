// app/api/agent/browser-result/route.ts
//
// The renderer posts the result of a browser action here (see
// lib/agent/browserBridge.ts) as { callId, runId, result }. The runId must be
// the run that owns the call, so one run's result can't answer another's.
// Like /api/agent/approve, it's behind the same-origin and Host guards in
// middleware.ts.

import { NextRequest, NextResponse } from "next/server";
import { cleanBrowserResult, resolveBrowserCall } from "@/lib/agent/browserBridge";

export async function POST(req: NextRequest) {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object") {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }
  const body = parsed as { callId?: unknown; runId?: unknown; result?: unknown };
  const { callId, runId } = body;
  if (typeof callId !== "string" || !callId) {
    return NextResponse.json({ error: "callId is required" }, { status: 400 });
  }
  if (typeof runId !== "string" || !runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }
  const result = cleanBrowserResult(body.result);
  if (!result) {
    return NextResponse.json({ error: "Invalid result" }, { status: 400 });
  }
  if (!resolveBrowserCall(callId, runId, result)) {
    return NextResponse.json({ error: "No browser call with that callId for this run" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
