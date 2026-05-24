import type { Mention, ResolvedMention } from "./types";

const HEADER =
  "The user attached the following context. Use it when answering. Do NOT use tools to re-read these files unless content changed.";

function refOf(m: Mention): string {
  switch (m.kind) {
    case "file":
    case "folder":
      return m.path;
    case "codebase":
      return `"${m.query}"`;
    case "web":
      return m.url;
  }
}

export function formatContextBlock(resolved: ResolvedMention[]): string {
  if (resolved.length === 0) return "";
  const parts: string[] = [HEADER, ""];
  for (const r of resolved) {
    if (r.ok) {
      parts.push(r.body);
    } else {
      parts.push(`[Attachment failed: ${r.mention.kind} ${refOf(r.mention)} — ${r.error ?? "unknown error"}]`);
    }
    parts.push("");
  }
  return `<context>\n${parts.join("\n").trimEnd()}\n</context>`;
}
