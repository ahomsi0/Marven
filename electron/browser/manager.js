// The in-app browser. Owns the tab list and one Tab per entry; the session
// (session.js), what's kept on disk (library.js) and where the active page's
// view sits (viewHost.js) live in their own modules. The renderer gets a
// snapshot after every change and sends commands back (see ipc.js).

const crypto = require('node:crypto');
const { Menu, clipboard } = require('electron');
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
const { cleanLabels, contextMenuTemplate } = require('./contextMenu');
const { createAgentController } = require('./agent');
const { AGENT_WORLD_ID, script: agentScript } = require('./agentDom');

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
// Screenshots for the agent: at most this wide, as JPEG.
const SCREENSHOT_MAX_WIDTH = 1280;
const SCREENSHOT_JPEG_QUALITY = 70;
// Input the agent sends counts as its own for this long; later input is the user's.
const OWN_INPUT_GRACE_MS = 150;
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
  // Right-click menu labels in the app's language (sent by the renderer).
  let menuLabels = cleanLabels(null);
  // The tab whose page is fullscreen, if any (it's always the active one).
  let fullscreenTab = null;
  const popupLimiter = createRateLimiter({ max: POPUPS_PER_SECOND, windowMs: 1000 });
  const host = createViewHost({
    getWindow,
    getPage: () => {
      const tab = activeTab();
      // A tab with an error or a sign-in prompt shows the UI's page instead.
      return { showable: !!tab && !tab.error && !tab.auth, views: [...tabs.values()].map((t) => t.view) };
    },
  });

  const agent = createAgentController({
    tabs: {
      get: (id) => existingTab(id),
      open: (conversationId, url) => {
        const id = newTab(url);
        const tab = id ? existingTab(id) : null;
        if (!tab) return null;
        tab.agent = { conversationId };
        tab.ensureView();
        scheduleSnapshot();
        return tab;
      },
      owned: (conversationId) => state.tabs
        .map((entry) => tabs.get(entry.id))
        .filter((tab) => tab?.agent?.conversationId === conversationId),
      // The agent's own switching: not a user action, so it doesn't pause the run.
      activate: (id) => { if (state.activeId !== id) activateTab(id); },
      close: (id) => closeTab(id),
    },
    isShown: () => host.isShown(),
    onChange: () => scheduleSnapshot(),
    runInPage: runAgentScript,
    sendInput: sendAgentInput,
    insertText: (tab, text) => {
      const wc = tab.webContents;
      if (!wc) return;
      tab.agentInputUntil = Date.now() + OWN_INPUT_GRACE_MS;
      wc.focus();
      return wc.insertText(text);
    },
    capture: captureForAgent,
  });

  // The agent's in-page script (agentDom.js), in its own isolated world.
  // A page that throws or isn't ready answers null.
  async function runAgentScript(tab, request) {
    tab.ensureView();
    const wc = tab.webContents;
    if (!wc) return null;
    return wc.executeJavaScriptInIsolatedWorld(AGENT_WORLD_ID, [{ code: agentScript(request) }], false).catch(() => null);
  }

  // Real input events at CSS-pixel points, scaled to the page's zoom. Keyboard
  // events go to the focused webContents, so the page takes the focus first.
  function sendAgentInput(tab, events) {
    const wc = tab.webContents;
    if (!wc) return;
    const zoom = wc.getZoomFactor();
    tab.agentInputUntil = Date.now() + OWN_INPUT_GRACE_MS;
    if (events.some((e) => e.type.startsWith('key') || e.type === 'char')) wc.focus();
    for (const event of events) {
      wc.sendInputEvent('x' in event ? { ...event, x: Math.round(event.x * zoom), y: Math.round(event.y * zoom) } : event);
    }
  }

  async function captureForAgent(tab) {
    const wc = tab.webContents;
    if (!wc) return null;
    let image = await wc.capturePage();
    if (image.isEmpty()) return null;
    if (image.getSize().width > SCREENSHOT_MAX_WIDTH) image = image.resize({ width: SCREENSHOT_MAX_WIDTH, quality: 'good' });
    return {
      base64: `data:image/jpeg;base64,${image.toJPEG(SCREENSHOT_JPEG_QUALITY).toString('base64')}`,
      mimeType: 'image/jpeg',
      name: 'screenshot.jpg',
    };
  }

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
      isAgentWebContents: (webContentsId) => !!byWebContents.get(webContentsId)?.agent,
      shouldBlockDownload: (webContents) => {
        const tab = webContents ? byWebContents.get(webContents.id) : null;
        return !!tab && agent.blocksDownloadFrom(tab);
      },
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
          find: tab?.find ?? null,
          auth: tab?.auth ? { host: tab.auth.host, realm: tab.auth.realm, isProxy: tab.auth.isProxy } : null,
          agent: !!tab?.agent,
        };
      }),
      activeId: state.activeId,
      agentActivity: agent.activity(),
      canReopen: state.closed.length > 0,
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
        allowPopup,
        onPopup: openPopupWindow,
        // Deferred: the page's webContents is being destroyed right now.
        onClosedByPage: (t) => setImmediate(() => {
          if (tabs.get(t.id) === t) closeTab(t.id);
        }),
        onContextMenu: showContextMenu,
        onFullscreen,
        onShortcut: handleShortcut,
        onView: (t) => byWebContents.set(t.webContentsId, t),
        onUserInput: (t) => agent.onUserInput(t),
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
    agent.onTabUpdate(tab);
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
    if (fullscreenTab && fullscreenTab !== tab) leaveFullscreen();
    host.showActive(host.isShown() && tab ? tab.ensureView() : null);
  }

  function forget(tab) {
    if (fullscreenTab === tab) leaveFullscreen();
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
  function allowPopup(opener) {
    if (state.tabs.length >= MAX_TABS) return false;
    const { ok, warn } = popupLimiter.take(opener.id);
    if (!ok && warn) console.warn(`[browser] a page opened too many windows, ignoring new ones (limit ${POPUPS_PER_SECOND} per second)`);
    return ok;
  }

  function openPopup(opener, url, { background = false } = {}) {
    if (allowPopup(opener)) newTab(url, { afterId: opener.id, activate: !background });
  }

  // A pop-up window that keeps its opener (allowPopup already ran): a new tab
  // next to the opener, around the webContents Chromium is creating.
  function openPopupWindow(opener, url, options) {
    const entry = { id: newId(), url, title: '' };
    commit(model.addTab(state, entry, { afterId: opener.id, activate: true }));
    const webContents = tabFor(entry).adoptPopup(options);
    showActive();
    return webContents;
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

  function find(id, text, options) {
    existingTab(id)?.findInPage(text, options);
  }

  function stopFind(id) {
    existingTab(id)?.stopFind();
  }

  function answerAuth(id, username, password) {
    existingTab(id)?.answerAuth(username, password);
  }

  // ── Context menu and fullscreen ────────────────────────────────────────

  function showContextMenu(tab, params) {
    const win = getWindow();
    const wc = tab.webContents;
    if (!win || win.isDestroyed() || !wc) return;
    const template = contextMenuTemplate(params, {
      labels: menuLabels,
      canGoBack: tab.canGoBack(),
      canGoForward: tab.canGoForward(),
      engineName: engine.name,
      actions: {
        back: () => tab.command('back'),
        forward: () => tab.command('forward'),
        reload: () => tab.command('reload'),
        openTab: (url) => newTab(url, { afterId: tab.id, activate: false }),
        copyText: (text) => clipboard.writeText(text),
        download: (url) => wc.downloadURL(url),
        copyImageAt: (x, y) => wc.copyImageAt(x, y),
        edit: (name) => wc[name](),
        search: (query) => newTab(engine.searchUrl + encodeURIComponent(query), { afterId: tab.id }),
        find: openFind,
      },
    });
    Menu.buildFromTemplate(template).popup({ window: win });
  }

  // Only the page on screen may go fullscreen; it then covers the window.
  function onFullscreen(tab, on) {
    if (on) {
      if (tab.agent) {
        tab.exitFullscreen();
        return;
      }
      if (tab.id !== state.activeId || !host.isShown()) {
        tab.exitFullscreen();
        return;
      }
      fullscreenTab = tab;
      host.setFullscreen(true);
    } else if (fullscreenTab === tab) {
      fullscreenTab = null;
      host.setFullscreen(false);
    }
  }

  // Puts the window back when the fullscreen page goes off screen.
  function leaveFullscreen() {
    const tab = fullscreenTab;
    if (!tab) return;
    fullscreenTab = null;
    host.setFullscreen(false);
    tab.exitFullscreen();
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

  // Moves keyboard focus to the panel and tells it what to focus.
  function focusPanel(channel) {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.focus();
    win.webContents.send(channel);
  }

  const focusAddress = () => focusPanel('browser-focus-address');
  const openFind = () => focusPanel('browser-open-find');

  function handleShortcut(input) {
    const shortcut = shortcutAction(input);
    if (!shortcut) return false;
    // A browser shortcut is the user taking control.
    agent.takeOver();
    const active = state.activeId;
    switch (shortcut.action) {
      case 'new-tab': newTab(engine.homeUrl); break;
      // Deferred: closing destroys the view whose input event is being handled.
      case 'close-tab': if (active) setImmediate(() => closeTab(active)); break;
      case 'reopen-tab': reopenClosedTab(); break;
      case 'focus-address': focusAddress(); break;
      case 'find': openFind(); break;
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
      agent.reset();
      panelFocused = false;
      if (ses) hide();
    };
    win.webContents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      if (staysOnOrigin(details.url, win.webContents.getURL())) hideForReload();
    });
    win.webContents.on('render-process-gone', hideForReload);
    // The window left fullscreen on its own (green button, Mission Control):
    // the page leaves too, or it would keep covering the whole window.
    win.on('leave-full-screen', () => {
      if (fullscreenTab) leaveFullscreen();
    });
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

  function hide() {
    leaveFullscreen();
    host.hide();
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
    show: ready((b) => {
      show(b);
      agent.onShow();
    }),
    setBounds: ready(host.setBounds),
    hide: ready(() => {
      agent.onHide();
      hide();
    }),
    freeze: ready(host.freeze),
    unfreeze: ready(host.unfreeze),
    setPanelFocused: (focused) => { panelFocused = focused; },
    setMenuLabels: (labels) => { menuLabels = cleanLabels(labels); },
    setSearchEngine: (id) => {
      engine = searchEngine(id);
      if (ses) scheduleSnapshot();
    },
    snapshot: ready(snapshot),
    // The user opening a tab is taking control: the agent's next action would
    // otherwise pull the view back to its own tab.
    newTab: ready((url) => {
      agent.takeOver();
      return newTab(url);
    }),
    closeTab: ready((id) => {
      agent.onUserClose(id);
      closeTab(id);
    }),
    activateTab: ready((id) => {
      agent.onUserActivate(id);
      activateTab(id);
    }),
    moveTab: ready(moveTab),
    reopenClosedTab: ready(() => {
      agent.takeOver();
      reopenClosedTab();
    }),
    navigate: ready(navigate),
    command: ready(command),
    find: ready(find),
    stopFind: ready(stopFind),
    answerAuth: ready(answerAuth),
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
    agentRun: ready((runId, conversationId, action) => agent.perform(runId, conversationId, action)),
    agentResume: ready(() => agent.resume()),
    agentTakeOver: ready(() => agent.takeOver()),
    agentEnd: ready((runId) => agent.end(runId)),
  };
}

module.exports = { createBrowserManager };
