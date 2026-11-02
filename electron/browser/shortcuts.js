// Browser keyboard shortcuts, from an Electron `before-input-event` input.
// Cmd on macOS, Ctrl elsewhere.

function shortcutAction(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown' || typeof input.key !== 'string') return null;
  const mod = platform === 'darwin' ? input.meta : input.control;
  if (!mod || input.alt) return null;
  const key = input.key.toLowerCase();
  if (input.shift) return key === 't' ? { action: 'reopen-tab' } : null;
  switch (key) {
    case 't': return { action: 'new-tab' };
    case 'w': return { action: 'close-tab' };
    case 'l': return { action: 'focus-address' };
    case 'r': return { action: 'reload' };
    case '[': return { action: 'back' };
    case ']': return { action: 'forward' };
    default: break;
  }
  if (/^[1-9]$/.test(key)) return { action: 'select-tab', index: key === '9' ? -1 : Number(key) - 1 };
  return null;
}

module.exports = { shortcutAction };
