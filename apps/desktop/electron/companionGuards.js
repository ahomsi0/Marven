// electron/companionGuards.js
//
// Small pure validators for Mini Me, kept free of Electron imports so they can
// be unit-tested.

const MAX_MESSAGE_CHARS = 20000;
const MAX_MESSAGES = 20;

// Marven's own Listen shortcut; Mini Me's hotkey must not shadow it.
const RESERVED_HOTKEYS = new Set([
  'commandorcontrol+shift+m',
  'cmdorctrl+shift+m',
  'command+shift+m',
]);

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

function isReservedHotkey(accelerator) {
  return typeof accelerator === 'string' && RESERVED_HOTKEYS.has(accelerator.trim().toLowerCase());
}

module.exports = { sanitizeThreadMessages, isReservedHotkey, MAX_MESSAGE_CHARS, MAX_MESSAGES };
