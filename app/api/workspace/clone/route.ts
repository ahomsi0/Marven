import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { homedir } from "os";
import path from "path";
import fs from "fs/promises";

function runClone(url: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("git", ["clone", url], { cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return reject(new Error("Git is not installed or not in PATH."));
        return reject(new Error((stderr || stdout || err.message).trim()));
      }
      resolve({ stdout, stderr });
    });
  });
}

function inferRepoName(url: string): string | null {
  // Match ".../name.git" or ".../name" — works for https + ssh forms
  const match = url.match(/[\/:]([\w.-]+?)(?:\.git)?\/?$/);
  return match ? match[1] : null;
}

export async function POST(req: NextRequest) {
  let body: { url?: string; parent?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const url = body.url?.trim();
  if (!url) return NextResponse.json({ error: "url is required" }, { status: 400 });
  if (!/^(https?:\/\/|git@|ssh:\/\/)/i.test(url)) {
    return NextResponse.json({ error: "URL must start with http(s)://, git@, or ssh://" }, { status: 400 });
  }

  const parent = body.parent?.trim() || path.join(homedir(), "Marven-Workspaces");
  try {
    await fs.mkdir(parent, { recursive: true });
  } catch (err) {
    return NextResponse.json({ error: `Could not create parent dir: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }

  const repoName = inferRepoName(url);
  if (!repoName) {
    return NextResponse.json({ error: "Could not infer repo name from URL" }, { status: 400 });
  }

  try {
    await runClone(url, parent);
    const clonedPath = path.join(parent, repoName);
    return NextResponse.json({ ok: true, path: clonedPath });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
