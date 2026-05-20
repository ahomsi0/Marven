import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getActiveWorkspaceRoot } from "@/lib/workspaceState";

function getRoot(): string {
  const root = getActiveWorkspaceRoot();
  if (!root) throw new Error("No workspace folder open.");
  return root;
}

function safePath(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error("Path outside workspace");
  }
  return abs;
}

async function copyRecursive(src: string, dest: string): Promise<void> {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    await Promise.all(
      entries.map((e) =>
        copyRecursive(path.join(src, e.name), path.join(dest, e.name))
      )
    );
  } else {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
  }
}

function deriveCopyPath(rel: string): string {
  const dir = path.dirname(rel);
  const base = path.basename(rel, path.extname(rel));
  const ext = path.extname(rel);
  const prefix = dir === "." ? "" : dir + "/";
  return `${prefix}${base} copy${ext}`;
}

// DELETE — delete a file or folder recursively
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const targetPath = typeof body.path === "string" ? body.path : "";
    if (!targetPath.trim())
      return NextResponse.json({ error: "path is required" }, { status: 400 });

    const root = getRoot();
    const abs = safePath(root, targetPath);

    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) return NextResponse.json({ error: "Path not found" }, { status: 404 });

    if (stat.isDirectory()) {
      await fs.rm(abs, { recursive: true, force: true });
    } else {
      await fs.unlink(abs);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST — copy (duplicate) a file or folder
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const targetPath = typeof body.path === "string" ? body.path : "";
    if (!targetPath.trim())
      return NextResponse.json({ error: "path is required" }, { status: 400 });

    const root = getRoot();
    const src = safePath(root, targetPath);

    const stat = await fs.stat(src).catch(() => null);
    if (!stat) return NextResponse.json({ error: "Path not found" }, { status: 404 });

    // Find a unique copy name (foo copy.ts, foo copy 2.ts, ...)
    let destRel = deriveCopyPath(targetPath);
    let destAbs = path.resolve(root, destRel);
    let counter = 2;
    while (await fs.stat(destAbs).catch(() => null)) {
      const dir = path.dirname(targetPath);
      const base = path.basename(targetPath, path.extname(targetPath));
      const ext = path.extname(targetPath);
      const prefix = dir === "." ? "" : dir + "/";
      destRel = `${prefix}${base} copy ${counter}${ext}`;
      destAbs = path.resolve(root, destRel);
      counter++;
    }

    await copyRecursive(src, destAbs);
    return NextResponse.json({ ok: true, path: destRel });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not copy.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
