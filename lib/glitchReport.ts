// Builds the "Report a glitch" issue. Nothing is sent from the app — the user
// reviews the prefilled GitHub issue in their browser and submits it themselves.

export const ISSUES_URL = "https://github.com/ahomsi0/Marven/issues/new";

// GitHub rejects very long query strings; keep the whole URL comfortably short.
const MAX_DESCRIPTION = 4000;
const MAX_TITLE = 80;

export interface GlitchDiagnostics {
  version: string;
  platform: string;
  provider: string;
}

export function glitchTitle(description: string): string {
  const firstLine = description.trim().split("\n")[0].trim();
  if (!firstLine) return "Glitch report";
  return firstLine.length > MAX_TITLE ? `${firstLine.slice(0, MAX_TITLE - 1)}…` : firstLine;
}

export function glitchBody(description: string, diagnostics: GlitchDiagnostics | null): string {
  let text = description.trim() || "_No description given._";
  if (text.length > MAX_DESCRIPTION) text = `${text.slice(0, MAX_DESCRIPTION)}\n\n_(truncated)_`;
  const sections = [`### What happened\n\n${text}`];
  if (diagnostics) {
    sections.push(
      [
        "### Diagnostics",
        "",
        `- Marven: v${diagnostics.version}`,
        `- Platform: ${diagnostics.platform}`,
        `- Provider: ${diagnostics.provider}`,
      ].join("\n"),
    );
  }
  return sections.join("\n\n");
}

export function glitchIssueUrl(description: string, diagnostics: GlitchDiagnostics | null): string {
  const params = new URLSearchParams({
    title: glitchTitle(description),
    body: glitchBody(description, diagnostics),
  });
  return `${ISSUES_URL}?${params.toString()}`;
}
