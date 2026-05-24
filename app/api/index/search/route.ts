import { NextRequest, NextResponse } from "next/server";
import { searchCodebase } from "@/lib/index/search";
import { isEnabled } from "../_state";

interface Body {
  workspaceRoot?: string;
  query?: string;
  limit?: number;
}

export async function POST(req: NextRequest) {
  if (!isEnabled()) return NextResponse.json([], { status: 200 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const workspaceRoot = body.workspaceRoot?.trim();
  const query = body.query?.trim();
  if (!workspaceRoot || !query) {
    return NextResponse.json(
      { error: "workspaceRoot and query are required" },
      { status: 400 },
    );
  }
  try {
    const results = await searchCodebase({
      workspaceRoot,
      query,
      limit: body.limit,
    });
    return NextResponse.json(results);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
