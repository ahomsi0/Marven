// Client-side intents shared by the main chat and Mini Me. Timers and
// clipboard actions are handled in the renderer, before any API call.

const TIMER_RE =
  /(?:set (?:a )?timer for |timer (?:for )?|set (?:a )?timer )(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i;

export function parseTimer(text: string): { ms: number; label: string } | null {
  const match = text.trim().match(TIMER_RE);
  if (!match) return null;
  const amount = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  let ms: number;
  let label: string;
  if (/^(s|sec)/.test(unit)) {
    ms = amount * 1000;
    label = `${amount} second${amount !== 1 ? "s" : ""}`;
  } else if (/^(m|min)/.test(unit)) {
    ms = amount * 60 * 1000;
    label = `${amount} minute${amount !== 1 ? "s" : ""}`;
  } else {
    ms = amount * 60 * 60 * 1000;
    label = `${amount} hour${amount !== 1 ? "s" : ""}`;
  }
  return { ms, label };
}

export type ClipboardAction = "read" | "summarize" | "fix-grammar" | null;

export function detectClipboardAction(text: string): ClipboardAction {
  const lower = text.toLowerCase().trim();
  if (/^(?:what(?:'s| is) in my clipboard|read clipboard)$/.test(lower)) return "read";
  if (/^summarize (?:my )?clipboard$/.test(lower)) return "summarize";
  if (/^fix (?:my )?(?:clipboard|grammar)$/.test(lower)) return "fix-grammar";
  return null;
}

/** The prompt sent to the model for a clipboard action. */
export function clipboardPrompt(action: Exclude<ClipboardAction, null>, clip: string): string {
  if (action === "read") return `Here is my clipboard: ${clip}\n\nDescribe it briefly.`;
  if (action === "summarize") return `Summarize this text: ${clip}`;
  return `Fix the grammar, return only the corrected text: ${clip}`;
}
