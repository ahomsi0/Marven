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

/**
 * Parses a user message and detects whether it maps to a known command.
 * Returns the command type and payload, or null type if no command matched.
 *
 * @param message The raw user message
 * @param customShortcuts Optional user-defined shortcut overrides (checked first)
 */
export function parseCommand(
  message: string,
  customShortcuts: CustomShortcut[] = []
): ParsedCommand {
  // Strip trailing punctuation that Whisper commonly adds ("Open Spotify." / "Open Spotify, please.")
  const lower = message.toLowerCase().trim().replace(/[.,!?]+$/, "");

  // ─── 1. Custom shortcuts (checked first) ─────────────────────────────────
  for (const shortcut of customShortcuts) {
    if (lower === shortcut.trigger.toLowerCase().trim()) {
      return { type: "open-website", payload: shortcut.url };
    }
  }

  // ─── 2. Volume commands ──────────────────────────────────────────────────
  if (/^(?:volume|turn it) up$/i.test(lower)) {
    return { type: "volume-up", payload: "" };
  }
  if (/^(?:volume|turn it) down$/i.test(lower)) {
    return { type: "volume-down", payload: "" };
  }
  if (/^(?:mute|silence)(?: (?:the )?(?:volume|audio|sound))?$/i.test(lower)) {
    return { type: "volume-mute", payload: "" };
  }
  if (/^unmute(?: (?:the )?(?:volume|audio|sound))?$/i.test(lower)) {
    return { type: "volume-unmute", payload: "" };
  }
  const volumeSetMatch = lower.match(/^set (?:the )?volume to (\d+)(?:%)?$/i);
  if (volumeSetMatch) {
    return { type: "set-volume", payload: volumeSetMatch[1] };
  }

  // ─── 2b. Media commands ───────────────────────────────────────────────────
  if (/^(?:play|pause|play\/pause|toggle (?:music|playback))$/i.test(lower)) {
    return { type: "media-play-pause", payload: "" };
  }
  if (/^(?:next|next (?:song|track))$/i.test(lower)) {
    return { type: "media-next", payload: "" };
  }
  if (/^(?:previous|prev|(?:previous|prev) (?:song|track))$/i.test(lower)) {
    return { type: "media-previous", payload: "" };
  }
  if (/^what(?:'s| is) (?:playing|this song|this track)$/i.test(lower)) {
    return { type: "media-what-playing", payload: "" };
  }

  // ─── 2c. Battery ─────────────────────────────────────────────────────────
  if (/^(?:battery|battery (?:level|status|life)|how(?:'s| is) (?:my )?battery)$/i.test(lower)) {
    return { type: "get-battery", payload: "" };
  }

  // ─── 3. Time / Date ───────────────────────────────────────────────────────
  if (
    /\b(?:what(?:'s| is)(?: the)? time|what time is it|current time|tell me the time|time (right )?now)\b/i.test(lower)
  ) {
    return { type: "get-time", payload: "" };
  }
  if (
    /\b(?:what(?:'s| is)(?: the| today'?s?)? date|what day is(?: it| today)|today'?s? date|current date|what(?:'s| is) today)\b/i.test(lower)
  ) {
    return { type: "get-date", payload: "" };
  }

  // ─── 3. Screenshot ────────────────────────────────────────────────────────
  if (/^take a screenshot$/i.test(lower)) {
    return { type: "take-screenshot", payload: "" };
  }

  // ─── 4. Lock screen ──────────────────────────────────────────────────────
  if (/^lock (?:the )?screen$/i.test(lower) || /^lock screen$/i.test(lower)) {
    return { type: "lock-screen", payload: "" };
  }

  // ─── 5. Open Downloads ───────────────────────────────────────────────────
  if (/^open (?:my )?downloads$/i.test(lower)) {
    return { type: "open-downloads", payload: "" };
  }

  // ─── 6. Empty Trash ──────────────────────────────────────────────────────
  if (/^empty (?:the )?trash$/i.test(lower)) {
    return { type: "empty-trash", payload: "" };
  }

  // ─── 7. Google search ────────────────────────────────────────────────────
  const searchPatterns = [
    /^search\s+(?:google\s+)?for\s+(.+)$/i,
    /^google\s+search\s+(.+)$/i,
    /^search\s+(.+)\s+on\s+google$/i,
  ];

  for (const pattern of searchPatterns) {
    const match = lower.match(pattern);
    if (match) {
      return { type: "google-search", payload: match[1].trim() };
    }
  }

  // ─── 8. Open website / app ───────────────────────────────────────────────
  // Strip common filler prefix words that voice/Whisper may add
  const stripped = lower
    .replace(/^(?:hey\s+marven[,.]?\s*)?(?:can\s+you|please|could\s+you|would\s+you)\s+/i, "")
    .replace(/[,.]?\s*(?:for\s+me|please|now|right\s+now)$/i, "")
    .trim();

  // Match: open / open up / launch / start / run / go to / visit / navigate to
  const openMatch = stripped.match(
    /^(?:open(?:\s+up)?|launch|start|run|go\s+to|visit|navigate\s+to)\s+(.+)$/i,
  );

  if (openMatch) {
    const target = openMatch[1].trim().replace(/[.,!?]+$/, "");

    // App map first (more specific)
    if (APP_MAP[target]) {
      return { type: "open-app", payload: APP_MAP[target] };
    }
    // Website map
    if (WEBSITE_MAP[target]) {
      return { type: "open-website", payload: WEBSITE_MAP[target] };
    }
    // Custom shortcuts
    for (const shortcut of customShortcuts) {
      if (target === shortcut.trigger.toLowerCase().trim()) {
        return { type: "open-website", payload: shortcut.url };
      }
    }
    // Bare URL
    if (/^https?:\/\//.test(target) || /^[\w-]+\.[\w]{2,}/.test(target)) {
      const url = /^https?:\/\//.test(target) ? target : `https://${target}`;
      return { type: "open-website", payload: url };
    }
  }

  // ─── Fuzzy app / site scan (fallback) ────────────────────────────────────
  // Catches "marven, open spotify" or any sentence containing a known app name
  // preceded by an open-intent verb — avoids false positives on casual mentions
  const verbPresent = /\b(?:open(?:\s+up)?|launch|start|run)\b/.test(lower);
  if (verbPresent) {
    for (const [key, appName] of Object.entries(APP_MAP)) {
      const re = new RegExp(`\\b${key.replace(/\s+/g, "\\s+")}\\b`, "i");
      if (re.test(lower)) return { type: "open-app", payload: appName };
    }
    for (const [key, url] of Object.entries(WEBSITE_MAP)) {
      const re = new RegExp(`\\b${key}\\b`, "i");
      if (re.test(lower)) return { type: "open-website", payload: url };
    }
  }

  return { type: null, payload: "" };
}
