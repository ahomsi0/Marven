import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

let activeWorkspaceRoot: string | null = null;

function getRoot(): string {
  if (!activeWorkspaceRoot) throw new Error("No workspace folder open.");
  return activeWorkspaceRoot;
}

type FileEntry = { path: string; name: string; type: "file" | "folder" };

// Folders we show in the tree but don't recurse into (their contents are listed
// shallowly — one level deep — so the user can see they exist without exploding
// the listing on huge dependency directories).
const SHALLOW_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", ".turbo", ".vercel",
  ".cache", "target", "vendor", ".venv", "__pycache__",
]);

async function listRecursive(dir: string, base: string, shallow = false): Promise<FileEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: FileEntry[] = [];
  for (const entry of entries) {
    const rel = path.relative(base, path.join(dir, entry.name));
    if (entry.isDirectory()) {
      results.push({ path: rel, name: entry.name, type: "folder" });
      if (shallow) continue;
      const childShallow = SHALLOW_DIRS.has(entry.name);
      const nested = await listRecursive(path.join(dir, entry.name), base, childShallow);
      results.push(...nested);
    } else {
      results.push({ path: rel, name: entry.name, type: "file" });
    }
  }
  return results;
}

export async function GET() {
  if (!activeWorkspaceRoot) {
    return NextResponse.json({ root: null, files: [] });
  }
  try {
    const files = await listRecursive(activeWorkspaceRoot, activeWorkspaceRoot);
    return NextResponse.json({ root: activeWorkspaceRoot, files });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load files.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const root = typeof body.root === "string" ? body.root.trim() : "";
    if (!root) return NextResponse.json({ error: "root is required" }, { status: 400 });

    const stat = await fs.stat(root).catch(() => null);
    if (!stat?.isDirectory()) {
      return NextResponse.json({ error: `"${root}" is not a valid directory` }, { status: 400 });
    }
    activeWorkspaceRoot = root;
    return NextResponse.json({ ok: true, root });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const targetPath = typeof body.path === "string" ? body.path : "";
    if (!targetPath.trim()) return NextResponse.json({ error: "path is required" }, { status: 400 });

    const root = getRoot();
    const abs = path.resolve(root, targetPath);
    if (!abs.startsWith(root)) return NextResponse.json({ error: "Path outside workspace" }, { status: 400 });

    const content = await fs.readFile(abs, "utf-8");
    return NextResponse.json({ path: targetPath, content });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read file.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const targetPath = typeof body.path === "string" ? body.path : "";
    const content = typeof body.content === "string" ? body.content : "";
    if (!targetPath.trim()) return NextResponse.json({ error: "path is required" }, { status: 400 });

    const root = getRoot();
    const abs = path.resolve(root, targetPath);
    if (!abs.startsWith(root)) return NextResponse.json({ error: "Path outside workspace" }, { status: 400 });

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not write file.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
