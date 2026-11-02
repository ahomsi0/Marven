// Bookmarks as a plain list, one per URL.

const { isWebUrl, cleanText, isId } = require('./validate');

const TITLE_LIMIT = 300;

function toggleBookmark(list, url, title, now, makeId) {
  if (!isWebUrl(url)) return { list, bookmarked: false };
  if (list.some((b) => b.url === url)) return { list: list.filter((b) => b.url !== url), bookmarked: false };
  const bookmark = { id: makeId(), url, title: cleanText(title, TITLE_LIMIT), addedAt: now };
  return { list: [...list, bookmark], bookmarked: true };
}

function removeBookmark(list, id) {
  return list.some((b) => b.id === id) ? list.filter((b) => b.id !== id) : list;
}

function searchBookmarks(list, query) {
  const q = query.trim().toLowerCase();
  return list
    .filter((b) => !q || b.url.toLowerCase().includes(q) || b.title.toLowerCase().includes(q))
    .sort((a, b) => b.addedAt - a.addedAt);
}

function sanitizeBookmarks(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const b of raw) {
    if (!b || !isId(b.id) || !isWebUrl(b.url) || !Number.isFinite(b.addedAt) || seen.has(b.url)) continue;
    seen.add(b.url);
    out.push({ id: b.id, url: b.url, title: cleanText(b.title, TITLE_LIMIT), addedAt: b.addedAt });
  }
  return out;
}

module.exports = { toggleBookmark, removeBookmark, searchBookmarks, sanitizeBookmarks };
