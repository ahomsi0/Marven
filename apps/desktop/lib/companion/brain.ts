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
  /** A change to the project Mini Me built last (see `project` in routeInput). */
  | { kind: "edit" }
  /** Right after a run: start the previous request as a new project instead. */
  | { kind: "new-instead" }
  /** Right after a run: answer the previous request in chat instead. */
  | { kind: "chat-instead" }
  /** Stop the run (and the queue). */
  | { kind: "stop" }
  /** Show a project in the preview panel: the one the text names, else the current one. */
  | { kind: "preview"; query: string }
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
const NAME_FILLER = new Set(["a", "an", "the", "my", "our", "your", "some", "new", "another", "me", "us", "of", "to", "in", "on", "and"]);
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

// "change the background to red", "can you add a contact section": a change
// verb first, then something a built site has. "it" counts only while the
// project is what Mini Me was last working on ("make it red" right after it).
const EDIT_REQUEST = new RegExp(
  String.raw`^\s*(?:(?:please|can\s+you|could\s+you|would\s+you|now|ok(?:ay)?|also|and|then)[\s,]+)*(?:change|edit|update|modify|fix|tweak|adjust|replace|swap|recolou?r|restyle|rename|remove|delete|add|put|insert|move|turn|use|increase|decrease|enlarge|shrink|cent(?:er|re)|align|make)\b(.*)$`,
  "i",
);
const EDIT_TARGET =
  /\b(?:background|colou?rs?|fonts?|text|titles?|headings?|headers?|footers?|nav(?:igation|bar)?|menus?|buttons?|images?|photos?|pictures?|logos?|icons?|sections?|pages?|site|website|layout|styles?|theme|links?|bio|about|contact|hero|banner|cards?|paragraphs?|css|html|dark\s+mode|light\s+mode|animations?|spacing|margins?|padding|borders?)\b/i;
const EDIT_PRONOUN = /\b(?:it|its|it's)\b/i;

function detectEdit(text: string, recent: boolean): boolean {
  const m = EDIT_REQUEST.exec(text);
  if (!m) return false;
  return EDIT_TARGET.test(m[1]) || (recent && EDIT_PRONOUN.test(m[1]));
}

// Said right after Mini Me started (or finished) a run from your previous
// message. A new request with details ("make another site for my cafe") is
// not a correction: the noun must end the sentence.
const NEW_INSTEAD =
  /^\s*(?:no[,.!]?\s+)?(?:(?:please|actually)[\s,]+)?(?:(?:make|start|create|build|do)\s+(?:(?:it|that)\s+(?:as\s+)?)?(?:a\s+)?)?(?:a\s+)?(?:brand[\s-]+)?(?:new|separate|another|different)\s+(?:one|project|site|website|page|app)(?:\s+instead)?[\s.!]*$/i;
const CHAT_INSTEAD = /^\s*(?:no[,.!]?\s+)?(?:just\s+(?:tell\s+me|answer|explain)|don(?:'|\u2019)?t\s+(?:build|make|change|do)\s+(?:it|that|anything))\b/i;
const STOP = /^\s*(?:stop|cancel|never\s*mind|nevermind|hold\s+on)\b[\s.!]*$/i;

/** A short name for a project made from `text`: its build name, else its first words. */
export function projectNameFor(text: string): string {
  const built = detectBuild(text);
  if (built) return built;
  const name = words(text).filter((w) => !NAME_FILLER.has(w.toLowerCase())).slice(0, 4).join(" ").toLowerCase();
  return name || "project";
}

// "show me the preview of the jane doe website", "preview it", "let me see the
// cafe site": a see/show verb with the word "preview", or "show me"/"let me
// see"/"view" plus a site word. Plain "open …" is left to the command route
// ("open spotify").
const LEAD_FILLER = String.raw`(?:(?:please|can\s+you|could\s+you|would\s+you|now|ok(?:ay)?|and|then|hey)[\s,]+)*`;
const SEE_VERB = String.raw`(?:show|open|display|view|see|bring\s+up|pull\s+up|let\s+me\s+see|i\s+want\s+to\s+see|i(?:'|\u2019)?d\s+like\s+to\s+see|can\s+i\s+see)`;
const PREVIEW_ASK = new RegExp(String.raw`^\s*${LEAD_FILLER}(?:${SEE_VERB}\b.*\bpreview\b|preview\b)`, "i");
const SHOW_SITE = new RegExp(
  String.raw`^\s*${LEAD_FILLER}(?:show(?:\s+me)?|let\s+me\s+see|view|i\s+want\s+to\s+see|can\s+i\s+see)\s+(?:\S+\s+){0,5}?(?:site|website|page|project|portfolio)s?\b`,
  "i",
);

export function routeInput(
  text: string,
  opts: {
    allowCommands: boolean;
    allowBuild?: boolean;
    /** Mini Me has a project it built; `recent` when it was the last thing worked on. */
    project?: { recent: boolean };
    /** Mini Me is working on, or just finished, a run started from the previous message. */
    afterRun?: boolean;
  },
): Route {
  if (opts.afterRun) {
    if (STOP.test(text)) return { kind: "stop" };
    if (NEW_INSTEAD.test(text)) return { kind: "new-instead" };
    if (CHAT_INSTEAD.test(text)) return { kind: "chat-instead" };
  }
  const timer = parseTimer(text);
  if (timer) return { kind: "timer", ...timer };
  const clip = detectClipboardAction(text);
  if (clip) return { kind: "clipboard", action: clip };
  if (opts.allowBuild !== false && !QUESTION.test(text) && (PREVIEW_ASK.test(text) || SHOW_SITE.test(text))) {
    return { kind: "preview", query: text };
  }
  // A change to the project goes to it, never to a new folder; a new build request still wins.
  if (opts.project && !QUESTION.test(text) && detectEdit(text, opts.project.recent)) {
    if (opts.allowBuild === false || !detectBuild(text)) return { kind: "edit" };
  }
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
  "If the user asks you to create, build or make something that would be a project of files (a website, web page, app, game, tool, script, menu page, portfolio and similar), do not write the code or explain how to. Reply with exactly [[BUILD: <a short 2-4 word name for it>]] and nothing else. If they clearly only want text (a poem, an email, a list, an explanation), answer normally. If they ask to see, open or preview a project you made, reply with exactly [[PREVIEW: <its name, or nothing for the one you made last>]] and nothing else. You can only build, change or show projects through these markers: never say you opened, built or changed something yourself.";

const MARKER_LEAD = String.raw`(?:\s|\u0060{1,3}[a-z]*|["'\u201c\u201d\u2018\u2019>*])*`;
const BUILD_MARKER = new RegExp(String.raw`^${MARKER_LEAD}\[\[\s*build\s*:([^\]\n]*)\]\]`, "i");
const EDIT_MARKER = new RegExp(String.raw`^${MARKER_LEAD}\[\[\s*edit\s*\]\]`, "i");
const PREVIEW_MARKER = new RegExp(String.raw`^${MARKER_LEAD}\[\[\s*preview\s*(?::([^\]\n]*))?\]\]`, "i");
const PREVIEW_MARKER_PREFIX = new RegExp(
  String.raw`^${MARKER_LEAD}\[(?:\[\s*(?:p(?:r(?:e(?:v(?:i(?:e(?:w\s*(?::[^\]\n]*\]?|\]?))?)?)?)?)?)?)?)?$`,
  "i",
);
const EDIT_MARKER_PREFIX = new RegExp(String.raw`^${MARKER_LEAD}\[(?:\[\s*(?:e(?:d(?:i(?:t\s*\]?)?)?)?)?)?$`, "i");
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

/** True while streamed text could still turn into a build, edit or preview marker, so it is held back from the bubble. */
export function looksLikeBuildMarkerPrefix(partial: string): boolean {
  return (
    partial.trim() === "" ||
    BUILD_MARKER_PREFIX.test(partial) ||
    parseBuildMarker(partial) !== null ||
    EDIT_MARKER_PREFIX.test(partial) ||
    EDIT_MARKER.test(partial) ||
    PREVIEW_MARKER_PREFIX.test(partial) ||
    PREVIEW_MARKER.test(partial)
  );
}

/** The text with a leading build, edit or preview marker removed. */
export function stripBuildMarker(text: string): string {
  return text.replace(BUILD_MARKER, "").replace(EDIT_MARKER, "").replace(PREVIEW_MARKER, "").trim();
}

/** What to do with a finished chat reply: a build, an edit of the current project, a preview, or the text (with any stray marker removed). */
export function resolveChatReply(
  full: string,
  buildEnabled: boolean,
  editEnabled = false,
): { kind: "build"; name: string } | { kind: "edit" } | { kind: "preview"; query: string } | { kind: "text"; text: string } {
  if (editEnabled && EDIT_MARKER.test(full)) return { kind: "edit" };
  if (buildEnabled) {
    const preview = PREVIEW_MARKER.exec(full);
    if (preview) return { kind: "preview", query: (preview[1] ?? "").trim().slice(0, 80) };
    const marker = parseBuildMarker(full);
    if (marker) return { kind: "build", name: marker.name };
  }
  return { kind: "text", text: stripBuildMarker(full) };
}

/** Tells the model that changes to the project Mini Me built go to it, not to a new build. */
export function projectRule(name: string): string {
  const safe = name.replace(/["\u201c\u201d`\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "the project";
  return `You already built the user a project called "${safe}" (a folder of files). If they ask to change, fix, restyle, add to or remove something in it, even without naming it (e.g. "make the background red"), do not start a new project and do not write the code: reply with exactly [[EDIT]] and nothing else.`;
}

/** Marven's base prompt plus the Mini Me persona (and the build rule, and the current project's edit rule, unless `allowBuild` is false), with the user's custom instructions first and last (as the main chat does). */
export function buildCompanionPrompt(
  base: string,
  extra: string,
  personality: Personality = "playful",
  opts: { allowBuild?: boolean; project?: { name: string } } = {},
): string {
  const persona = PERSONAS[personality] ?? PERSONAS.playful;
  const rules = opts.allowBuild === false ? "" : `\n\n${BUILD_RULE}${opts.project ? `\n\n${projectRule(opts.project.name)}` : ""}`;
  const withPersona = `${base}\n\n${persona}${rules}`;
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
