/** Some models serialize newlines as literal "\n"/"\t"/"\r" inside JSON strings.
 *  Only un-escape when the string has NO real newline already — otherwise we'd
 *  corrupt legitimate backslash-n/backslash-t in real file content (e.g. a
 *  source file that literally contains the two characters backslash and n). */
export function unescapeModelString(s: string): string {
  if (s.includes("\n")) return s;
  return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
}

export interface PatchEdit {
  search: string;
  replace: string;
}

export type PatchPlan =
  | { ok: true; content: string; summaries: string[] }
  | { ok: false; error: string };

/**
 * The model's `edits` argument as search/replace pairs (literal \n etc.
 * unescaped the way write_file does), or null when it isn't a non-empty array.
 */
export function parsePatchEdits(rawEdits: unknown): PatchEdit[] | null {
  if (!Array.isArray(rawEdits) || rawEdits.length === 0) return null;
  const text = (s: unknown) => (typeof s === "string" ? unescapeModelString(s) : "");
  return rawEdits.map((e: unknown) => {
    const o = (e ?? {}) as { search?: unknown; replace?: unknown };
    return { search: text(o.search), replace: text(o.replace) };
  });
}

export const PATCH_EDITS_INVALID = "apply_patch failed: edits must be a non-empty array.";

/**
 * Applies the edits to `content` in memory. Shared by the apply_patch executor
 * and the approval preview, so the diff the user approves is exactly what gets
 * written and both report the same errors.
 */
export function planApplyPatch(content: string, edits: PatchEdit[], displayPath: string): PatchPlan {
  let next = content;
  const summaries: string[] = [];
  for (let i = 0; i < edits.length; i++) {
    const { search, replace } = edits[i];
    if (!search) {
      return { ok: false, error: `apply_patch failed at edit #${i + 1}: 'search' is empty. To create a new file use write_file instead.` };
    }
    const firstIdx = next.indexOf(search);
    if (firstIdx === -1) {
      return { ok: false, error: `apply_patch failed at edit #${i + 1}: 'search' text not found in ${displayPath}. The text must match EXACTLY including whitespace. Read the file again, copy the snippet to replace, and retry. No edits were committed.` };
    }
    const secondIdx = next.indexOf(search, firstIdx + 1);
    if (secondIdx !== -1) {
      return { ok: false, error: `apply_patch failed at edit #${i + 1}: 'search' text appears multiple times in ${displayPath}. Add 1-2 lines of surrounding context (before/after) so the snippet is unique, then retry. No edits were committed.` };
    }
    next = next.slice(0, firstIdx) + replace + next.slice(firstIdx + search.length);
    const delta = replace.length - search.length;
    summaries.push(
      replace.length === 0
        ? `#${i + 1}: deleted ${search.length} chars`
        : delta > 0
          ? `#${i + 1}: +${delta} chars`
          : delta < 0
            ? `#${i + 1}: ${delta} chars`
            : `#${i + 1}: rewrote ${search.length} chars`,
    );
  }
  return { ok: true, content: next, summaries };
}

/**
 * Dry-run version of the apply_patch executor. Returns the resulting file
 * content after all edits, or null if any edit cannot be applied (search text
 * not found, ambiguous, or empty).
 */
export function simulateApplyPatch(content: string, edits: PatchEdit[]): string | null {
  const plan = planApplyPatch(content, edits, "");
  return plan.ok ? plan.content : null;
}
