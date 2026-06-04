import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getActiveWorkspaceRoot } from "@/lib/workspaceState";
import { resolveWorkspacePath } from "@/lib/workspacePaths";

/**
 * Path-based preview server.
 *
 * The older `/api/workspace/serve?path=index.html&root=...` route serves the
 * requested file fine on its own — but a browser resolves relative URLs in
 * that response against `/api/workspace/serve`, not against the workspace
 * directory. So `<link rel="stylesheet" href="style.css">` inside the served
 * HTML resolves to `/api/workspace/style.css` (404) and the page renders
 * unstyled.
 *
 * Solution: serve the same file through a *path-shaped* URL like
 * `/api/workspace/preview/index.html`. Then `style.css` resolves to
 * `/api/workspace/preview/style.css` and everything Just Works™.
 */

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  map: "application/json; charset=utf-8",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params;
  // `slug` is the array of path segments after /api/workspace/preview/. Glue
  // them back together so we resolve "src/components/Button.tsx" correctly.
  const relPath = slug.map(decodeURIComponent).join("/");
  if (!relPath) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const root = req.nextUrl.searchParams.get("root") || getActiveWorkspaceRoot();
  if (!root) {
    return NextResponse.json({ error: "No workspace open" }, { status: 400 });
  }

  try {
    const abs = resolveWorkspacePath(root, relPath);
    const buf = await fs.readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const contentType = MIME[ext] ?? "application/octet-stream";
    return new Response(buf, {
      headers: { "Content-Type": contentType, "Cache-Control": "no-cache" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "File not found";
    const status = message === "Path outside workspace" ? 400 : 404;
    return NextResponse.json({ error: message }, { status });
  }
}
