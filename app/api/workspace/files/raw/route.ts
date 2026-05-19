// Stream raw file bytes from the active workspace. Used by the editor's
// image / PDF preview tabs — the text-decoded POST endpoint produces garbage
// for binary files, so we expose a separate GET that returns the bytes
// untouched along with a best-guess Content-Type so the browser can render
// images, PDFs, etc. inline.

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getActiveWorkspaceRoot } from "@/lib/workspaceState";

const CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  if (!target) {
    return NextResponse.json({ error: "path query parameter is required" }, { status: 400 });
  }
  const root = getActiveWorkspaceRoot();
  if (!root) {
    return NextResponse.json({ error: "No workspace folder open" }, { status: 400 });
  }
  const abs = path.resolve(root, target);
  if (!abs.startsWith(root)) {
    return NextResponse.json({ error: "Path outside workspace" }, { status: 400 });
  }
  try {
    const bytes = await fs.readFile(abs);
    const ext = abs.split(".").pop()?.toLowerCase() ?? "";
    const mime = CONTENT_TYPE[ext] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
