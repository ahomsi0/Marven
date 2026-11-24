// Mini Me's decisions: where a request goes, what the model is told, and the
// short rolling history it keeps. Pure, so it can be unit-tested.

import { parseCommand } from "@/lib/commandParser";
import { projectSlug } from "@/lib/companion/projectFolder";
import { detectClipboardAction, parseTimer, type ClipboardAction } from "@/lib/chatIntents";

export type Route =
  | { kind: "timer"; ms: number; label: string }
  | { kind: "clipboard"; action: Exclude<ClipboardAction, null> }
  | { kind: "agent" }
  | { kind: "build"; name: string }
  | { kind: "command" }
  | { kind: "chat" };

// Jobs Mini Me never does itself: running commands, changing files, driving a
// browser. They go to Marven's Agent, which asks before acting.
const AGENT_ONLY: RegExp[] = [
  /\b(?:run|execute)\s+(?:the\s+|a\s+|this\s+|that\s+)?(?:command|script|shell|terminal|npm|npx|pnpm|yarn|git|python|node|pip|brew|sudo|rm|ls|mkdir|chmod)\b/i,
  /^\s*(?:sudo|rm|chmod|mkdir|pip|pip3|brew|npm|npx|pnpm|yarn|git)\s/i,
  /\b(?:create|make|edit|modify|delete|remove|rename|move|write(?:\s+to)?)\s+(?:\S+\s+){0,3}?(?:files?|folders?|director(?:y|ies))\b/i,
  /\b(?:delete|remove|wipe)\s+(?:all\s+|everything\s+)?(?:in|from)\s+\S/i,
  /\b(?:browse|navigate|go)\s+to\b.*\b(?:and|then)\b/i,
];

// How-to and explanatory questions are answered in chat, never handed off.
const QUESTION = /^\s*(?:how|what|why|where|when|which|who|is|are|does|do|should|explain)\b/i;

export { projectSlug };

// "create a cafe menu", "can you build me a todo app": an imperative build verb,
// then an object whose head noun is something you can build as a project.
const BUILD_VERB = String.raw`(?:create|build|make|design|code|generate|scaffold|set\s+up|start)`;
// Desire phrasing counts too: "I want a website for my cafe", "give me a quiz".
const DESIRE = String.raw`(?:i\s+want|i\s+need|i(?:'|\u2019)d\s+like|i\s+would\s+like|i(?:'|\u2019)m\s+looking\s+for|give\s+me|get\s+me)`;
const BUILD_REQUEST = new RegExp(
  String.raw`^\s*(?:(?:please|can\s+you|could\s+you|would\s+you)\s+)*(?:${BUILD_VERB}\s+(?:(?:me|us)\s+)?|${DESIRE}\s+)(.+?)\s*[.!]*\s*$`,
  "i",
);
// A head that is only one of these says little about the project, so words after the cut help name it.
const GENERIC_NOUNS = new Set(["app", "website", "site", "page", "game", "project", "tool", "bot", "script"]);
const NAME_STOPWORDS = new Set(["lets", "let", "can", "will", "would", "should", "is", "are", "be", "that", "which", "who", "where", "with", "using", "it", "its", "i", "you", "they", "helps", "help", "allows", "allow", "so", "like", "by", "from", "all", "also", "very"]);
const BUILDABLE =
  /(?:web\s*sites?|sites?|web\s*pages?|pages?|apps?|applications?|games?|menus?|portfolios?|blogs?|dashboards?|forms?|calculators?|tools?|extensions?|scripts?|bots?|chatbots?|apis?|servers?|projects?|prototypes?|templates?|resumes?|cvs?|invitations?|quizz?es|quiz|to-?\s?do\s+lists?|shops?|stores?|galleries|gallery)$/i;
// Where the object's head noun phrase ends ("a landing page | for my bakery").
const HEAD_END = /\s+(?:about|for|that|which|who|where|with|to|in|on|using|from|by|so|like|called|named|of|and)(?=\s)/i;
const NAME_FILLER = new Set(["a", "an", "the", "my", "our", "your", "some", "new", "me", "us", "of", "to", "in", "on", "and"]);
const NAME_MAX_WORDS = 6;

function words(s: string): string[] {
  return s.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
}

function detectBuild(text: string): string | null {
  const m = BUILD_REQUEST.exec(text);
  if (!m) return null;
  const object = m[1];
  const splitAt = HEAD_END.exec(object);
  const head = splitAt ? object.slice(0, splitAt.index) : object;
  const tail = splitAt ? object.slice(splitAt.index).trim() : "";
  const headWords = words(head).filter((w) => !NAME_FILLER.has(w.toLowerCase()));
  if (headWords.length === 0 || !BUILDABLE.test(headWords.join(" "))) return null;
  // "a game called Snake" is named Snake; "a landing page for my bakery" becomes "landing page bakery".
  const named = /^(?:called|named)\s+(.+)$/i.exec(tail);
  const afterCut = words(tail.replace(/^\S+\s*/, ""));
  const generic = headWords.length === 1 && GENERIC_NOUNS.has(headWords[0].toLowerCase());
  const tailWords = named
    ? words(named[1])
    : /^(?:for|about)\b/i.test(tail)
      ? afterCut
      : generic
        ? afterCut.filter((w) => !NAME_FILLER.has(w.toLowerCase()) && !NAME_STOPWORDS.has(w.toLowerCase())).slice(0, 3)
        : [];
  const nameWords = named && tailWords.length
    ? tailWords
    : [...headWords, ...tailWords.filter((w) => !NAME_FILLER.has(w.toLowerCase()))];
  return nameWords.slice(0, NAME_MAX_WORDS).join(" ").toLowerCase();
}

export function routeInput(text: string, opts: { allowCommands: boolean; allowBuild?: boolean }): Route {
  const timer = parseTimer(text);
  if (timer) return { kind: "timer", ...timer };
  const clip = detectClipboardAction(text);
  if (clip) return { kind: "clipboard", action: clip };
  if (!QUESTION.test(text) && AGENT_ONLY.some((re) => re.test(text))) return { kind: "agent" };
  if (opts.allowBuild !== false && !QUESTION.test(text)) {
    const name = detectBuild(text);
    if (name) return { kind: "build", name };
  }
  if (opts.allowCommands && parseCommand(text).type !== null) return { kind: "command" };
  return { kind: "chat" };
}

export type Personality = "playful" | "neutral" | "detailed";

export const PERSONAS: Record<Personality, string> = {
  playful:
    "You are Mini Me, a tiny pixel-art version of the user who lives on their screen. You speak in a speech bubble, so keep every reply to 1–3 short sentences unless they ask for more. Be warm and a little playful.",
  neutral:
    "You are Mini Me, a small assistant that lives on the user's screen and talks in a speech bubble. Keep replies to 1–3 short, plain sentences unless asked for more.",
  detailed:
    "You are Mini Me, a small assistant that lives on the user's screen. Give complete, well-organised answers when the question needs it; keep simple answers short. Avoid long preambles.",
};

/** Tells the model to hand project requests to the build flow instead of writing code in the bubble. */
export const BUILD_RULE =
  "If the user asks you to create, build or make something that would be a project of files (a website, web page, app, game, tool, script, menu page, portfolio and similar), do not write the code or explain how to. Reply with exactly [[BUILD: <a short 2-4 word name for it>]] and nothing else. If they clearly only want text (a poem, an email, a list, an explanation), answer normally.";

const MARKER_LEAD = String.raw`(?:\s|\u0060{1,3}[a-z]*|["'\u201c\u201d\u2018\u2019>*])*`;
const BUILD_MARKER = new RegExp(String.raw`^${MARKER_LEAD}\[\[\s*build\s*:([^\]\n]*)\]\]`, "i");
const BUILD_MARKER_PREFIX = new RegExp(
  String.raw`^${MARKER_LEAD}\[(?:\[\s*(?:b(?:u(?:i(?:l(?:d(?:\s*(?::[^\]\n]*\]?)?)?)?)?)?)?)?)?$`,
  "i",
);

/** A reply that starts with [[BUILD: name]] (fences and quotes tolerated) asks Mini Me to offer a build; markers after real content don't count. */
export function parseBuildMarker(text: string): { name: string } | null {
  const m = BUILD_MARKER.exec(text);
  const name = m?.[1].trim().slice(0, 60).trim();
  return name ? { name } : null;
}

/** True while streamed text could still turn into a build marker, so it is held back from the bubble. */
export function looksLikeBuildMarkerPrefix(partial: string): boolean {
  return partial.trim() === "" || BUILD_MARKER_PREFIX.test(partial) || parseBuildMarker(partial) !== null;
}

/** The text with a leading build marker removed. */
export function stripBuildMarker(text: string): string {
  return text.replace(BUILD_MARKER, "").trim();
}

/** What to do with a finished chat reply: offer a build, or show the text (with any stray marker removed). */
export function resolveChatReply(full: string, buildEnabled: boolean): { kind: "build"; name: string } | { kind: "text"; text: string } {
  if (buildEnabled) {
    const marker = parseBuildMarker(full);
    if (marker) return { kind: "build", name: marker.name };
  }
  return { kind: "text", text: stripBuildMarker(full) };
}

/** Marven's base prompt plus the Mini Me persona (and the build rule unless `allowBuild` is false), with the user's custom instructions first and last (as the main chat does). */
export function buildCompanionPrompt(base: string, extra: string, personality: Personality = "playful", opts: { allowBuild?: boolean } = {}): string {
  const persona = PERSONAS[personality] ?? PERSONAS.playful;
  const withPersona = `${base}\n\n${persona}${opts.allowBuild === false ? "" : `\n\n${BUILD_RULE}`}`;
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
