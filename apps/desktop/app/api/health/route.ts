import { NextRequest, NextResponse } from "next/server";

export function GET(req: NextRequest) {
  const expectedToken = process.env.MARVEN_HEALTH_TOKEN;
  if (expectedToken && req.headers.get("x-marven-health-token") !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, service: "marven", version: process.env.npm_package_version ?? null });
}
