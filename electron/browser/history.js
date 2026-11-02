// Browsing history as a plain map keyed by URL. Kept small: at most
// MAX_ENTRIES URLs, none older than MAX_AGE_MS.

const { isWebUrl, cleanText } = require('./validate');

const MAX_ENTRIES = 5000;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const TITLE_LIMIT = 300;

function recordVisit(history, url, title, now) {
  if (!isWebUrl(url)) return history;
  const prev = history[url];
  return {
    ...history,
    [url]: {
      title: cleanText(title, TITLE_LIMIT) || prev?.title || '',
      visits: (prev?.visits ?? 0) + 1,
      lastVisit: now,
    },
  };
}

function updateTitle(history, url, title) {
  const prev = history[url];
  if (!prev || !title || prev.title === title) return history;
  return { ...history, [url]: { ...prev, title: cleanText(title, TITLE_LIMIT) } };
}

function prune(history, now) {
  const kept = Object.entries(history)
    .filter(([, entry]) => entry.lastVisit >= now - MAX_AGE_MS)
    .sort((a, b) => b[1].lastVisit - a[1].lastVisit)
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(kept);
}

function sanitizeHistory(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [url, entry] of Object.entries(raw)) {
    if (!isWebUrl(url) || !entry || typeof entry !== 'object') continue;
    if (!Number.isFinite(entry.visits) || !Number.isFinite(entry.lastVisit)) continue;
    out[url] = { title: cleanText(entry.title, TITLE_LIMIT), visits: entry.visits, lastVisit: entry.lastVisit };
  }
  return out;
}

module.exports = { MAX_ENTRIES, MAX_AGE_MS, recordVisit, updateTitle, prune, sanitizeHistory };
