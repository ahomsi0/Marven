// Scrubs secrets and personal details out of log text before it is shown or
// shared (the "Report a problem" log preview). Pure, no I/O.
//
// Keep in sync with electron/redact.js — the Electron main process can't load
// TypeScript, so it carries a CommonJS copy. lib/redact.test.ts runs the same
// cases through both.

export interface RedactOptions {
  /** The user's home directory; every occurrence is replaced with "~". */
  homeDir?: string | null;
}

const KEY = "[REDACTED_KEY]";
const TOKEN = "[REDACTED_TOKEN]";
const EMAIL = "[REDACTED_EMAIL]";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactText(input: string, options: RedactOptions = {}): string {
  if (!input) return "";
  let out = input;

  // Home directory first, so the user name inside paths never reaches the
  // generic token rule below.
  const home = options.homeDir?.replace(/[\\/]+$/, "");
  if (home && home.length > 1) {
    out = out.replace(new RegExp(escapeRegExp(home), "g"), "~");
  }
  // Any other home-looking path (another account, or the renderer, which
  // doesn't know the home directory).
  out = out
    .replace(/\/Users\/[^/\s"'`:]+/g, "~")
    .replace(/\/home\/[^/\s"'`:]+/g, "~")
    .replace(/[A-Za-z]:\\Users\\[^\\\s"'`:]+/g, "~");

  // Authorization headers.
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${TOKEN}`);

  // Provider API keys (most specific prefixes first).
  out = out
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}/g, KEY)
    .replace(/\bsk-or-[A-Za-z0-9_-]{8,}/g, KEY)
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, KEY)
    .replace(/\bgsk_[A-Za-z0-9]{16,}/g, KEY)
    .replace(/\bnvapi-[A-Za-z0-9_-]{16,}/g, KEY);

  // Email addresses.
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, EMAIL);

  // Long hex / base64 / base64url runs: anything 32+ characters that mixes
  // letters and digits (identifiers without digits are left alone).
  out = out.replace(/[A-Za-z0-9+_-]{32,}={0,2}/g, (run) =>
    /[0-9]/.test(run) && /[A-Za-z]/.test(run) ? TOKEN : run,
  );

  return out;
}

export function redactLines(lines: readonly string[], options: RedactOptions = {}): string[] {
  return lines.map((line) => redactText(line, options));
}

// Credentials the agent must never type into a page or put in a URL it
// opens. Unlike redactText, emails and long ids are fine here: filling in an
// email or following a link with a UUID is ordinary browsing.
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bsk-ant-[A-Za-z0-9_-]{8,}/,
  /\bsk-or-[A-Za-z0-9_-]{8,}/,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bgsk_[A-Za-z0-9]{16,}/,
  /\bnvapi-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
];

/** Known values shorter than this are too likely to appear by chance. */
const MIN_KNOWN_SECRET = 12;

export function containsSecret(text: string, knownSecrets: readonly string[] = []): boolean {
  if (!text) return false;
  if (SECRET_PATTERNS.some((re) => re.test(text))) return true;
  return knownSecrets.some((secret) => secret.length >= MIN_KNOWN_SECRET && text.includes(secret));
}
