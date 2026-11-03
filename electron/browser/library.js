// What the browser keeps on disk: the open tabs, history, bookmarks and the
// sites with blocking turned off, one JSON file each. Every file is cleaned
// when loaded, and only written back if cleaning changed something.

const path = require('node:path');
const { createJsonStore } = require('./store');
const history = require('./history');
const bookmarks = require('./bookmarks');
const { rankSuggestions } = require('./suggest');
const { isHost } = require('./validate');

/**
 * @param {{ dir: string, newId: () => string }} options
 */
function createLibrary({ dir, newId }) {
  const stores = {
    tabs: createJsonStore(path.join(dir, 'tabs.json'), { tabs: [], activeIndex: 0 }),
    history: createJsonStore(path.join(dir, 'history.json'), {}),
    bookmarks: createJsonStore(path.join(dir, 'bookmarks.json'), []),
    sites: createJsonStore(path.join(dir, 'sites.json'), { blockingDisabled: [] }),
  };
  const now = Date.now();
  const setIfChanged = (store, value) => {
    if (JSON.stringify(value) !== JSON.stringify(store.get())) store.set(value);
  };
  setIfChanged(stores.history, history.prune(history.sanitizeHistory(stores.history.get(), now), now));
  setIfChanged(stores.bookmarks, bookmarks.sanitizeBookmarks(stores.bookmarks.get()));
  const sites = stores.sites.get();
  setIfChanged(stores.sites, { blockingDisabled: Array.isArray(sites?.blockingDisabled) ? sites.blockingDisabled.filter(isHost) : [] });

  // ── Tabs (cleaned by tabsModel.fromSaved) ──────────────────────────────

  const savedTabs = () => stores.tabs.get();
  const saveTabs = (saved) => stores.tabs.set(saved);

  // ── History ────────────────────────────────────────────────────────────

  function recordVisit(url, title) {
    stores.history.set(history.recordVisit(stores.history.get(), url, title, Date.now()));
  }

  function updateTitle(url, title) {
    stores.history.set(history.updateTitle(stores.history.get(), url, title));
  }

  function suggest(query) {
    return rankSuggestions({ query, bookmarks: stores.bookmarks.get(), history: stores.history.get(), now: Date.now() });
  }

  // ── Bookmarks ──────────────────────────────────────────────────────────

  function toggleBookmark(url, title) {
    const { list, bookmarked } = bookmarks.toggleBookmark(stores.bookmarks.get(), url, title, Date.now(), newId);
    stores.bookmarks.set(list);
    return bookmarked;
  }

  function removeBookmark(id) {
    stores.bookmarks.set(bookmarks.removeBookmark(stores.bookmarks.get(), id));
  }

  function listBookmarks(query) {
    return bookmarks.searchBookmarks(stores.bookmarks.get(), query);
  }

  function isBookmarked(url) {
    return stores.bookmarks.get().some((b) => b.url === url);
  }

  // ── Per-site blocking ──────────────────────────────────────────────────

  function blockingDisabled(host) {
    return !!host && stores.sites.get().blockingDisabled.includes(host);
  }

  function setBlocking(host, enabled) {
    const list = stores.sites.get().blockingDisabled.filter((h) => h !== host);
    if (!enabled) list.push(host);
    stores.sites.set({ blockingDisabled: list });
  }

  // ── Data ───────────────────────────────────────────────────────────────

  // Clearing browsing data takes the history; bookmarks and settings stay.
  function clearData() {
    stores.history.set({});
  }

  function flush() {
    for (const store of Object.values(stores)) store.flush();
  }

  return {
    savedTabs,
    saveTabs,
    recordVisit,
    updateTitle,
    suggest,
    toggleBookmark,
    removeBookmark,
    listBookmarks,
    isBookmarked,
    blockingDisabled,
    setBlocking,
    clearData,
    flush,
  };
}

module.exports = { createLibrary };
