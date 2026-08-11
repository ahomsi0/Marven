import { NextRequest, NextResponse } from "next/server";
import { getExcludePatterns, setExcludePatterns } from "../_state";

export async function GET() {
  return NextResponse.json({ excludePatterns: getExcludePatterns() });
}

export async function POST(req: NextRequest) {
  let body: { excludePatterns?: unknown };
  try {
    body = (await req.json()) as { excludePatterns?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.excludePatterns) || body.excludePatterns.some((p) => typeof p !== "string")) {
    return NextResponse.json({ error: "excludePatterns must be an array of strings" }, { status: 400 });
  }
  setExcludePatterns(body.excludePatterns.slice(0, 100));
  return NextResponse.json({ ok: true, excludePatterns: getExcludePatterns() });
}
