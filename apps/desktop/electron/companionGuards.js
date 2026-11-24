// electron/companionGuards.js
//
// Small pure validators for Mini Me, kept free of Electron imports so they can
// be unit-tested.

const path = require('path');

const MAX_MESSAGE_CHARS = 20000;
const MAX_PATH_CHARS = 4096;
const MAX_URL_CHARS = 2048;
const DEFAULT_PROJECTS_DIR = '~/Marven Projects';
const MAX_MESSAGES = 20;

/**
 * Validate a thread handed over from the companion window. Returns the last
 * MAX_MESSAGES well-formed `{ role, content }` messages (content truncated), or
 * null when the input isn't an array or nothing valid remains.
 */
function sanitizeThreadMessages(messages) {
  if (!Array.isArray(messages)) return null;
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (typeof m.content !== 'string') continue;
    out.push({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) });
  }
  const kept = out.slice(-MAX_MESSAGES);
  return kept.length ? kept : null;
}

/** Where an "Open in Marven" hand-off goes. Anything but 'agent' is a plain chat thread. */
function sanitizeOpenMode(mode) {
  return mode === 'agent' ? 'agent' : 'chat';
}

const CMD_TOKENS = new Set(['cmd', 'command', 'cmdorctrl', 'commandorcontrol']);

/** Canonical form of an accelerator: lowercase, modifiers collapsed and sorted, key last. */
function normalizeAccelerator(accelerator, platform) {
  const parts = accelerator.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const mapped = parts.map((p) => {
    if (CMD_TOKENS.has(p)) return 'cmd';
    if (platform !== 'darwin' && (p === 'ctrl' || p === 'control')) return 'cmd';
    return p;
  });
  const key = mapped.pop() || '';
  return [...mapped.sort(), key].join('+');
}

const RESERVED = normalizeAccelerator('CommandOrControl+Shift+M', 'darwin');

/** True for Marven's own Listen shortcut (CommandOrControl+Shift+M), however it is spelled. */
function isReservedHotkey(accelerator, platform = process.platform) {
  return typeof accelerator === 'string' && normalizeAccelerator(accelerator, platform) === RESERVED;
}

/** Expands a leading "~" / "~/" against `home`. */
function expandHome(p, home) {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}

function isStrictlyInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * The real path of `target` when it exists strictly inside Mini Me's projects
 * folder (the `miniMeProjectsDir` setting, `~` expanded), else null. Both sides
 * go through `realpath`, so a symlink can't lead out of the folder.
 *
 * @param {unknown} target
 * @param {unknown} projectsDir
 * @param {{ home: string, realpath: (p: string) => string }} deps
 */
function projectPathInside(target, projectsDir, { home, realpath }) {
  if (typeof target !== 'string' || !target || target.length > MAX_PATH_CHARS || target.includes('\0')) return null;
  if (!path.isAbsolute(target)) return null;
  const setting = typeof projectsDir === 'string' && projectsDir.trim() ? projectsDir.trim() : DEFAULT_PROJECTS_DIR;
  const dir = expandHome(setting, home);
  if (!path.isAbsolute(dir)) return null;
  try {
    const realDir = realpath(path.resolve(dir));
    const realTarget = realpath(path.resolve(target));
    return isStrictlyInside(realTarget, realDir) ? realTarget : null;
  } catch {
    return null;
  }
}

const LOOPBACK_HOST = /^(localhost|[a-z0-9-]+\.localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/** True for an http(s) URL on this machine (a dev server the Agent started), without credentials. */
function isLoopbackHttpUrl(url) {
  if (typeof url !== 'string' || url.length > MAX_URL_CHARS) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    return LOOPBACK_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

module.exports = {
  sanitizeThreadMessages,
  sanitizeOpenMode,
  isReservedHotkey,
  projectPathInside,
  isLoopbackHttpUrl,
  DEFAULT_PROJECTS_DIR,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
};
