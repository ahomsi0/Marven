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
 * MAX_MESSAGES well-formed `{ role, content }` messages (content truncated,
 * plus a short `id` when there is one), or
 * null when the input isn't an array or nothing valid remains.
 */
function sanitizeThreadMessages(messages) {
  if (!Array.isArray(messages)) return null;
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (typeof m.content !== 'string') continue;
    const msg = { role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) };
    if (typeof m.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(m.id)) msg.id = m.id;
    out.push(msg);
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

const MAX_PROJECT_FOLDERS = 50;

/**
 * The project folders in Mini Me's projects folder (the `miniMeProjectsDir`
 * setting, `~` expanded), newest first, at most 50: real, visible directories
 * only (no symlinks, dot-folders or bundle-like names). [] when the folder is
 * missing or the setting isn't an absolute path.
 *
 * @param {unknown} projectsDir
 * @param {{ home: string, realpath: (p: string) => string, lstat: (p: string) => { isDirectory(): boolean, isSymbolicLink(): boolean }, readdir: (p: string) => string[], stat: (p: string) => { mtimeMs: number } }} deps
 */
function listProjectFolders(projectsDir, deps) {
  const setting = typeof projectsDir === 'string' && projectsDir.trim() ? projectsDir.trim() : DEFAULT_PROJECTS_DIR;
  const dir = expandHome(setting, deps.home);
  if (!path.isAbsolute(dir)) return [];
  let realDir;
  let names;
  try {
    realDir = deps.realpath(path.resolve(dir));
    names = deps.readdir(realDir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (typeof name !== 'string' || !name || name.startsWith('.') || BUNDLE_NAME.test(name)) continue;
    const root = path.join(realDir, name);
    try {
      const st = deps.lstat(root);
      if (st.isSymbolicLink() || !st.isDirectory()) continue;
      out.push({ root, name, mtimeMs: deps.stat(root).mtimeMs });
    } catch {
      /* gone meanwhile: skip */
    }
  }
  return out
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_PROJECT_FOLDERS)
    .map(({ root, name }) => ({ root, name }));
}

/** True for a folder with nothing in it but a .DS_Store; false when unreadable. */
function isFreshFolder(dir, readdir) {
  try {
    return readdir(dir).every((name) => name === '.DS_Store');
  } catch {
    return false;
  }
}

/**
 * The extras an "Open in Marven" hand-off may carry, checked: `workspaceRoot`
 * only when it is a project folder Mini Me made (see projectFolderInside), and
 * `autostart` only as a real `true`, for the Agent, on such a folder that is
 * still empty (a Finder .DS_Store aside) — a fresh project, not someone's
 * files. Returns the fields to pass on, or null to refuse the hand-off
 * (autostart asked for but not allowed: better to open nothing than to start
 * the Agent elsewhere). A folder that fails the check on its own is dropped
 * and the thread still opens.
 *
 * @param {unknown} options
 * @param {'agent' | 'chat'} mode the already-sanitized mode
 * @param {unknown} projectsDir
 * @param {Parameters<typeof projectFolderInside>[2] & { readdir: (p: string) => string[] }} deps
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
    if (mode !== 'agent' || !out.workspaceRoot || !isFreshFolder(out.workspaceRoot, deps.readdir)) return null;
    out.autostart = true;
  }
  return out;
}

const ACK_REASONS = ['busy', 'invalid'];

/**
 * The main window's answer to a hand-off, as passed back to Mini Me:
 * `{ ok: true }`, or `{ ok: false, reason }` with a reason Mini Me knows
 * ("busy": the Agent is running or another hand-off is waiting; "invalid";
 * anything else is "refused").
 */
function sanitizeHandOffAck(ack) {
  if (ack && typeof ack === 'object' && ack.ok === true) return { ok: true };
  const reason = ack && typeof ack === 'object' && ACK_REASONS.includes(ack.reason) ? ack.reason : 'refused';
  return { ok: false, reason };
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
  sanitizeHandOffAck,
  isReservedHotkey,
  projectFolderInside,
  listProjectFolders,
  isLoopbackHttpUrl,
  DEFAULT_PROJECTS_DIR,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
};
