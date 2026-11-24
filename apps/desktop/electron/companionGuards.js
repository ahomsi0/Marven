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

/** Names macOS would launch rather than show (apps, scripts, installers, links). */
const BUNDLE_NAME = /\.(app|bundle|command|tool|workflow|terminal|pkg|mpkg|webloc)$/i;

/**
 * The real path of `target` when it is a project folder Mini Me could have made:
 * a real directory (not a symlink, not a bundle-like name) whose parent is
 * exactly Mini Me's projects folder (the `miniMeProjectsDir` setting, `~`
 * expanded). Anything else is null. Both sides go through `realpath`.
 *
 * @param {unknown} target
 * @param {unknown} projectsDir
 * @param {{ home: string, realpath: (p: string) => string, lstat: (p: string) => { isDirectory(): boolean, isSymbolicLink(): boolean } }} deps
 */
function projectFolderInside(target, projectsDir, { home, realpath, lstat }) {
  if (typeof target !== 'string' || !target || target.length > MAX_PATH_CHARS || target.includes('\0')) return null;
  if (!path.isAbsolute(target)) return null;
  const setting = typeof projectsDir === 'string' && projectsDir.trim() ? projectsDir.trim() : DEFAULT_PROJECTS_DIR;
  const dir = expandHome(setting, home);
  if (!path.isAbsolute(dir)) return null;
  const resolved = path.resolve(target);
  if (BUNDLE_NAME.test(path.basename(resolved))) return null;
  try {
    const stat = lstat(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
    const realDir = realpath(path.resolve(dir));
    const realTarget = realpath(resolved);
    if (BUNDLE_NAME.test(path.basename(realTarget))) return null;
    return path.dirname(realTarget) === realDir ? realTarget : null;
  } catch {
    return null;
  }
}

/**
 * The extras an "Open in Marven" hand-off may carry, checked: `workspaceRoot`
 * only when it is a project folder Mini Me made (see projectFolderInside), and
 * `autostart` only as a real `true`, for the Agent, on such a folder. Returns
 * the fields to pass on, or null to refuse the hand-off (autostart asked for
 * but not allowed: better to open nothing than to start the Agent elsewhere).
 * A folder that fails the check on its own is dropped and the thread still opens.
 *
 * @param {unknown} options
 * @param {'agent' | 'chat'} mode the already-sanitized mode
 * @param {unknown} projectsDir
 * @param {Parameters<typeof projectFolderInside>[2]} deps
 * @returns {{ workspaceRoot?: string, autostart?: true } | null}
 */
function sanitizeOpenOptions(options, mode, projectsDir, deps) {
  if (!options || typeof options !== 'object') return {};
  const out = {};
  if (options.workspaceRoot !== undefined) {
    const root = projectFolderInside(options.workspaceRoot, projectsDir, deps);
    if (root) out.workspaceRoot = root;
  }
  if (options.autostart === true) {
    if (mode !== 'agent' || !out.workspaceRoot) return null;
    out.autostart = true;
  }
  return out;
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

const SETTINGS_PAGES = ['keys-ai', 'general', 'mini-me'];

/** The Settings page Mini Me asked for: one of the few it has a reason to open, else the AI keys page. */
function sanitizeSettingsPage(page) {
  return SETTINGS_PAGES.includes(page) ? page : 'keys-ai';
}

module.exports = {
  sanitizeSettingsPage,
  sanitizeThreadMessages,
  sanitizeOpenMode,
  sanitizeOpenOptions,
  isReservedHotkey,
  projectFolderInside,
  isLoopbackHttpUrl,
  DEFAULT_PROJECTS_DIR,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
};
