import fs from "fs/promises";
import path from "path";

const IGNORED_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
  ".DS_Store",
  "coverage",
  ".worktrees",
  ".vercel",
]);

/**
 * Returns a short, human-readable listing of the workspace's top files and
 * directories (up to two levels deep), capped so it never bloats the prompt.
 *
 * Designed to be injected into the lite system prompt so weak models don't
 * have to discover the file tree through trial-and-error tool calls (which
 * is where they tend to hallucinate phantom directories like `public/`).
 *
 * @param maxEntries Maximum total entries (files + dirs) to include. Defaults
 *   to 40 — enough to cover small projects fully, prevents prompt bloat on big
 *   repos. Truncation is signalled with a trailing "  …" line.
 */
export async function listWorkspaceTree(
  workspaceRoot: string,
  maxEntries = 40,
): Promise<string> {
  const lines: string[] = [];
  let count = 0;
  let truncated = false;

  let rootEntries: { name: string; isDir: boolean }[];
  try {
    const dirents = await fs.readdir(workspaceRoot, { withFileTypes: true });
    rootEntries = dirents
      .filter((d) => !IGNORED_NAMES.has(d.name) && !d.name.startsWith("."))
      .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    return "(workspace root unreadable)";
  }

  for (const entry of rootEntries) {
    if (count >= maxEntries) {
      truncated = true;
      break;
    }
    if (entry.isDir) {
      lines.push(`${entry.name}/`);
      count++;
      // Peek one level into the directory
      try {
        const subAbs = path.join(workspaceRoot, entry.name);
        const subDirents = await fs.readdir(subAbs, { withFileTypes: true });
        const subFiltered = subDirents
          .filter((d) => !IGNORED_NAMES.has(d.name) && !d.name.startsWith("."))
          .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
          .sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
        for (const sub of subFiltered) {
          if (count >= maxEntries) {
            truncated = true;
            break;
          }
          lines.push(`  ${sub.name}${sub.isDir ? "/" : ""}`);
          count++;
        }
      } catch {
        // Unreadable subdirectory — skip silently.
      }
    } else {
      lines.push(entry.name);
      count++;
    }
  }

  if (truncated) lines.push("  …");
  return lines.join("\n");
}
