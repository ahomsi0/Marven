import { NextRequest, NextResponse } from "next/server";
import { resolveApproval, hasPending } from "@/lib/agent/approvals";

export async function POST(req: NextRequest) {
  let body: { callId?: string; accept?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { callId, accept } = body;
  if (!callId || typeof accept !== "boolean") {
    return NextResponse.json({ error: "callId and accept are required" }, { status: 400 });
  }
  if (!hasPending(callId)) {
    return NextResponse.json({ error: "No pending approval for that callId" }, { status: 404 });
  }
  resolveApproval(callId, accept);
  return NextResponse.json({ ok: true });
}
