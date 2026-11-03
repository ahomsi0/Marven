// Builds the "Report a problem" GitHub issue (Settings → About). Nothing is
// sent from the app: the user reviews the prefilled issue in their browser and
// submits it there, or copies the report text.

import { ISSUES_URL, glitchTitle } from "./glitchReport";

/** GitHub rejects very long query strings; stay well under its limit. */
export const MAX_ISSUE_URL_LENGTH = 7000;
const MAX_DESCRIPTION = 4000;

export interface ReportAppInfo {
  version: string;
  platform: string;
  provider?: string | null;
  model?: string | null;
}

export interface ProblemReportInput {
  description: string;
  /** null when the user unticked "Include app info". */
  appInfo: ReportAppInfo | null;
  /** Already-redacted log lines, oldest first; null when not included. */
  logs: readonly string[] | null;
}

export interface ProblemReport {
  title: string;
  /** The full report (all logs) — what "Copy report" puts on the clipboard. */
  body: string;
  /** The prefilled new-issue URL, trimmed to fit MAX_ISSUE_URL_LENGTH. */
  url: string;
  /** How many of the oldest log lines were left out of the URL. */
  omittedLogLines: number;
  /** True when the description itself had to be shortened for the URL. */
  descriptionTruncated: boolean;
}

function descriptionSection(description: string, maxChars = MAX_DESCRIPTION): string {
  let text = description.trim() || "_No description given._";
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n\n_(truncated)_`;
  return `### What happened\n\n${text}`;
}

function appInfoSection(info: ReportAppInfo): string {
  const rows = [`- Marven: v${info.version}`, `- OS: ${info.platform}`];
  if (info.provider) rows.push(`- Provider: ${info.provider}`);
  if (info.model) rows.push(`- Model: ${info.model}`);
  return ["### App info", "", ...rows].join("\n");
}

function logsSection(lines: readonly string[], omitted: number): string {
  const note = omitted > 0
    ? `_${omitted} earlier log line${omitted === 1 ? "" : "s"} left out to fit the issue link. Use "Copy report" in Marven for the full log._\n\n`
    : "";
  // A run of backticks inside a log line can't close a longer fence.
  const fence = "`".repeat(Math.max(3, longestBacktickRun(lines) + 1));
  return `### Recent logs\n\n${note}${fence}text\n${lines.join("\n")}\n${fence}`;
}

function longestBacktickRun(lines: readonly string[]): number {
  let max = 0;
  for (const line of lines) {
    for (const m of line.match(/`+/g) ?? []) max = Math.max(max, m.length);
  }
  return max;
}

/** The report body exactly as it will appear in the issue / clipboard. */
export function buildReportBody(
  input: ProblemReportInput,
  opts: { omitLogLines?: number; descriptionChars?: number } = {},
): string {
  const sections = [descriptionSection(input.description, opts.descriptionChars)];
  if (input.appInfo) sections.push(appInfoSection(input.appInfo));
  if (input.logs && input.logs.length > 0) {
    const omit = Math.min(opts.omitLogLines ?? 0, input.logs.length);
    sections.push(logsSection(input.logs.slice(omit), omit));
  }
  return sections.join("\n\n");
}

function issueUrl(title: string, body: string): string {
  const params = new URLSearchParams({ title, body });
  return `${ISSUES_URL}?${params.toString()}`;
}

/**
 * Builds the report. The clipboard body always carries every log line; the
 * issue URL drops the oldest log lines (with a note) until it fits, and as a
 * last resort shortens the description.
 */
export function buildProblemReport(
  input: ProblemReportInput,
  maxUrlLength = MAX_ISSUE_URL_LENGTH,
): ProblemReport {
  const title = glitchTitle(input.description);
  const body = buildReportBody(input);
  const fits = (b: string) => issueUrl(title, b).length <= maxUrlLength;

  if (fits(body)) {
    return { title, body, url: issueUrl(title, body), omittedLogLines: 0, descriptionTruncated: false };
  }

  const logCount = input.logs?.length ?? 0;
  if (logCount > 0) {
    // Fewest dropped lines that fit (binary search: more dropped → shorter).
    let lo = 1;
    let hi = logCount;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fits(buildReportBody(input, { omitLogLines: mid }))) {
        best = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    // Dropping every line still leaves a note; only accept that if it fits.
    if (best !== -1 && best < logCount) {
      const trimmed = buildReportBody(input, { omitLogLines: best });
      return { title, body, url: issueUrl(title, trimmed), omittedLogLines: best, descriptionTruncated: false };
    }
  }

  // Even without logs it's too long (e.g. a very long non-Latin description,
  // which percent-encodes to several bytes per character). Leave the logs out
  // and shorten the description until it fits.
  const noLogs: ProblemReportInput = { ...input, logs: null };
  const fullChars = Math.min(input.description.trim().length, MAX_DESCRIPTION);
  let lo = 0;
  let hi = fullChars;
  let bestChars = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(buildReportBody(noLogs, { descriptionChars: mid }))) {
      bestChars = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const short = buildReportBody(noLogs, { descriptionChars: bestChars });
  return {
    title,
    body,
    url: issueUrl(title, short),
    omittedLogLines: logCount,
    descriptionTruncated: bestChars < fullChars,
  };
}
