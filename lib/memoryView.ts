// Pure helpers for Settings → Memory: relative dates and Markdown export.

export interface MemoryViewEntry {
  id: string;
  timestamp: string | null;
  text: string;
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/**
 * "3 days ago" / "منذ 3 أيام". Returns null for a missing or unreadable
 * timestamp, and `justNow` for anything under a minute (or in the future).
 */
export function relativeMemoryDate(
  timestamp: string | null,
  now: Date,
  language: string,
  justNow: string,
): string | null {
  if (!timestamp) return null;
  const then = Date.parse(timestamp);
  if (Number.isNaN(then)) return null;
  const seconds = Math.round((now.getTime() - then) / 1000);
  if (seconds < 60) return justNow;
  const fmt = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return fmt.format(-Math.floor(seconds / size), unit);
  }
  return justNow;
}

/** A Markdown file of one memory section, in the same format Marven stores. */
export function memoryExportMarkdown(heading: string, entries: readonly MemoryViewEntry[]): string {
  const lines = entries.map((e) =>
    e.timestamp ? `- [${e.timestamp}] ${e.text.replace(/\n/g, "\n  ")}` : `- ${e.text.replace(/\n/g, "\n  ")}`,
  );
  return `# ${heading}\n\n${lines.join("\n")}\n`;
}

/** Safe file name for an exported section, e.g. "marven-memory-global-2026-11-02.md". */
export function memoryExportFileName(scope: string, now: Date): string {
  return `marven-memory-${scope}-${now.toISOString().slice(0, 10)}.md`;
}
