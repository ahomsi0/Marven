export interface MentionTrigger {
  /** The offset where '@' was typed. */
  startOffset: number;
  /** Text after '@' up to the cursor — used for filtering. */
  query: string;
}

/**
 * Returns the active mention trigger at `cursorOffset` if the user is typing
 * one, or null otherwise. A trigger is active when '@' appears in the line at
 * or before the cursor, with no whitespace between '@' and the cursor, and
 * with '@' either at the very start of input or preceded by whitespace.
 */
export function getActiveTrigger(text: string, cursorOffset: number): MentionTrigger | null {
  if (cursorOffset <= 0 || cursorOffset > text.length) return null;

  // Walk backwards from cursorOffset-1 looking for '@'. Bail on whitespace.
  for (let i = cursorOffset - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === "@") {
      // '@' must be at start of input OR preceded by whitespace.
      if (i > 0) {
        const prev = text[i - 1];
        if (!/\s/.test(prev)) return null;
      }
      return { startOffset: i, query: text.slice(i + 1, cursorOffset) };
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}
