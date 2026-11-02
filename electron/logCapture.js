// electron/logCapture.js
//
// Keeps the last few hundred log lines in memory (for "Report a problem") and
// appends them to <dir>/main.log, rotating to main.log.1 at ~1 MB. Lines are
// redacted before they are stored anywhere. Free of Electron imports so it can
// be unit-tested; main.js wires it to console.* and renderer console-message.

const nodeFs = require('fs');
const path = require('path');
const util = require('util');
const { redactText } = require('./redact');

const DEFAULT_MAX_LINES = 300;
const DEFAULT_MAX_BYTES = 1024 * 1024;
// A single runaway line (a dumped object, a huge stack) shouldn't evict the
// whole buffer or bloat the log file.
const MAX_LINE_CHARS = 4000;

/**
 * @param {object} opts
 * @param {() => string} opts.getDir      Directory for main.log (resolved lazily).
 * @param {number} [opts.maxLines]        Ring buffer size.
 * @param {number} [opts.maxBytes]        Rotate main.log past this size.
 * @param {string} [opts.homeDir]         Replaced with "~" by redaction.
 * @param {typeof nodeFs} [opts.fs]
 * @param {() => Date} [opts.now]
 */
function createLogCapture(opts) {
  const fs = opts.fs || nodeFs;
  const maxLines = opts.maxLines || DEFAULT_MAX_LINES;
  const maxBytes = opts.maxBytes || DEFAULT_MAX_BYTES;
  const now = opts.now || (() => new Date());
  const homeDir = opts.homeDir || null;

  const lines = [];
  let filePath = null;
  let fileBytes = 0;
  let fileDisabled = false;

  function ensureFile() {
    if (fileDisabled) return null;
    if (filePath) return filePath;
    try {
      const dir = opts.getDir();
      fs.mkdirSync(dir, { recursive: true });
      filePath = path.join(dir, 'main.log');
      try {
        fileBytes = fs.statSync(filePath).size;
      } catch {
        fileBytes = 0;
      }
      return filePath;
    } catch {
      // No writable log directory: keep the in-memory buffer only.
      fileDisabled = true;
      return null;
    }
  }

  function writeToFile(line) {
    const file = ensureFile();
    if (!file) return;
    const chunk = `${line}\n`;
    const size = Buffer.byteLength(chunk);
    try {
      if (fileBytes > 0 && fileBytes + size > maxBytes) {
        fs.renameSync(file, `${file}.1`);
        fileBytes = 0;
      }
      fs.appendFileSync(file, chunk, 'utf8');
      fileBytes += size;
    } catch {
      // Never let logging break the app (and never log about it — that would recurse).
    }
  }

  /**
   * Record one log entry.
   * @param {'log'|'info'|'warn'|'error'|'debug'} level
   * @param {string} source  e.g. "main" or "renderer"
   * @param {unknown[]} args console-style arguments
   */
  function push(level, source, args) {
    let message;
    try {
      message = util.format(...args);
    } catch {
      message = args.map(String).join(' ');
    }
    if (message.length > MAX_LINE_CHARS) message = `${message.slice(0, MAX_LINE_CHARS)}… (truncated)`;
    // One line per entry; indent continuation lines so stacks stay readable.
    message = message.replace(/\r?\n/g, '\n    ');
    const line = redactText(`${now().toISOString()} [${source}] ${level.toUpperCase()} ${message}`, { homeDir });
    lines.push(line);
    if (lines.length > maxLines) lines.splice(0, lines.length - maxLines);
    writeToFile(line);
  }

  /** The buffered lines, oldest first (already redacted). */
  function recent() {
    return lines.slice();
  }

  return { push, recent };
}

/**
 * Wrap console.log/info/warn/error/debug so every call is also captured. The
 * original methods still run first.
 */
function patchConsole(capture, target = console) {
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = target[level];
    if (typeof original !== 'function') continue;
    target[level] = (...args) => {
      original.apply(target, args);
      try {
        capture.push(level, 'main', args);
      } catch {
        // ignore
      }
    };
  }
}

/**
 * Normalise a webContents 'console-message' event across Electron versions:
 * newer versions pass one event object ({ level: 'warning', message, ... }),
 * older ones pass (event, levelNumber, message, line, sourceId).
 * Returns null for anything below warning level.
 */
function rendererConsoleEntry(event, legacyLevel, legacyMessage, legacyLine, legacySourceId) {
  const rawLevel = event && event.level !== undefined ? event.level : legacyLevel;
  const message = event && typeof event.message === 'string' ? event.message : legacyMessage;
  const line = event && event.lineNumber !== undefined ? event.lineNumber : legacyLine;
  const sourceId = event && typeof event.sourceId === 'string' ? event.sourceId : legacySourceId;
  let level = null;
  if (rawLevel === 'warning' || rawLevel === 2) level = 'warn';
  else if (rawLevel === 'error' || rawLevel === 3) level = 'error';
  if (!level || typeof message !== 'string') return null;
  const where = sourceId ? ` (${sourceId}${line ? `:${line}` : ''})` : '';
  return { level, text: `${message}${where}` };
}

module.exports = { createLogCapture, patchConsole, rendererConsoleEntry };
