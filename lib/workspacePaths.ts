import path from "path";
import { realpathSync } from "fs";

export function isPathInsideWorkspace(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

/** Resolve symlinks on the deepest existing ancestor of `p` (so a not-yet-created
 *  file resolves via its parent dir). */
function nearestRealpath(p: string): string {
  let probe = p;
  for (;;) {
    try {
      return realpathSync(probe);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return probe; // reached filesystem root
      probe = parent;
    }
  }
}

/** Re-check containment AFTER resolving symlinks, so a symlink living inside the
 *  workspace can't redirect a "safe" path to a target outside it. Both root and
 *  target are realpath-resolved so shared symlink prefixes (e.g. macOS
 *  /tmp -> /private/tmp) don't cause false positives. */
export function assertRealpathInsideWorkspace(root: string, abs: string): void {
  const realRoot = nearestRealpath(root);
  const real = nearestRealpath(abs);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new Error("Path outside workspace");
  }
}

export function resolveWorkspacePath(root: string, targetPath: string): string {
  const abs = path.resolve(root, targetPath);
  if (!isPathInsideWorkspace(root, abs)) {
    throw new Error("Path outside workspace");
  }
  assertRealpathInsideWorkspace(root, abs);
  return abs;
}
