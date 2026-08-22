// Workspace rules file support: projects can ship a MARVEN.md (or
// .marven/rules.md) whose contents are injected into the agent's system
// prompt — build conventions, architecture notes, "always run tests", etc.
// This is the Marven equivalent of CLAUDE.md / .cursorrules and is the
// single biggest lever on agent quality for a given repo.

import fs from "fs/promises";
import path from "path";

/** Candidate locations, in priority order. First hit wins. */
const RULES_CANDIDATES = ["MARVEN.md", ".marven/rules.md"];

/** Hard cap so a huge file can't blow up the context window. */
const MAX_RULES_BYTES = 16 * 1024;

export interface LoadedRules {
  /** Which file the rules came from (relative to the workspace root). */
  source: string;
  content: string;
}

/**
 * Load the workspace rules file, if one exists. Returns null when no rules
 * file is present (the overwhelmingly common case) so callers can skip the
 * prompt section entirely.
 */
export async function loadWorkspaceRules(
  workspaceRoot: string,
): Promise<LoadedRules | null> {
  for (const candidate of RULES_CANDIDATES) {
    const abs = path.join(workspaceRoot, candidate);
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) continue;
      // Cap before reading the whole thing into the prompt.
      const sizeCapped = Math.min(stat.size, MAX_RULES_BYTES);
      const fh = await fs.open(abs, "r");
      try {
        const { buffer } = await fh.read(
          Buffer.alloc(sizeCapped),
          0,
          sizeCapped,
          0,
        );
        const content = buffer.toString("utf8").trim();
        if (!content) continue;
        return { source: candidate, content };
      } finally {
        await fh.close();
      }
    } catch {
      // Not found / unreadable — try the next candidate.
      continue;
    }
  }
  return null;
}

/** Render the rules as a prompt section, or "" when there are none. */
export function formatRulesBlock(rules: LoadedRules | null): string {
  if (!rules || !rules.content.trim()) return "";
  return `### Project instructions (${rules.source})\n${rules.content.trim()}`;
}
