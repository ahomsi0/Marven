import type { CustomShortcut, ParsedCommand } from "@/types";

// Known websites: map common names to URLs
const WEBSITE_MAP: Record<string, string> = {
  youtube: "https://www.youtube.com",
  github: "https://www.github.com",
  google: "https://www.google.com",
  twitter: "https://www.twitter.com",
  x: "https://www.x.com",
  reddit: "https://www.reddit.com",
  linkedin: "https://www.linkedin.com",
  netflix: "https://www.netflix.com",
  spotify: "https://open.spotify.com",
  gmail: "https://mail.google.com",
  notion: "https://www.notion.so",
  vercel: "https://www.vercel.com",
  figma: "https://www.figma.com",
  claude: "https://claude.ai",
  chatgpt: "https://chat.openai.com",
};

// Known apps: map common names to macOS app names
const APP_MAP: Record<string, string> = {
  chrome: "Google Chrome",
  "google chrome": "Google Chrome",
  safari: "Safari",
  firefox: "Firefox",
  vscode: "Visual Studio Code",
  "vs code": "Visual Studio Code",
  code: "Visual Studio Code",
  terminal: "Terminal",
  iterm: "iTerm",
  iterm2: "iTerm",
  slack: "Slack",
  discord: "Discord",
  zoom: "zoom.us",
  finder: "Finder",
  notes: "Notes",
  mail: "Mail",
  messages: "Messages",
  xcode: "Xcode",
  figma: "Figma",
  spotify: "Spotify",
  "system preferences": "System Preferences",
  "system settings": "System Settings",
};

const NO_COMMAND: ParsedCommand = { type: null, payload: "" };

// Extensions that are also TLDs but in chat almost always name a file
// ("open package.json", "open notes.md"), never a website.
const FILE_EXTENSIONS = new Set([
  "c", "cc", "cfg", "conf", "cpp", "cs", "css", "csv", "env", "go", "h", "html",
  "ini", "java", "js", "json", "jsx", "kt", "lock", "log", "md", "mdx", "mjs",
  "php", "pl", "py", "rb", "rs", "scss", "sh", "sql", "swift", "toml", "ts",
  "tsx", "txt", "xml", "yaml", "yml", "zip",
]);

/** A bare domain or http(s) URL with no spaces, e.g. "github.com" or "https://x.com/a". */
function asWebsite(target: string): string | null {
  const match = target.match(/^(https?:\/\/)?([\w-]+(?:\.[\w-]+)+)(?::\d+)?(?:[/?#]\S*)?$/);
  if (!match) return null;
  const tld = match[2].split(".").pop() ?? "";
  if (!/^[a-z]{2,}$/.test(tld) || (!match[1] && FILE_EXTENSIONS.has(tld))) return null;
  return match[1] ? target : `https://${target}`;
}

/**
 * Parses a user message and detects whether it IS a known command.
 * Returns the command type and payload, or null type if no command matched.
 *
 * Every pattern matches the whole message (after trimming, lowercasing and
 * stripping trailing punctuation), so a message that merely mentions a command
 * — "how do I open the terminal in VS Code?", "what's the time complexity of
 * quicksort?" — is left for the model. Questions never match, apart from bare
 * status questions such as "what time is it?".
 *
 * @param message The raw text the user typed or spoke (never document contents)
 * @param customShortcuts Optional user-defined shortcut overrides (checked first)
 */
export function parseCommand(
  message: string,
  customShortcuts: CustomShortcut[] = []
): ParsedCommand {
  const trimmed = message.trim().replace(/[\u2018\u2019]/g, "'");
  // Strip trailing punctuation that Whisper commonly adds ("Open Spotify." / "What time is it?")
  const lower = trimmed.toLowerCase().replace(/[.,!?]+$/, "").trim();
  // A "?" inside a URL ("…/search?q=x") is not a question mark; one ending
  // the sentence, even right after a URL ("open https://x.com?"), is.
  const isQuestion = trimmed
    .replace(/https?:\/\/\S*?(?=[.,!?]*(?:\s|$))/gi, "")
    .includes("?");

  // ─── 1. Custom shortcuts (checked first, exact trigger only) ─────────────
  for (const shortcut of customShortcuts) {
    if (lower === shortcut.trigger.toLowerCase().trim()) {
      return { type: "open-website", payload: shortcut.url };
    }
  }

  // ─── 2. Status questions (the only commands that may be phrased with "?") ─
  if (
    /^(?:what(?:'s| is)(?: the)? time(?: (?:right )?now)?|what time is it(?: (?:right )?now)?|(?:the )?current time|tell me the time|time(?: right)? now)$/.test(lower)
  ) {
    return { type: "get-time", payload: "" };
  }
  if (
    /^(?:what(?:'s| is)(?: the| today'?s?)? date(?: today)?|what day is(?: it| today)|today'?s? date|(?:the )?current date|what(?:'s| is) today)$/.test(lower)
  ) {
    return { type: "get-date", payload: "" };
  }
  if (/^what(?:'s| is) (?:playing|this song|this track)$/.test(lower)) {
    return { type: "media-what-playing", payload: "" };
  }
  if (/^(?:battery|battery (?:level|status|life)|how(?:'s| is) (?:my )?battery)$/.test(lower)) {
    return { type: "get-battery", payload: "" };
  }

  // Anything else phrased as a question is a question for the model.
  if (isQuestion) return NO_COMMAND;

  // ─── 3. Volume commands ──────────────────────────────────────────────────
  if (/^(?:volume|turn it) up$/.test(lower)) {
    return { type: "volume-up", payload: "" };
  }
  if (/^(?:volume|turn it) down$/.test(lower)) {
    return { type: "volume-down", payload: "" };
  }
  if (/^(?:mute|silence)(?: (?:the )?(?:volume|audio|sound))?$/.test(lower)) {
    return { type: "volume-mute", payload: "" };
  }
  if (/^unmute(?: (?:the )?(?:volume|audio|sound))?$/.test(lower)) {
    return { type: "volume-unmute", payload: "" };
  }
  const volumeSetMatch = lower.match(/^set (?:the )?volume to (\d+)(?:%)?$/);
  if (volumeSetMatch) {
    return { type: "set-volume", payload: volumeSetMatch[1] };
  }

  // ─── 4. Media commands ───────────────────────────────────────────────────
  if (/^(?:play|pause|play\/pause|toggle (?:music|playback))$/.test(lower)) {
    return { type: "media-play-pause", payload: "" };
  }
  if (/^(?:next|next (?:song|track))$/.test(lower)) {
    return { type: "media-next", payload: "" };
  }
  if (/^(?:previous|prev|(?:previous|prev) (?:song|track))$/.test(lower)) {
    return { type: "media-previous", payload: "" };
  }

  // ─── 5. Screenshot / lock screen / Downloads ─────────────────────────────
  if (/^take a screenshot$/.test(lower)) {
    return { type: "take-screenshot", payload: "" };
  }
  if (/^lock (?:the )?screen$/.test(lower)) {
    return { type: "lock-screen", payload: "" };
  }
  if (/^open (?:my )?downloads$/.test(lower)) {
    return { type: "open-downloads", payload: "" };
  }

  // ─── 6. Google search ────────────────────────────────────────────────────
  // `.` does not cross newlines and `$` is end-of-input, so a single line only.
  const searchPatterns = [
    /^search\s+(?:google\s+)?for\s+(.+)$/,
    /^google\s+search\s+(.+)$/,
    /^search\s+(.+)\s+on\s+google$/,
  ];
  for (const pattern of searchPatterns) {
    const match = lower.match(pattern);
    if (match) {
      return { type: "google-search", payload: match[1].trim() };
    }
  }

  // ─── 7. Open website / app ───────────────────────────────────────────────
  // Only "<verb> <known name | domain>" as the whole message. Allow the
  // wake-word / "please" prefix and "for me" / "please" / "now" suffix that
  // voice input adds — but not "can you …" style questions.
  const stripped = lower
    .replace(/^hey\s+marven[,.]?\s*/, "")
    .replace(/^please[,]?\s+/, "")
    .replace(/[,.]?\s*(?:for\s+me|please|now|right\s+now)$/, "")
    .trim();

  const openMatch = stripped.match(
    /^(?:open(?:\s+up)?|launch|start|go\s+to|visit|navigate\s+to)\s+(\S.*)$/,
  );
  if (!openMatch) return NO_COMMAND;

  const target = openMatch[1].trim().replace(/[.,!?]+$/, "").replace(/\s+/g, " ");

  // App map first (more specific)
  if (Object.hasOwn(APP_MAP, target)) {
    return { type: "open-app", payload: APP_MAP[target] };
  }
  if (Object.hasOwn(WEBSITE_MAP, target)) {
    return { type: "open-website", payload: WEBSITE_MAP[target] };
  }
  for (const shortcut of customShortcuts) {
    if (target === shortcut.trigger.toLowerCase().trim()) {
      return { type: "open-website", payload: shortcut.url };
    }
  }
  const website = asWebsite(target);
  if (website) {
    return { type: "open-website", payload: website };
  }

  return NO_COMMAND;
}
