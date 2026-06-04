import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { getActiveWorkspaceRoot } from "@/lib/workspaceState";

const execFileAsync = promisify(execFile);

// Cap response size to keep payloads sane on huge repos.
const MAX_FILES = 200;
const MAX_TOTAL_MATCHES = 1000;
const MAX_LINE_TEXT = 200;

// Build/dependency dirs we never want to grep through. Mirrors the SHALLOW_DIRS
// set in files/route.ts plus a few extras that are noisy but unsearchable.
const EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".vercel",
  ".cache",
  "target",
  "vendor",
  ".venv",
  "__pycache__",
];

interface SearchMatch {
  line: number;
  text: string;
  col: number;
}

interface FileResult {
  path: string;
  matches: SearchMatch[];
}

// Split a grep `-r -n` line into (path, lineNum, text). grep prints
// `path:line:text` and we know the path can contain colons in theory, but
// because we always anchor to "./" and grep emits the path verbatim, the
// FIRST two colons are the safe split points.
function parseGrepLine(line: string): { path: string; lineNum: number; text: string } | null {
  const firstColon = line.indexOf(":");
  if (firstColon < 0) return null;
  const secondColon = line.indexOf(":", firstColon + 1);
  if (secondColon < 0) return null;
  const rawPath = line.slice(0, firstColon);
  const lineNumStr = line.slice(firstColon + 1, secondColon);
  const text = line.slice(secondColon + 1);
  const lineNum = Number(lineNumStr);
  if (!Number.isInteger(lineNum) || lineNum < 1) return null;
  // Strip the leading "./" grep adds when invoked from the search root.
  const relPath = rawPath.startsWith("./") ? rawPath.slice(2) : rawPath;
  return { path: relPath, lineNum, text };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = body as { query?: unknown; caseSensitive?: unknown; regex?: unknown; workspaceRoot?: unknown };
  const query = typeof parsed.query === "string" ? parsed.query : "";
  const caseSensitive = parsed.caseSensitive === true;
  const regex = parsed.regex === true;
  const root =
    typeof parsed.workspaceRoot === "string" && parsed.workspaceRoot.trim()
      ? parsed.workspaceRoot.trim()
      : getActiveWorkspaceRoot();

  if (!root) {
    return NextResponse.json({ error: "No workspace folder open." }, { status: 500 });
  }

  if (!query.trim()) {
    return NextResponse.json({ results: [], totalMatches: 0, truncated: false });
  }

  // Build grep args. Flags:
  //   -r — recurse
  //   -n — line numbers
  //   -I — skip binary files (alias for --binary-files=without-match)
  //   --binary-files=without-match — explicit form (some BSD greps need this)
  //   --exclude-dir — skip noise directories
  //   -i — case-insensitive (when caseSensitive=false)
  //   -E — extended regex (when regex=true). Default is fixed-string (-F).
  const args: string[] = ["-r", "-n", "-I", "--binary-files=without-match"];
  for (const dir of EXCLUDED_DIRS) {
    args.push(`--exclude-dir=${dir}`);
  }
  if (!caseSensitive) args.push("-i");
  if (regex) args.push("-E");
  else args.push("-F");
  args.push("--", query, ".");

  let stdout = "";
  try {
    const result = await execFileAsync("grep", args, {
      cwd: root,
      // grep can spew megabytes on broad queries; 16 MiB buffer is enough for
      // ~1000 matches × ~200 chars × overhead. We truncate downstream too.
      maxBuffer: 16 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (err) {
    // grep exits 1 when there are no matches — that's not an error.
    // exit code 2 = real failure (bad regex, permission denied, etc.).
    const execErr = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    if (execErr.code === 1) {
      return NextResponse.json({ results: [], totalMatches: 0, truncated: false });
    }
    if (execErr.code === 2) {
      const stderr = execErr.stderr ?? execErr.message ?? "grep failed";
      return NextResponse.json({ error: stderr.trim() }, { status: 400 });
    }
    // Some greps return >1 on edge cases; if we got partial stdout, use it.
    stdout = execErr.stdout ?? "";
  }

  const fileMap = new Map<string, SearchMatch[]>();
  let totalMatches = 0;
  let truncated = false;

  const needleLower = query.toLowerCase();

  const lines = stdout.split("\n");
  for (const raw of lines) {
    if (!raw) continue;
    const parsed = parseGrepLine(raw);
    if (!parsed) continue;

    let existing = fileMap.get(parsed.path);
    if (!existing) {
      if (fileMap.size >= MAX_FILES) {
        truncated = true;
        continue;
      }
      existing = [];
      fileMap.set(parsed.path, existing);
    }

    // Compute the column of the first match on this line. For regex queries
    // we can't cheaply locate the exact match column, so we fall back to col 1
    // (the start of the line) — the editor will at least scroll to the right
    // line. For fixed-string queries we do a case-aware indexOf.
    let col = 1;
    if (!regex) {
      const hay = caseSensitive ? parsed.text : parsed.text.toLowerCase();
      const needle = caseSensitive ? query : needleLower;
      const idx = hay.indexOf(needle);
      if (idx >= 0) col = idx + 1;
    }

    const truncatedText =
      parsed.text.length > MAX_LINE_TEXT ? parsed.text.slice(0, MAX_LINE_TEXT) : parsed.text;

    existing.push({ line: parsed.lineNum, text: truncatedText, col });
    totalMatches += 1;

    if (totalMatches >= MAX_TOTAL_MATCHES) {
      truncated = true;
      break;
    }
  }

  const results: FileResult[] = Array.from(fileMap.entries())
    .map(([path, matches]) => ({ path, matches }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return NextResponse.json({ results, totalMatches, truncated });
}
