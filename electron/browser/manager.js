// The in-app browser. Owns the tab list and one Tab per entry; the session
// (session.js), what's kept on disk (library.js) and where the active page's
// view sits (viewHost.js) live in their own modules. The renderer gets a
// snapshot after every change and sends commands back (see ipc.js).

const crypto = require('node:crypto');
const model = require('./tabsModel');
const { createLibrary } = require('./library');
const { createBrowserSession } = require('./session');
const { createViewHost } = require('./viewHost');
const { fetchFavicon } = require('./favicons');
const { shortcutAction } = require('./shortcuts');
const { createRateLimiter } = require('./rateLimit');
const { Tab } = require('./tab');
const { searchEngine, DEFAULT_ENGINE_ID } = require('./searchEngines');
const { hostOf, isWebUrl, staysOnOrigin } = require('./validate');
const { EXTRACT_SCRIPT, cleanExtract } = require('./pageText');

// Snapshots are coalesced: structural changes go out within a frame, while
// bumps of the blocked-request counter (which can fire hundreds of times
// during a page load) wait a little longer. One push covers both.
const SNAPSHOT_DELAY_MS = 16;
const BLOCKED_SNAPSHOT_DELAY_MS = 250;
const MAX_TABS = 100;
const POPUPS_PER_SECOND = 2;
// Page extraction runs in its own isolated world (not the page's main world,
// and not 999, which Electron uses for preloads) and gives up after this long.
const EXTRACT_WORLD_ID = 1001;
const EXTRACT_TIMEOUT_MS = 5000;
const newId = () => crypto.randomUUID();

/**
 * @param {{ dir: string, getWindow: () => Electron.BrowserWindow | null }} options
 */
function createBrowserManager({ dir, getWindow }) {
  let ses = null;
  let library = null;
  let downloads = null;
  let loadBlocker = null;
  let state = model.emptyState();
  const tabs = new Map(); // tab id → Tab
  const byWebContents = new Map(); // webContents id → Tab
  let panelFocused = false;
  let snapshotTimer = null;
  let snapshotDue = 0;
  // The user's search engine (Settings → Browser); new tabs open on its home page.
  let engine = searchEngine(DEFAULT_ENGINE_ID);
  const popupLimiter = createRateLimiter({ max: POPUPS_PER_SECOND, windowMs: 1000 });
  const host = createViewHost({
    getWindow,
    getPage: () => {
      const tab = activeTab();
      return { showable: !!tab && !tab.error, views: [...tabs.values()].map((t) => t.view) };
    },
  });

  function init() {
    if (ses) return;
    library = createLibrary({ dir, newId });
    state = model.fromSaved(library.savedTabs(), newId);
    ({ ses, downloads, loadBlocker } = createBrowserSession({
      dir,
      isDisabledFor: library.blockingDisabled,
      onBlocked: (webContentsId) => {
        const tab = byWebContents.get(webContentsId);
        if (!tab) return;
        tab.blocked += 1;
        scheduleSnapshot(BLOCKED_SNAPSHOT_DELAY_MS);
      },
      onDownloadsChange: scheduleSnapshot,
    }));
    // The filter lists are downloaded on the first show(), not here, so a call
    // from Settings (clearing browsing data) never starts that download.
  }

  // ── State and snapshots ────────────────────────────────────────────────

  function commit(next) {
    if (next === state) return;
    state = next;
    library.saveTabs(model.toSaved(state));
    scheduleSnapshot();
  }

  function snapshot() {
    return {
      tabs: state.tabs.map((entry) => {
        const tab = tabs.get(entry.id);
        const url = tab?.url ?? entry.url;
        return {
          id: entry.id,
          url,
          title: tab?.title || entry.title,
          favicon: tab?.favicon ?? null,
          loading: tab?.loading ?? false,
          canGoBack: tab?.canGoBack() ?? false,
          canGoForward: tab?.canGoForward() ?? false,
          blocked: tab?.blocked ?? 0,
          blockingEnabled: !library.blockingDisabled(hostOf(url)),
          error: tab?.error ?? null,
        };
      }),
      activeId: state.activeId,
      downloads: downloads.list(),
      searchEngine: { id: engine.id, name: engine.name, searchUrl: engine.searchUrl },
    };
  }

  function pushSnapshot() {
    snapshotTimer = null;
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('browser-snapshot', snapshot());
  }

  // A pending push that is due sooner already covers this change; a later one
  // is brought forward.
  function scheduleSnapshot(delay = SNAPSHOT_DELAY_MS) {
    const due = Date.now() + delay;
    if (snapshotTimer) {
      if (snapshotDue <= due) return;
      clearTimeout(snapshotTimer);
    }
    snapshotDue = due;
    snapshotTimer = setTimeout(pushSnapshot, delay);
  }

  // ── Tabs ───────────────────────────────────────────────────────────────

  function tabFor(entry) {
    let tab = tabs.get(entry.id);
    if (tab) return tab;
    tab = new Tab({
      id: entry.id,
      url: entry.url,
      title: entry.title,
      session: ses,
      hooks: {
        onUpdate,
        onVisit: library.recordVisit,
        onTitle: library.updateTitle,
        onFavicon: (t, iconUrl) => {
          const navigation = t.navigation;
          if (t.faviconFetch === navigation) return; // one fetch per page at a time
          t.faviconFetch = navigation;
          void fetchFavicon(ses, iconUrl).then((data) => {
            if (t.faviconFetch === navigation) t.faviconFetch = null;
            if (t.navigation !== navigation) return; // the tab moved to another page meanwhile
            t.favicon = data;
            scheduleSnapshot();
          });
        },
        onOpenTab: openPopup,
        onShortcut: handleShortcut,
        onView: (t) => byWebContents.set(t.webContentsId, t),
      },
    });
    tabs.set(entry.id, tab);
    return tab;
  }

  function onUpdate(tab) {
    const entry = state.tabs.find((t) => t.id === tab.id);
    if (entry && (entry.url !== tab.url || entry.title !== tab.title)) {
      commit(model.updateTab(state, tab.id, { url: tab.url, title: tab.title }));
    } else {
      scheduleSnapshot();
    }
    if (tab.id === state.activeId) host.syncVisibility();
  }

  function activeTab() {
    const entry = state.tabs.find((t) => t.id === state.activeId);
    return entry ? tabFor(entry) : null;
  }

  // Attaches the active tab's view (creating it on first show) in place of
  // whatever was on screen.
  function showActive() {
    if (!host.hasWindow()) return;
    const tab = activeTab();
    host.showActive(host.isShown() && tab ? tab.ensureView() : null);
  }

  function forget(tab) {
    if (host.isAttached(tab.view)) host.detach();
    if (tab.webContentsId != null) byWebContents.delete(tab.webContentsId);
    tab.destroyView();
    tabs.delete(tab.id);
  }

  function newTab(url, { afterId = null, activate = true } = {}) {
    if (state.tabs.length >= MAX_TABS) return null;
    const entry = { id: newId(), url: isWebUrl(url) ? url : engine.homeUrl, title: '' };
    commit(model.addTab(state, entry, { afterId, activate }));
    showActive();
    return entry.id;
  }

  // window.open from a page: limited per opener so a page can't flood the
  // tab strip, and dropped once the tab cap is reached.
  function openPopup(opener, url, { background = false } = {}) {
    if (state.tabs.length >= MAX_TABS) return;
    const { ok, warn } = popupLimiter.take(opener.id);
    if (!ok) {
      if (warn) console.warn(`[browser] a page opened too many windows, ignoring new ones (limit ${POPUPS_PER_SECOND} per second)`);
      return;
    }
    newTab(url, { afterId: opener.id, activate: !background });
  }

  function closeTab(id) {
    const tab = tabs.get(id);
    commit(model.closeTab(state, id));
    if (tab) forget(tab);
    if (state.tabs.length === 0) newTab(engine.homeUrl);
    else showActive();
  }

  function activateTab(id) {
    commit(model.activateTab(state, id));
    showActive();
  }

  function moveTab(id, toIndex) {
    commit(model.moveTab(state, id, toIndex));
  }

  function reopenClosedTab() {
    if (state.tabs.length >= MAX_TABS) return;
    commit(model.reopenClosed(state, newId));
    showActive();
  }

  function existingTab(id) {
    const entry = state.tabs.find((t) => t.id === id);
    return entry ? tabFor(entry) : null;
  }

  function navigate(id, url) {
    return existingTab(id)?.load(url) ?? false;
  }

  function command(id, name) {
    existingTab(id)?.command(name);
  }

  // The readable text and selection of a tab (the active one by default), for
  // "Ask Marven about this page". Null for blank, unloaded or failed tabs.
  async function extractPage(id) {
    const tab = id ? existingTab(id) : activeTab();
    const wc = tab && !tab.error ? tab.webContents : null;
    if (!wc || !isWebUrl(wc.getURL())) return null;
    let timer = null;
    try {
      const run = wc.executeJavaScriptInIsolatedWorld(EXTRACT_WORLD_ID, [{ code: EXTRACT_SCRIPT }], false);
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), EXTRACT_TIMEOUT_MS);
      });
      return cleanExtract(await Promise.race([run, timeout]), isWebUrl);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Panel placement ────────────────────────────────────────────────────

  function show(b) {
    loadBlocker();
    host.show(b);
    if (state.tabs.length === 0) newTab(engine.homeUrl);
    else showActive();
    scheduleSnapshot();
  }

  // ── Shortcuts ──────────────────────────────────────────────────────────

  function focusAddress() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.focus();
    win.webContents.send('browser-focus-address');
  }

  function handleShortcut(input) {
    const shortcut = shortcutAction(input);
    if (!shortcut) return false;
    const active = state.activeId;
    switch (shortcut.action) {
      case 'new-tab': newTab(engine.homeUrl); break;
      // Deferred: closing destroys the view whose input event is being handled.
      case 'close-tab': if (active) setImmediate(() => closeTab(active)); break;
      case 'reopen-tab': reopenClosedTab(); break;
      case 'focus-address': focusAddress(); break;
      case 'reload': if (active) command(active, 'reload'); break;
      case 'back': if (active) command(active, 'back'); break;
      case 'forward': if (active) command(active, 'forward'); break;
      case 'select-tab': {
        const target = shortcut.index === -1 ? state.tabs[state.tabs.length - 1] : state.tabs[shortcut.index];
        if (target) activateTab(target.id);
        break;
      }
      default: return false;
    }
    return true;
  }

  // ── Blocking and data ──────────────────────────────────────────────────

  function setBlocking(siteHost, enabled) {
    library.setBlocking(siteHost, enabled);
    const tab = activeTab();
    if (tab && hostOf(tab.url) === siteHost) tab.command('reload');
    scheduleSnapshot();
  }

  async function clearBrowsingData() {
    library.clearData();
    commit(model.clearClosed(state));
    downloads.clearFinished();
    // Open tabs keep their current favicon (it would otherwise show the globe
    // until each tab navigates); only their back/forward history goes.
    for (const tab of tabs.values()) tab.webContents?.navigationHistory.clear();
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    scheduleSnapshot();
    return true;
  }

  // ── Window lifecycle ───────────────────────────────────────────────────

  function attachWindow(win) {
    // A renderer reload (HMR, crash recovery) must not leave a page floating
    // over a UI that no longer has a browser panel.
    const hideForReload = () => {
      panelFocused = false;
      if (ses) host.hide();
    };
    win.webContents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      if (staysOnOrigin(details.url, win.webContents.getURL())) hideForReload();
    });
    win.webContents.on('render-process-gone', hideForReload);
    // Browser shortcuts while focus is in the panel's toolbar (the page's own
    // view handles them while the page has focus).
    win.webContents.on('before-input-event', (event, input) => {
      if (ses && panelFocused && handleShortcut(input)) event.preventDefault();
    });
    win.on('closed', () => {
      host.windowClosed();
      for (const tab of tabs.values()) {
        if (tab.webContentsId != null) byWebContents.delete(tab.webContentsId);
        tab.destroyView();
      }
    });
  }

  function flush() {
    library?.flush();
  }

  const ready = (fn) => (...args) => {
    init();
    return fn(...args);
  };

  return {
    attachWindow,
    flush,
    show: ready(show),
    setBounds: ready(host.setBounds),
    hide: ready(host.hide),
    freeze: ready(host.freeze),
    unfreeze: ready(host.unfreeze),
    setPanelFocused: (focused) => { panelFocused = focused; },
    setSearchEngine: (id) => {
      engine = searchEngine(id);
      if (ses) scheduleSnapshot();
    },
    snapshot: ready(snapshot),
    newTab: ready((url) => newTab(url)),
    closeTab: ready(closeTab),
    activateTab: ready(activateTab),
    moveTab: ready(moveTab),
    reopenClosedTab: ready(reopenClosedTab),
    navigate: ready(navigate),
    command: ready(command),
    extractPage: ready(extractPage),
    toggleBookmark: ready((url, title) => library.toggleBookmark(url, title)),
    removeBookmark: ready((id) => library.removeBookmark(id)),
    listBookmarks: ready((query) => library.listBookmarks(query)),
    isBookmarked: ready((url) => library.isBookmarked(url)),
    suggest: ready((query) => library.suggest(query)),
    setBlocking: ready(setBlocking),
    cancelDownload: ready((id) => downloads.cancel(id)),
    showDownload: ready((id) => downloads.show(id)),
    clearBrowsingData: ready(clearBrowsingData),
  };
}

module.exports = { createBrowserManager };
