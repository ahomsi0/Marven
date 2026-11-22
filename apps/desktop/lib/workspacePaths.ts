import path from "path";
import { lstatSync, readlinkSync } from "fs";

export function isPathInsideWorkspace(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

const MAX_SYMLINK_HOPS = 40;

/**
 * Resolve every symlink along `p`, component by component, like realpath —
 * but tolerant of paths that don't exist yet AND of dangling symlinks.
 *
 * Each existing component is lstat'ed; a symlink is replaced by its target
 * (readlink, resolved relative to the link's directory, recursively). When a
 * component doesn't exist, the rest of the path is appended lexically. So a
 * dangling link `ws/evil -> ~/.zshenv` resolves to `~/.zshenv` rather than
 * to `ws/evil` — the old "realpath the nearest existing ancestor" approach
 * fell back to the parent directory and let such a link pass, after which
 * writing the file followed the link outside the workspace.
 */
export function resolveSymlinksLeniently(p: string, hops = { n: 0 }): string {
  const abs = path.resolve(p);
  const { root } = path.parse(abs);
  const parts = abs.slice(root.length).split(path.sep).filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    const next = path.join(cur, parts[i]);
    let isLink: boolean;
    try {
      isLink = lstatSync(next).isSymbolicLink();
    } catch {
      // Doesn't exist (yet): nothing further down can be a link.
      return path.join(next, ...parts.slice(i + 1));
    }
    if (!isLink) {
      cur = next;
      continue;
    }
    if (++hops.n > MAX_SYMLINK_HOPS) {
      throw new Error("Too many levels of symbolic links");
    }
    let target: string;
    try {
      target = readlinkSync(next);
    } catch {
      throw new Error("Unreadable symbolic link");
    }
    // `cur` is already fully resolved, so a relative target resolves against
    // the link's real directory.
    cur = resolveSymlinksLeniently(path.resolve(cur, target), hops);
  }
  return cur;
}

/** Re-check containment AFTER resolving symlinks, so a symlink living inside the
 *  workspace can't redirect a "safe" path to a target outside it — including a
 *  dangling symlink whose target doesn't exist yet (writing through it would
 *  create the file outside). Both root and target are resolved the same way,
 *  so shared symlink prefixes (e.g. macOS /tmp -> /private/tmp) don't cause
 *  false positives. */
export function assertRealpathInsideWorkspace(root: string, abs: string): void {
  const realRoot = resolveSymlinksLeniently(root);
  const real = resolveSymlinksLeniently(abs);
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
