// Stream raw file bytes from the active workspace. Used by the editor's
// image / PDF preview tabs — the text-decoded POST endpoint produces garbage
// for binary files, so we expose a separate GET that returns the bytes
// untouched along with a best-guess Content-Type so the browser can render
// images, PDFs, etc. inline.

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import {
  resolveRequestRoot,
  workspaceErrorStatus,
} from "@/lib/workspaceState";
import { resolveWorkspacePath } from "@/lib/workspacePaths";

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
  const rootParam = url.searchParams.get("root");
  const root = resolveRequestRoot(rootParam);
  if (!target) {
    return NextResponse.json({ error: "path query parameter is required" }, { status: 400 });
  }
  if (!root) {
    return NextResponse.json(
      { error: rootParam ? "Workspace not approved" : "No workspace folder open" },
      { status: rootParam ? 403 : 400 },
    );
  }
  try {
    const abs = resolveWorkspacePath(root, target);
    const bytes = await fs.readFile(abs);
    const ext = abs.split(".").pop()?.toLowerCase() ?? "";
    const mime = CONTENT_TYPE[ext] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "no-store",
        // This endpoint is embedded in preview iframes. Without a sandboxing
        // CSP, fetched HTML/SVG would execute as a same-origin document with
        // full access to every local API route (same gap the serve/preview
        // routes already close).
        "Content-Security-Policy":
          "sandbox; default-src 'none'; img-src data: blob:; media-src data: blob:; object-src 'none'; script-src 'none'; style-src 'none'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read file";
    return NextResponse.json({ error: message }, { status: workspaceErrorStatus(message) });
  }
}
