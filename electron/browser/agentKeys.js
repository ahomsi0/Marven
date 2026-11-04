// The input events Marven's agent may send to a page: the keys it may press
// (by the names its browser_press tool uses) and a left click. Coordinates are
// CSS pixels; the manager scales them by the page's zoom. Nothing here imports
// Electron.

// Tool key name → Electron accelerator key code. The names are browser_press's
// key enum in lib/agent/browserTools.ts (its test checks).
const KEYS = new Map([
  ['Enter', 'Enter'], ['Tab', 'Tab'], ['Escape', 'Escape'], ['Backspace', 'Backspace'],
  ['ArrowUp', 'Up'], ['ArrowDown', 'Down'], ['ArrowLeft', 'Left'], ['ArrowRight', 'Right'],
  ['PageUp', 'PageUp'], ['PageDown', 'PageDown'], ['Home', 'Home'], ['End', 'End'], ['Space', 'Space'],
]);

// Keys that also type a character, which pages listen for (Enter submits a form).
const CHARS = new Map([['Enter', '\r'], ['Space', ' ']]);

function isAgentKey(key) {
  return typeof key === 'string' && KEYS.has(key);
}

function keyEvents(key) {
  const keyCode = KEYS.get(key);
  const char = CHARS.get(key);
  return [
    { type: 'keyDown', keyCode },
    ...(char ? [{ type: 'char', keyCode: char }] : []),
    { type: 'keyUp', keyCode },
  ];
}

function clickEvents(x, y) {
  return [
    { type: 'mouseMove', x, y },
    { type: 'mouseDown', x, y, button: 'left', clickCount: 1 },
    { type: 'mouseUp', x, y, button: 'left', clickCount: 1 },
  ];
}

const AGENT_KEYS = [...KEYS.keys()];

module.exports = { AGENT_KEYS, isAgentKey, keyEvents, clickEvents };
