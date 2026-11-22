import { mkdir, readFile, readdir, writeFile } from "fs/promises";
import path from "path";
import type { WorkspaceFile } from "@/types";

const WORKSPACE_ROOT = process.cwd();
const IGNORED_NAMES = new Set([
  ".DS_Store",
  ".git",
  ".next",
  "node_modules",
]);

function normalizeRelativePath(relativePath: string): string {
  const trimmed = relativePath.trim().replace(/\\/g, "/");
  const normalized = path.posix.normalize(trimmed);
  if (!normalized || normalized === "." || normalized.startsWith("../")) {
    throw new Error("Invalid workspace path.");
  }
  return normalized;
}

export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT;
}

export function resolveWorkspacePath(relativePath: string): string {
  const safeRelativePath = normalizeRelativePath(relativePath);
  const absolutePath = path.resolve(WORKSPACE_ROOT, safeRelativePath);
  const rootWithSep = `${WORKSPACE_ROOT}${path.sep}`;

  if (absolutePath !== WORKSPACE_ROOT && !absolutePath.startsWith(rootWithSep)) {
    throw new Error("Path escapes the workspace root.");
  }

  return absolutePath;
}

async function walkWorkspace(
  currentDir: string,
  relativeDir = "",
  files: WorkspaceFile[] = [],
  depth = 0
): Promise<WorkspaceFile[]> {
  if (depth > 6 || files.length >= 400) return files;

  const entries = await readdir(currentDir, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) continue;

    const nextRelativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      await walkWorkspace(absolutePath, nextRelativePath, files, depth + 1);
    } else {
      files.push({
        path: nextRelativePath,
        name: entry.name,
      });
    }

    if (files.length >= 400) break;
  }

  return files;
}

export async function listWorkspaceFiles(): Promise<WorkspaceFile[]> {
  return walkWorkspace(WORKSPACE_ROOT);
}

export async function readWorkspaceFile(relativePath: string): Promise<string> {
  const absolutePath = resolveWorkspacePath(relativePath);
  return readFile(absolutePath, "utf8");
}

export async function writeWorkspaceFile(relativePath: string, content: string): Promise<void> {
  const absolutePath = resolveWorkspacePath(relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}
