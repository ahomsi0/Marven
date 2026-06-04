import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { getActiveWorkspaceRoot } from "@/lib/workspaceState";
import { resolveWorkspacePath } from "@/lib/workspacePaths";

interface ReplaceRequest {
  query: string;
  replacement: string;
  caseSensitive?: boolean;
  regex?: boolean;
  files?: string[]; // relative paths; if absent, replace in ALL matched files
  workspaceRoot?: string;
}

export async function POST(req: NextRequest) {
  let body: ReplaceRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const root = body.workspaceRoot?.trim() || getActiveWorkspaceRoot();
  if (!root) {
    return NextResponse.json({ error: "No workspace folder open." }, { status: 500 });
  }

  const { query, replacement, caseSensitive = false, regex = false, files } = body;
  if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });

  let pattern: RegExp;
  try {
    pattern = regex
      ? new RegExp(query, caseSensitive ? "g" : "gi")
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
  } catch {
    return NextResponse.json({ error: "Invalid regex pattern" }, { status: 400 });
  }

  // If no specific files given, discover them by running the search
  let targetFiles = files;
  if (!targetFiles) {
    // Run the search endpoint logic inline: grep for matching files
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const EXCLUDED_DIRS = ["node_modules", ".git", ".next", "dist", "build", ".turbo", ".cache", "target", "vendor", ".venv", "__pycache__"];
    const args = ["-r", "-l", "-I", "--binary-files=without-match"];
    for (const dir of EXCLUDED_DIRS) args.push(`--exclude-dir=${dir}`);
    if (!caseSensitive) args.push("-i");
    if (regex) args.push("-E"); else args.push("-F");
    args.push("--", query, ".");
    try {
      const { stdout } = await execFileAsync("grep", args, { cwd: root, maxBuffer: 4 * 1024 * 1024 });
      targetFiles = stdout.trim().split("\n").filter(Boolean).map((p) => p.startsWith("./") ? p.slice(2) : p);
    } catch (err) {
      const e = err as { code?: number };
      if (e.code === 1) return NextResponse.json({ replacedCount: 0, filesModified: [] }); // no matches
      return NextResponse.json({ error: "Search failed" }, { status: 500 });
    }
  }

  const filesModified: string[] = [];
  let replacedCount = 0;

  for (const relPath of targetFiles) {
    try {
      const absPath = resolveWorkspacePath(root, relPath);
      const content = await readFile(absPath, "utf8");
      let count = 0;
      const next = content.replace(pattern, (match) => { count++; return replacement; });
      if (count > 0) {
        await writeFile(absPath, next, "utf8");
        filesModified.push(relPath);
        replacedCount += count;
        // Reset regex lastIndex for global patterns
        pattern.lastIndex = 0;
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Path outside workspace") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      // Skip unreadable files
    }
  }

  return NextResponse.json({ replacedCount, filesModified });
}
