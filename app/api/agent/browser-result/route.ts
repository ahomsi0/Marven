// app/api/agent/browser-result/route.ts
//
// The renderer posts the result of a browser action here (see
// lib/agent/browserBridge.ts). Like /api/agent/approve, it's behind the
// same-origin and Host guards in middleware.ts.

import { NextRequest, NextResponse } from "next/server";
import { cleanBrowserResult, hasBrowserCall, resolveBrowserCall } from "@/lib/agent/browserBridge";

export async function POST(req: NextRequest) {
  let body: { callId?: unknown; result?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { callId } = body;
  if (typeof callId !== "string" || !callId) {
    return NextResponse.json({ error: "callId is required" }, { status: 400 });
  }
  const result = cleanBrowserResult(body.result);
  if (!result) {
    return NextResponse.json({ error: "Invalid result" }, { status: 400 });
  }
  if (!hasBrowserCall(callId)) {
    return NextResponse.json({ error: "No browser call with that callId" }, { status: 404 });
  }
  resolveBrowserCall(callId, result);
  return NextResponse.json({ ok: true });
}
