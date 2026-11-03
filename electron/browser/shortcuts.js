// Browser keyboard shortcuts, from an Electron `before-input-event` input.
// Cmd on macOS, Ctrl elsewhere. On non-Latin layouts (Arabic, Cyrillic…)
// `key` is the typed character, so the physical key in `code` is used instead.

const CODE_KEYS = {
  KeyT: 't', KeyW: 'w', KeyL: 'l', KeyR: 'r', KeyF: 'f', BracketLeft: '[', BracketRight: ']',
  Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',
};

function keyOf(input) {
  if (/^[\x20-\x7e]$/.test(input.key)) return input.key.toLowerCase();
  return CODE_KEYS[input.code] ?? '';
}

function shortcutAction(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown' || typeof input.key !== 'string') return null;
  const mod = platform === 'darwin' ? input.meta : input.control;
  if (!mod || input.alt) return null;
  const key = keyOf(input);
  if (input.shift) return key === 't' ? { action: 'reopen-tab' } : null;
  switch (key) {
    // Holding the keys down must not open or close a tab per repeat.
    case 't': return input.isAutoRepeat === true ? null : { action: 'new-tab' };
    case 'w': return input.isAutoRepeat === true ? null : { action: 'close-tab' };
    case 'l': return { action: 'focus-address' };
    case 'f': return { action: 'find' };
    case 'r': return { action: 'reload' };
    case '[': return { action: 'back' };
    case ']': return { action: 'forward' };
    default: break;
  }
  if (/^[1-9]$/.test(key)) return { action: 'select-tab', index: key === '9' ? -1 : Number(key) - 1 };
  return null;
}

module.exports = { shortcutAction };
