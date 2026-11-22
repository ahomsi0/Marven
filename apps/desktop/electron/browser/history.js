// Browsing history as a plain map keyed by URL. Kept small: at most
// MAX_ENTRIES URLs, none older than MAX_AGE_MS.

const { isWebUrl, cleanText } = require('./validate');

const MAX_ENTRIES = 5000;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const TITLE_LIMIT = 300;

function recordVisit(history, url, title, now) {
  if (!isWebUrl(url)) return history;
  const prev = history[url];
  const next = {
    ...history,
    [url]: {
      title: cleanText(title, TITLE_LIMIT) || prev?.title || '',
      visits: (prev?.visits ?? 0) + 1,
      lastVisit: now,
    },
  };
  // Pruning is otherwise only done at startup; keep a long-running app bounded.
  return Object.keys(next).length > MAX_ENTRIES * 1.1 ? prune(next, now) : next;
}

function updateTitle(history, url, title) {
  const prev = history[url];
  const clean = cleanText(title, TITLE_LIMIT);
  if (!prev || !clean || prev.title === clean) return history;
  return { ...history, [url]: { ...prev, title: clean } };
}

// The URL with any #fragment removed, so in-page anchor jumps count as the
// same page.
function withoutFragment(url) {
  if (typeof url !== 'string') return '';
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}

function prune(history, now) {
  const kept = Object.entries(history)
    .filter(([, entry]) => entry.lastVisit >= now - MAX_AGE_MS)
    .sort((a, b) => b[1].lastVisit - a[1].lastVisit)
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(kept);
}

// `now` caps lastVisit, so an entry saved under a wrong clock can't rank forever.
function sanitizeHistory(raw, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [url, entry] of Object.entries(raw)) {
    if (!isWebUrl(url) || !entry || typeof entry !== 'object') continue;
    if (!Number.isInteger(entry.visits) || entry.visits < 1 || !Number.isFinite(entry.lastVisit)) continue;
    out[url] = { title: cleanText(entry.title, TITLE_LIMIT), visits: entry.visits, lastVisit: Math.min(entry.lastVisit, now) };
  }
  return out;
}

module.exports = { MAX_ENTRIES, MAX_AGE_MS, recordVisit, updateTitle, prune, sanitizeHistory, withoutFragment };
