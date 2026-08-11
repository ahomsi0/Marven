import fs from "fs/promises";
import path from "path";
import ignore, { type Ignore } from "ignore";

// These names are intentionally protected even when a repository's .gitignore
// does not list them. Indexed snippets can be sent to a cloud model as context,
// so accidental secret ingestion is a privacy boundary, not just an indexing
// preference.
const SECRET_PATH = /(^|\/)(\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|credentials?\.(?:json|ya?ml)|secrets?\.(?:json|ya?ml)|service-account[^/]*\.json|id_[^/]+|[^/]+\.(?:pem|key|p12|pfx|jks|kdbx))$/i;

export function isSensitivePath(relativePath: string): boolean {
  return SECRET_PATH.test(relativePath.replaceAll(path.sep, "/"));
}

function normalizePattern(pattern: string): string {
  return pattern.trim().replaceAll("\\", "/");
}

export interface WorkspaceExclusions {
  gitignore: Ignore;
  custom: Ignore;
}

export async function loadWorkspaceExclusions(
  root: string,
  customPatterns: string[] = [],
): Promise<WorkspaceExclusions> {
  const gitignore = ignore();
  try {
    const contents = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    gitignore.add(contents);
  } catch {
    // A workspace does not need to be a Git repository to be indexed.
  }
  const custom = ignore();
  custom.add(customPatterns.map(normalizePattern).filter(Boolean));
  return { gitignore, custom };
}

export function shouldExclude(
  relativePath: string,
  isDirectory: boolean,
  exclusions: WorkspaceExclusions,
): boolean {
  const rel = relativePath.replaceAll(path.sep, "/");
  if (!rel || isSensitivePath(rel)) return true;
  const directoryRel = isDirectory ? `${rel}/` : rel;
  if (
    exclusions.gitignore.ignores(rel) || exclusions.gitignore.ignores(directoryRel) ||
    exclusions.custom.ignores(rel) || exclusions.custom.ignores(directoryRel)
  ) return true;
  return isDirectory && (rel === ".git" || rel.startsWith(".git/"));
}
