// Argument checks for everything that crosses into the in-app browser from
// the renderer (IPC) or from saved files. Nothing here imports Electron.

const { isAgentKey } = require('./agentKeys');

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

// Whether a navigation to `url` keeps Marven's window on its current origin
// (a reload or HMR rather than leaving the app). An empty current URL (not
// loaded yet) or anything unparsable counts as same-origin.
function staysOnOrigin(url, current) {
  if (!current) return true;
  try {
    return new URL(url).origin === new URL(current).origin;
  } catch {
    return true;
  }
}

// The permissions pages get: writing (sanitized) text to the clipboard, which
// "Copy" buttons rely on, and fullscreen (a video's button; Chromium only
// allows it from a click, and the view host fits it to the window).
// Everything else, including clipboard reads, is denied.
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

function isAllowedPermission(permission) {
  return ALLOWED_PERMISSIONS.has(permission);
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// A browser action from the agent (via the renderer): a known tool with its
// arguments checked and capped. The model wrote these arguments, so nothing
// is trusted; null means the action is refused.
const AGENT_TOOLS = new Set([
  'browser_open', 'browser_history', 'browser_read', 'browser_screenshot', 'browser_tabs',
  'browser_wait', 'browser_scroll', 'browser_click', 'browser_type', 'browser_press', 'browser_select',
]);
const HISTORY_ACTIONS = new Set(['back', 'forward', 'reload']);
const TAB_ACTIONS = new Set(['list', 'switch', 'close']);
const MAX_WAIT_MS = 15000;
const DEFAULT_WAIT_MS = 10000;

// Models sometimes send numbers as strings.
function toRef(value) {
  const n = typeof value === 'string' && /^\d{1,5}$/.test(value) ? Number(value) : value;
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : null;
}

function cleanAgentAction(raw) {
  if (!raw || typeof raw !== 'object' || !AGENT_TOOLS.has(raw.tool)) return null;
  const a = raw.args && typeof raw.args === 'object' ? raw.args : {};
  const args = {};
  if (a.tab != null) {
    if (!isId(a.tab)) return null;
    args.tab = a.tab;
  }
  const ref = toRef(a.ref);
  switch (raw.tool) {
    case 'browser_open':
      if (!isWebUrl(a.url)) return null;
      args.url = a.url;
      break;
    case 'browser_history':
      if (!HISTORY_ACTIONS.has(a.action)) return null;
      args.action = a.action;
      break;
    case 'browser_read':
      args.offset = Number.isInteger(a.offset) && a.offset > 0 ? Math.min(a.offset, 1000000) : 0;
      args.find = cleanText(a.find, 200);
      break;
    case 'browser_tabs':
      if (!TAB_ACTIONS.has(a.action)) return null;
      args.action = a.action;
      break;
    case 'browser_wait':
      if (a.for !== 'load' && a.for !== 'text') return null;
      args.for = a.for;
      args.text = cleanText(a.text, 200);
      if (a.for === 'text' && !args.text) return null;
      args.timeoutMs = Number.isFinite(a.timeoutMs) ? Math.min(MAX_WAIT_MS, Math.max(0, Math.round(a.timeoutMs))) : DEFAULT_WAIT_MS;
      break;
    case 'browser_scroll':
      if (ref) args.ref = ref;
      else if (a.direction === 'up' || a.direction === 'down') args.direction = a.direction;
      else return null;
      break;
    case 'browser_click':
      if (!ref) return null;
      args.ref = ref;
      break;
    case 'browser_type':
      if (!ref || typeof a.text !== 'string') return null;
      args.ref = ref;
      args.text = a.text.slice(0, 2000);
      args.submit = a.submit === true;
      break;
    case 'browser_press':
      if (!isAgentKey(a.key)) return null;
      args.key = a.key;
      break;
    case 'browser_select':
      if (!ref || typeof a.option !== 'string') return null;
      args.ref = ref;
      args.option = a.option.slice(0, 200);
      break;
    default:
      break; // browser_screenshot: only `tab`
  }
  return {
    tool: raw.tool,
    args,
    approvedHosts: Array.isArray(raw.approvedHosts) ? raw.approvedHosts.filter(isHost).slice(0, 100) : [],
    approvedSubmit: raw.approvedSubmit === true,
    // The element the user's last approval was for (agent.js compares it).
    ...(typeof raw.approvedTarget === 'string' && raw.approvedTarget.length <= 80 ? { approvedTarget: raw.approvedTarget } : {}),
    canSeeImages: raw.canSeeImages === true,
  };
}

module.exports = { isWebUrl, cleanBounds, cleanText, isId, isHost, hostOf, staysOnOrigin, isAllowedPermission, cleanAgentAction };
