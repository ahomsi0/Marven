// The in-app browser. Owns the tab list, one native view per tab (only the
// active one is attached, over the panel's viewport), saved history and
// bookmarks, ad blocking and downloads. The renderer gets a snapshot after
// every change and sends commands back (see ipc.js).

const path = require('node:path');
const crypto = require('node:crypto');
const { session } = require('electron');
const { createJsonStore } = require('./store');
const model = require('./tabsModel');
const history = require('./history');
const bookmarks = require('./bookmarks');
const { rankSuggestions } = require('./suggest');
const { createBlocker } = require('./blocker');
const { createDownloads } = require('./downloads');
const { fetchFavicon } = require('./favicons');
const { shortcutAction } = require('./shortcuts');
const { createRateLimiter } = require('./rateLimit');
const { Tab } = require('./tab');
const { searchEngine, DEFAULT_ENGINE_ID } = require('./searchEngines');
const { hostOf, isWebUrl, isHost, staysOnOrigin, isAllowedPermission } = require('./validate');
const { EXTRACT_SCRIPT, cleanExtract } = require('./pageText');

const PARTITION = 'persist:marven-browser';
// Snapshots are coalesced: structural changes go out within a frame, while
// bumps of the blocked-request counter (which can fire hundreds of times
// during a page load) wait a little longer. One push covers both.
const SNAPSHOT_DELAY_MS = 16;
const BLOCKED_SNAPSHOT_DELAY_MS = 250;
const FREEZE_JPEG_QUALITY = 80;
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
  let stores = null;
  let downloads = null;
  let blocker = null;
  let blockerLoading = false;
  let state = model.emptyState();
  const tabs = new Map(); // tab id → Tab
  const byWebContents = new Map(); // webContents id → Tab
  let bounds = null;
  let shown = false;
  let frozen = false;
  let freezeToken = 0;
  let panelFocused = false;
  let attached = null;
  let snapshotTimer = null;
  let snapshotDue = 0;
  // The user's search engine (Settings → Browser); new tabs open on its home page.
  let engine = searchEngine(DEFAULT_ENGINE_ID);
  const popupLimiter = createRateLimiter({ max: POPUPS_PER_SECOND, windowMs: 1000 });

  function init() {
    if (ses) return;
    stores = {
      tabs: createJsonStore(path.join(dir, 'tabs.json'), { tabs: [], activeIndex: 0 }),
      history: createJsonStore(path.join(dir, 'history.json'), {}),
      bookmarks: createJsonStore(path.join(dir, 'bookmarks.json'), []),
      sites: createJsonStore(path.join(dir, 'sites.json'), { blockingDisabled: [] }),
    };
    const now = Date.now();
    // Only write a file back when cleaning it actually changed something.
    const setIfChanged = (store, value) => {
      if (JSON.stringify(value) !== JSON.stringify(store.get())) store.set(value);
    };
    setIfChanged(stores.history, history.prune(history.sanitizeHistory(stores.history.get(), now), now));
    setIfChanged(stores.bookmarks, bookmarks.sanitizeBookmarks(stores.bookmarks.get()));
    const sites = stores.sites.get();
    setIfChanged(stores.sites, { blockingDisabled: Array.isArray(sites?.blockingDisabled) ? sites.blockingDisabled.filter(isHost) : [] });
    state = model.fromSaved(stores.tabs.get(), newId);

    ses = session.fromPartition(PARTITION);
    // Drop the app-name and Electron tokens so sites see a plain Chrome UA.
    ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|marven)\/\S+/gi, ''));
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(isAllowedPermission(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => isAllowedPermission(permission));
    downloads = createDownloads({ onChange: scheduleSnapshot });
    ses.on('will-download', (event, item, webContents) => downloads.handle(event, item, webContents));
    blocker = createBlocker({
      dir,
      isDisabledFor: blockingDisabled,
      onBlocked: (webContentsId) => {
        const tab = byWebContents.get(webContentsId);
        if (!tab) return;
        tab.blocked += 1;
        scheduleSnapshot(BLOCKED_SNAPSHOT_DELAY_MS);
      },
    });
    blocker.attach(ses);
    // The filter lists are downloaded on the first show(), not here, so a call
    // from Settings (clearing browsing data) never starts that download.
  }

  function blockingDisabled(host) {
    return !!host && stores.sites.get().blockingDisabled.includes(host);
  }

  // ── State and snapshots ────────────────────────────────────────────────

  function commit(next) {
    if (next === state) return;
    state = next;
    stores.tabs.set(model.toSaved(state));
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
          blockingEnabled: !blockingDisabled(hostOf(url)),
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

  // ── Tabs and views ─────────────────────────────────────────────────────

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
        onVisit: (url, title) => stores.history.set(history.recordVisit(stores.history.get(), url, title, Date.now())),
        onTitle: (url, title) => stores.history.set(history.updateTitle(stores.history.get(), url, title)),
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
    if (tab.id === state.activeId) syncVisibility();
  }

  function activeTab() {
    const entry = state.tabs.find((t) => t.id === state.activeId);
    return entry ? tabFor(entry) : null;
  }

  function setMuted(view, muted) {
    const wc = view?.webContents;
    if (wc && !wc.isDestroyed() && wc.isAudioMuted() !== muted) wc.setAudioMuted(muted);
  }

  function detach() {
    if (!attached) return;
    const win = getWindow();
    attached.setVisible(false);
    setMuted(attached, true);
    if (win && !win.isDestroyed() && win.contentView.children.includes(attached)) win.contentView.removeChildView(attached);
    attached = null;
  }

  function showActive() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const tab = activeTab();
    const view = shown && tab ? tab.ensureView() : null;
    if (attached !== view) detach();
    if (view) {
      if (!win.contentView.children.includes(view)) win.contentView.addChildView(view);
      attached = view;
      if (bounds) view.setBounds(bounds);
    }
    syncVisibility();
  }

  // Only the page on screen plays sound: every other tab is muted, so closing
  // the panel, opening an overlay or switching tabs silences it. A frozen page
  // (a toolbar menu is open over it) still counts as on screen.
  function syncVisibility() {
    const tab = activeTab();
    if (attached) attached.setVisible(shown && !frozen && !!tab && !tab.error);
    for (const t of tabs.values()) {
      if (t.view) setMuted(t.view, !(shown && t.view === attached));
    }
  }

  function forget(tab) {
    if (attached && attached === tab.view) detach();
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
    if (!blockerLoading) {
      blockerLoading = true;
      void blocker.load();
    }
    bounds = b;
    shown = true;
    frozen = false;
    freezeToken += 1;
    if (state.tabs.length === 0) newTab(engine.homeUrl);
    else showActive();
    scheduleSnapshot();
  }

  function setBounds(b) {
    bounds = b;
    if (attached) attached.setBounds(b);
  }

  function hide() {
    shown = false;
    syncVisibility();
  }

  // Menus in the toolbar open over the page area, but a native view draws
  // above the DOM. The renderer shows this screenshot in its place meanwhile.
  async function freeze() {
    const tab = activeTab();
    if (!attached || !shown || frozen || !tab || tab.error) return null;
    const token = ++freezeToken;
    const view = attached;
    let image;
    try {
      image = await view.webContents.capturePage();
    } catch {
      // The capture can fail (e.g. the window is occluded). Still hide the
      // page, or the menu would open underneath it; the renderer then shows
      // the menu over an empty viewport.
      if (token === freezeToken) {
        frozen = true;
        syncVisibility();
      }
      return null;
    }
    if (token !== freezeToken) return null;
    frozen = true;
    syncVisibility();
    if (image.isEmpty()) return null;
    // capturePage is in device pixels; the renderer draws it at the view's
    // size, so shrink it to that and send a JPEG rather than a large PNG.
    const { width, height } = view.getBounds();
    const sized = width > 0 && height > 0 ? image.resize({ width, height }) : image;
    return `data:image/jpeg;base64,${sized.toJPEG(FREEZE_JPEG_QUALITY).toString('base64')}`;
  }

  function unfreeze() {
    freezeToken += 1;
    frozen = false;
    syncVisibility();
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

  // ── Bookmarks, history, blocking, data ─────────────────────────────────

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

  function suggest(query) {
    return rankSuggestions({ query, bookmarks: stores.bookmarks.get(), history: stores.history.get(), now: Date.now() });
  }

  function setBlocking(host, enabled) {
    const list = stores.sites.get().blockingDisabled.filter((h) => h !== host);
    if (!enabled) list.push(host);
    stores.sites.set({ blockingDisabled: list });
    const tab = activeTab();
    if (tab && hostOf(tab.url) === host) tab.command('reload');
    scheduleSnapshot();
  }

  async function clearBrowsingData() {
    stores.history.set({});
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
      if (ses) hide();
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
      attached = null;
      shown = false;
      for (const tab of tabs.values()) {
        if (tab.webContentsId != null) byWebContents.delete(tab.webContentsId);
        tab.destroyView();
      }
    });
  }

  function flush() {
    if (!stores) return;
    for (const store of Object.values(stores)) store.flush();
  }

  const ready = (fn) => (...args) => {
    init();
    return fn(...args);
  };

  return {
    attachWindow,
    flush,
    show: ready(show),
    setBounds: ready(setBounds),
    hide: ready(hide),
    freeze: ready(freeze),
    unfreeze: ready(unfreeze),
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
    toggleBookmark: ready(toggleBookmark),
    removeBookmark: ready(removeBookmark),
    listBookmarks: ready(listBookmarks),
    isBookmarked: ready(isBookmarked),
    suggest: ready(suggest),
    setBlocking: ready(setBlocking),
    cancelDownload: ready((id) => downloads.cancel(id)),
    showDownload: ready((id) => downloads.show(id)),
    clearBrowsingData: ready(clearBrowsingData),
  };
}

module.exports = { createBrowserManager };
