export type AgentTier = "simple" | "standard";

const SIGNAL_WORDS = [
  "change", "color", "colour", "rename", "fix", "replace", "update", "typo",
  "style", "font", "size", "margin", "padding", "border", "background", "text",
];

const COMPLEXITY_WORDS = [
  "create", "build", "install", "feature", "refactor", "add", "connect",
  "all files", "multiple", "across",
];

/**
 * Classifies a user prompt as "simple" (single-file style tweak) or
 * "standard" (anything requiring more reasoning or multiple files).
 *
 * A prompt is "simple" when ALL of:
 *  - word count ≤ 120
 *  - contains at least one SIGNAL word
 *  - contains no COMPLEXITY word
 */
export function classifyTask(prompt: string): AgentTier {
  const lower = prompt.toLowerCase();
  const wordCount = lower.trim().split(/\s+/).length;

  if (wordCount > 120) return "standard";

  const hasSignal = SIGNAL_WORDS.some((w) => lower.includes(w));
  if (!hasSignal) return "standard";

  const hasComplexity = COMPLEXITY_WORDS.some((w) => lower.includes(w));
  if (hasComplexity) return "standard";

  return "simple";
}
