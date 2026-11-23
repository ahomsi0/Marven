// Mini Me's decisions: where a request goes, what the model is told, and the
// short rolling history it keeps. Pure, so it can be unit-tested.

import { parseCommand } from "@/lib/commandParser";
import { detectClipboardAction, parseTimer, type ClipboardAction } from "@/lib/chatIntents";

export type Route =
  | { kind: "timer"; ms: number; label: string }
  | { kind: "clipboard"; action: Exclude<ClipboardAction, null> }
  | { kind: "agent" }
  | { kind: "command" }
  | { kind: "chat" };

// Jobs Mini Me never does itself: running commands, changing files, driving a
// browser. They go to Marven's Agent, which asks before acting.
const AGENT_ONLY: RegExp[] = [
  /^(?:please\s+)?(?:run|execute)\s+(?:the\s+|a\s+|this\s+|that\s+)?(?:command|script|shell|terminal|npm|npx|yarn|git|python|node)\b/i,
  /\b(?:create|make|edit|modify|delete|remove|rename|move|write(?:\s+to)?)\s+(?:a\s+|an\s+|the\s+|this\s+|that\s+|my\s+)?(?:new\s+)?(?:file|folder|directory)\b/i,
  /\b(?:browse|navigate)\s+to\b.*\b(?:and|then)\b/i,
];

export function routeInput(text: string, opts: { allowCommands: boolean }): Route {
  const timer = parseTimer(text);
  if (timer) return { kind: "timer", ...timer };
  const clip = detectClipboardAction(text);
  if (clip) return { kind: "clipboard", action: clip };
  if (AGENT_ONLY.some((re) => re.test(text))) return { kind: "agent" };
  if (opts.allowCommands && parseCommand(text).type !== null) return { kind: "command" };
  return { kind: "chat" };
}

export const AGENT_HANDOFF_REPLY = "That's a job for Marven's Agent. Want to open it there?";

export const COMPANION_PERSONA =
  "You are Mini Me, a tiny pixel-art version of the user who lives on their screen. You speak in a speech bubble, so keep every reply to 1–3 short sentences unless they ask for more. Be warm and a little playful.";

/** Marven's base prompt plus the Mini Me persona, with the user's custom instructions first and last (as the main chat does). */
export function buildCompanionPrompt(base: string, extra: string): string {
  const withPersona = `${base}\n\n${COMPANION_PERSONA}`;
  const e = extra.trim();
  return e
    ? `### PRIORITY INSTRUCTIONS (always follow these):\n${e}\n\n---\n\n${withPersona}\n\n---\n\nREMINDER: ${e}`
    : withPersona;
}

export interface CompanionMessage {
  role: "user" | "assistant";
  content: string;
}

export const HISTORY_LIMIT = 20;
export const HISTORY_KEY = "marven-companion-history";

export function appendHistory(history: CompanionMessage[], ...messages: CompanionMessage[]): CompanionMessage[] {
  return [...history, ...messages].slice(-HISTORY_LIMIT);
}

function isMessage(value: unknown): value is CompanionMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as { role?: unknown; content?: unknown };
  return (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
}

export function loadHistory(storage: Pick<Storage, "getItem">): CompanionMessage[] {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMessage).slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveHistory(storage: Pick<Storage, "setItem">, history: CompanionMessage[]): void {
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  } catch {
    /* quota errors are non-fatal */
  }
}
