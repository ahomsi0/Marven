// Pure helpers for Mini Me's project folders (slug, unique name, home checks).
// No fs here so Vitest can test them; the route does the I/O.

import path from "path";

export const DEFAULT_PROJECTS_DIR = "~/Marven Projects";
const SLUG_MAX = 40;

/** A folder-safe name: [a-z0-9-], at most 40 characters, "project" when nothing is left. */
export function projectSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  const result = slug || "project";
  return WINDOWS_RESERVED.test(result) ? `${result}-project` : result;
}

/** Folder names Windows refuses (with or without an extension). */
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** `base`, or `base-2`, `base-3`… when `taken` (compared case-insensitively) already has it. */
export function pickUniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Expands a leading "~" or "~/" (not "~user") against `home`. */
export function expandHome(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(home, p.slice(2));
  return p;
}

/** True when `child` is an absolute path that is a descendant of `parent` (not equal to it). */
export function isStrictlyInside(child: string, parent: string): boolean {
  if (!path.isAbsolute(child) || !path.isAbsolute(parent)) return false;
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * Why a projects parent folder is not acceptable, or null when it is fine.
 * `parent` must already be resolved (realpath of its existing part). Keeps new
 * projects out of dotfolders (~/.ssh) and ~/Library, which are never a good home for them.
 */
export function parentRejection(parent: string, home: string): string | null {
  if (!isStrictlyInside(parent, home)) return "parent must be inside your home folder";
  const segments = path.relative(path.resolve(home), path.resolve(parent)).split(path.sep);
  if (segments.some((s) => s.startsWith("."))) return "parent can't be a hidden folder (one starting with a dot)";
  if (segments[0].toLowerCase() === "library") return "parent can't be inside your Library folder";
  return null;
}
