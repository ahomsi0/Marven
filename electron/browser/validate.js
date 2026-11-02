// Argument checks for everything that crosses into the in-app browser from
// the renderer (IPC) or from saved files. Nothing here imports Electron.

const MAX_URL_LENGTH = 8192;
const MAX_BOUND = 100000;

function isWebUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function cleanBounds(b) {
  if (!b || typeof b !== 'object') return null;
  const n = (v) => (Number.isFinite(v) ? Math.min(MAX_BOUND, Math.max(0, Math.round(v))) : NaN);
  const bounds = { x: n(b.x), y: n(b.y), width: n(b.width), height: n(b.height) };
  return Object.values(bounds).some(Number.isNaN) ? null : bounds;
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function isId(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/i.test(value);
}

// A hostname exactly as `hostOf` would return it (lower-case, IPv6 in brackets).
// URL parsing alone lets empty labels like ".." through, so those are refused.
function isHost(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 253
    && !/^\.|\.\./.test(value) && hostOf('http://' + value) === value;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

module.exports = { isWebUrl, cleanBounds, cleanText, isId, isHost, hostOf };
