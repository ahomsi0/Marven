// Address-bar suggestions: matching bookmarks (newest first), then matching
// history ranked by visits weighted by recency.

const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const LIMIT = 5;

function matches(q, url, title) {
  return url.toLowerCase().includes(q) || title.toLowerCase().includes(q);
}

function rankSuggestions({ query, bookmarks, history, now, limit = LIMIT }) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  const seen = new Set();

  const marks = bookmarks
    .filter((b) => matches(q, b.url, b.title))
    .sort((a, b) => b.addedAt - a.addedAt || a.url.length - b.url.length);
  for (const b of marks) {
    if (out.length >= limit) return out;
    seen.add(b.url);
    out.push({ kind: 'bookmark', url: b.url, title: b.title });
  }

  const visited = Object.entries(history)
    .filter(([url, h]) => !seen.has(url) && matches(q, url, h.title))
    .map(([url, h]) => ({ url, title: h.title, score: h.visits * Math.pow(0.5, Math.max(0, now - h.lastVisit) / HALF_LIFE_MS) }))
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length);
  for (const h of visited) {
    if (out.length >= limit) break;
    out.push({ kind: 'history', url: h.url, title: h.title });
  }
  return out;
}

module.exports = { HALF_LIFE_MS, rankSuggestions };
