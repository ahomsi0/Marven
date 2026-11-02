// electron/redact.js
//
// CommonJS copy of lib/redact.ts for the Electron main process (which can't
// load TypeScript). Scrubs API keys, tokens, emails and the home directory out
// of log lines before they leave the main process. Keep the two in sync —
// lib/redact.test.ts runs the same cases through both.

const KEY = '[REDACTED_KEY]';
const TOKEN = '[REDACTED_TOKEN]';
const EMAIL = '[REDACTED_EMAIL]';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactText(input, options = {}) {
  if (!input) return '';
  let out = String(input);

  const home = options.homeDir ? String(options.homeDir).replace(/[\\/]+$/, '') : '';
  if (home && home.length > 1) {
    out = out.replace(new RegExp(escapeRegExp(home), 'g'), '~');
  }
  out = out
    .replace(/\/Users\/[^/\s"'`:]+/g, '~')
    .replace(/\/home\/[^/\s"'`:]+/g, '~')
    .replace(/[A-Za-z]:\\Users\\[^\\\s"'`:]+/g, '~');

  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${TOKEN}`);

  out = out
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}/g, KEY)
    .replace(/\bsk-or-[A-Za-z0-9_-]{8,}/g, KEY)
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, KEY)
    .replace(/\bgsk_[A-Za-z0-9]{16,}/g, KEY)
    .replace(/\bnvapi-[A-Za-z0-9_-]{16,}/g, KEY);

  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, EMAIL);

  out = out.replace(/[A-Za-z0-9+_-]{32,}={0,2}/g, (run) =>
    /[0-9]/.test(run) && /[A-Za-z]/.test(run) ? TOKEN : run,
  );

  return out;
}

function redactLines(lines, options = {}) {
  return lines.map((line) => redactText(line, options));
}

module.exports = { redactText, redactLines };
