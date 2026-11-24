import type { WorkspaceFile } from "@/types";

/**
 * The page a built website opens on: a top-level index.html (or index.htm)
 * in the workspace. Returns its root-relative path, or null. Paths are
 * "/"-separated; nested files (docs/index.html) don't count.
 */
export function findSiteEntry(files: readonly WorkspaceFile[]): string | null {
  const top = files.filter((f) => f.type !== "folder" && !f.path.includes("/") && !f.path.includes("\\"));
  for (const name of ["index.html", "index.htm"]) {
    const hit = top.find((f) => f.path.toLowerCase() === name);
    if (hit) return hit.path;
  }
  return null;
}
