import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getActiveWorkspaceRoot } from "@/lib/workspaceState";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm:  "text/html; charset=utf-8",
  css:  "text/css; charset=utf-8",
  js:   "application/javascript; charset=utf-8",
  mjs:  "application/javascript; charset=utf-8",
  ts:   "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg:  "image/svg+xml",
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  gif:  "image/gif",
  webp: "image/webp",
  ico:  "image/x-icon",
  woff: "font/woff",
  woff2:"font/woff2",
  ttf:  "font/ttf",
  txt:  "text/plain; charset=utf-8",
  md:   "text/plain; charset=utf-8",
};

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "path is required" }, { status: 400 });
  }

  const root = req.nextUrl.searchParams.get("root") || getActiveWorkspaceRoot();
  if (!root) {
    return NextResponse.json({ error: "No workspace open" }, { status: 400 });
  }

  const abs = path.resolve(root, filePath.replace(/^\//, ""));
  if (!abs.startsWith(root)) {
    return NextResponse.json({ error: "Path outside workspace" }, { status: 400 });
  }

  try {
    const buf = await fs.readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const contentType = MIME[ext] ?? "application/octet-stream";
    return new Response(buf, {
      headers: { "Content-Type": contentType, "Cache-Control": "no-cache" },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
