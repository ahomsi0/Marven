/**
 * Dry-run version of the apply_patch executor. Returns the resulting file
 * content after all edits, or null if any edit cannot be applied (search text
 * not found, ambiguous, or empty).
 *
 * Mirrors the exact search/replace logic in tools.ts so the preview diff
 * matches what would actually be written.
 */
export function simulateApplyPatch(
  content: string,
  edits: Array<{ search: string; replace: string }>,
): string | null {
  let result = content;
  for (const { search, replace } of edits) {
    if (!search) return null;
    const firstIdx = result.indexOf(search);
    if (firstIdx === -1) return null;
    const secondIdx = result.indexOf(search, firstIdx + 1);
    if (secondIdx !== -1) return null;
    result = result.slice(0, firstIdx) + replace + result.slice(firstIdx + search.length);
  }
  return result;
}
