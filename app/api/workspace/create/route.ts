import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const root = typeof body.root === "string" ? body.root.trim() : "";
    const relPath = typeof body.path === "string" ? body.path.trim() : "";
    const type = body.type === "folder" ? "folder" : "file";

    if (!root) return NextResponse.json({ error: "root is required" }, { status: 400 });
    if (!relPath) return NextResponse.json({ error: "path is required" }, { status: 400 });

    const abs = path.resolve(root, relPath);
    if (!abs.startsWith(root + path.sep) && abs !== root) {
      return NextResponse.json({ error: "Path outside workspace" }, { status: 400 });
    }

    const exists = await fs.stat(abs).catch(() => null);
    if (exists) {
      return NextResponse.json({ error: "Already exists" }, { status: 409 });
    }

    if (type === "folder") {
      await fs.mkdir(abs, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, "", "utf-8");
    }
    return NextResponse.json({ ok: true, path: relPath, type });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
