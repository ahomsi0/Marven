import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  try {
    const content = await readFile(path, "utf8");
    return NextResponse.json({ content });
  } catch (err) {
    return NextResponse.json({
      content: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
