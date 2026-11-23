// electron/companionGuards.js
//
// Small pure validators for Mini Me, kept free of Electron imports so they can
// be unit-tested.

const MAX_MESSAGE_CHARS = 20000;
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

module.exports = { sanitizeThreadMessages, isReservedHotkey, MAX_MESSAGE_CHARS, MAX_MESSAGES };
