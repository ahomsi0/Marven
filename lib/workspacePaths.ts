import path from "path";

export function isPathInsideWorkspace(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

export function resolveWorkspacePath(root: string, targetPath: string): string {
  const abs = path.resolve(root, targetPath);
  if (!isPathInsideWorkspace(root, abs)) {
    throw new Error("Path outside workspace");
  }
  return abs;
}
