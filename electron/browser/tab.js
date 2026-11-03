// One browser tab: a native WebContentsView created the first time the tab is
// shown (restored tabs stay unloaded until then), plus the page state the UI
// draws. Security is the same for every tab: sandboxed, no Node, no preload,
// http(s) only, client certificates are never handed out, and repeated dialogs
// can be suppressed by the user. Links and window.open() become new tabs; a
// pop-up window (window.open with features, as sign-in flows use) becomes a
// tab that keeps its opener, so it can post back and close itself.

const { WebContentsView } = require('electron');
const { isWebUrl } = require('./validate');
const { withoutFragment } = require('./history');

const ERR_ABORTED = -3;
const isCertificateError = (code) => code <= -200 && code > -300;
// Leaving fullscreen runs in its own isolated world (not the page's, not 999
// for preloads, not 1001 for page extraction).
const FULLSCREEN_WORLD_ID = 1002;
const EXIT_FULLSCREEN = 'if (document.fullscreenElement) document.exitFullscreen().catch(() => {});';

function securePreferences(session) {
  return {
    session,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    safeDialogs: true,
    autoplayPolicy: 'document-user-activation-required',
  };
}

class Tab {
  /**
   * @param {{ id: string, url: string, title: string, session: Electron.Session, hooks: {
   *   onUpdate: (tab: Tab) => void,
   *   onVisit: (url: string, title: string) => void,
   *   onTitle: (url: string, title: string) => void,
   *   onFavicon: (tab: Tab, iconUrl: string) => void,
   *   onOpenTab: (tab: Tab, url: string, options: { background: boolean }) => void,
   *   allowPopup: (tab: Tab) => boolean,
   *   onPopup: (tab: Tab, url: string, options: Electron.BrowserWindowConstructorOptions) => Electron.WebContents,
   *   onClosedByPage: (tab: Tab) => void,
   *   onContextMenu: (tab: Tab, params: Electron.ContextMenuParams) => void,
   *   onFullscreen: (tab: Tab, on: boolean) => void,
   *   onShortcut: (input: Electron.Input) => boolean,
   *   onView: (tab: Tab) => void,
   * } }} options
   */
  constructor({ id, url, title, session, hooks }) {
    this.id = id;
    this.url = url;
    this.title = title || '';
    this.session = session;
    this.hooks = hooks;
    this.view = null;
    this.webContentsId = null;
    this.favicon = null;
    this.loading = false;
    this.error = null;
    this.blocked = 0;
    // Bumped on every cross-document main-frame commit, so async work started
    // for one page (a favicon fetch) can tell the page has changed since.
    this.navigation = 0;
    // The `navigation` a favicon fetch is running for, or null.
    this.faviconFetch = null;
    // History bookkeeping, so anchor jumps and title churn don't spam it.
    this.visitedUrl = null;
    this.titleRecorded = false;
    // Find in page: the last result, or null when not searching.
    this.find = null;
    // A pending HTTP sign-in request from the server: { host, realm, isProxy, callback }.
    this.auth = null;
    this.fullscreen = false;
  }

  // A view's webContents can be gone (not just destroyed) once a pop-up has
  // closed itself.
  get webContents() {
    const wc = this.view?.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  ensureView() {
    if (this.webContents) return this.view;
    this.adoptView(new WebContentsView({ webPreferences: securePreferences(this.session) }));
    if (isWebUrl(this.url)) this.view.webContents.loadURL(this.url).catch(() => {});
    return this.view;
  }

  // Creates the view for a pop-up window Chromium is opening. `options` carry
  // the link to its opener; our own preferences go on top.
  adoptPopup(options) {
    this.adoptView(new WebContentsView({
      ...(options.webContents ? { webContents: options.webContents } : {}),
      webPreferences: { ...options.webPreferences, ...securePreferences(this.session) },
    }));
    return this.view.webContents;
  }

  adoptView(view) {
    this.view = view;
    this.view.setVisible(false);
    const wc = this.view.webContents;
    this.webContentsId = wc.id;
    this.wire(wc);
    this.hooks.onView(this);
  }

  wire(wc) {
    const update = () => this.hooks.onUpdate(this);

    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (!isWebUrl(url)) return { action: 'deny' };
      if (disposition === 'new-window') {
        if (!this.hooks.allowPopup(this)) return { action: 'deny' };
        return {
          action: 'allow',
          overrideBrowserWindowOptions: { webPreferences: securePreferences(this.session) },
          createWindow: (options) => this.hooks.onPopup(this, url, options),
        };
      }
      this.hooks.onOpenTab(this, url, { background: disposition === 'background-tab' });
      return { action: 'deny' };
    });
    // A pop-up that closes itself (window.close()) closes its tab. Our own
    // destroyView clears webContentsId first, so it doesn't land here.
    const id = wc.id;
    wc.once('destroyed', () => {
      if (this.webContentsId === id) this.hooks.onClosedByPage(this);
    });
    wc.on('context-menu', (_e, params) => this.hooks.onContextMenu(this, params));
    wc.on('found-in-page', (_e, result) => {
      if (!result.finalUpdate || !this.find) return;
      this.find = { active: result.activeMatchOrdinal, total: result.matches };
      update();
    });
    wc.on('enter-html-full-screen', () => {
      this.fullscreen = true;
      this.hooks.onFullscreen(this, true);
    });
    // Chromium can drop out of fullscreen (Escape) without the page's
    // document following, so make sure the page leaves too.
    wc.on('leave-html-full-screen', () => {
      this.fullscreen = false;
      this.runExitFullscreen();
      this.hooks.onFullscreen(this, false);
    });
    // HTTP sign-in (basic/digest, or a proxy): the UI asks for the details.
    // A newer request replaces an unanswered one, which is cancelled.
    wc.on('login', (event, _details, authInfo, callback) => {
      event.preventDefault();
      this.cancelAuth();
      this.auth = { host: authInfo.host, realm: authInfo.realm, isProxy: authInfo.isProxy, callback };
      update();
    });
    wc.on('select-client-certificate', (event, _url, _list, callback) => {
      event.preventDefault();
      callback();
    });
    const guard = (details) => {
      if (!isWebUrl(details.url)) details.preventDefault();
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);

    // The old page stays on screen until the new one commits, so only the
    // error is cleared when a navigation starts; the rest resets on commit.
    // (Failed loads don't emit did-navigate.)
    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      this.error = null;
      update();
    });
    wc.on('did-navigate', (_e, url) => {
      this.url = url;
      this.favicon = null;
      this.find = null;
      this.blocked = 0;
      this.title = ''; // the page's own page-title-updated sets it
      this.navigation += 1;
      this.titleRecorded = false;
      this.visitedUrl = url;
      // Chromium's title at commit time is often just the URL, so the visit is
      // recorded untitled (keeping any title saved before) and the page's own
      // page-title-updated fills it in.
      this.hooks.onVisit(url, '');
      update();
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.url = url;
      // A new route in a single-page app (not an anchor jump) is its own
      // history entry, and gets its own first title.
      if (withoutFragment(url) !== withoutFragment(this.visitedUrl)) {
        this.visitedUrl = url;
        this.titleRecorded = false;
        this.hooks.onVisit(url, wc.getTitle());
      }
      update();
    });
    // History keeps the first title a page sets after each commit; later
    // changes (unread counters, tickers) only update the tab.
    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      if (!this.titleRecorded) {
        this.titleRecorded = true;
        this.hooks.onTitle(this.url, title);
      }
      update();
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      if (favicons[0]) this.hooks.onFavicon(this, favicons[0]);
    });
    wc.on('did-start-loading', () => {
      this.loading = true;
      update();
    });
    wc.on('did-stop-loading', () => {
      this.loading = false;
      update();
    });
    wc.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return;
      if (isWebUrl(validatedURL)) this.url = validatedURL;
      this.error = { kind: isCertificateError(code) ? 'certificate' : 'unreachable', description };
      update();
    });
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      this.error = { kind: 'crashed', description: details.reason };
      this.loading = false;
      update();
    });
    wc.on('before-input-event', (event, input) => {
      if (this.hooks.onShortcut(input)) event.preventDefault();
    });
  }

  // With a view, `url` follows the page (did-navigate / did-fail-load set it);
  // a tab with no view yet keeps the URL so ensureView loads it.
  load(url) {
    if (!isWebUrl(url)) return false;
    this.error = null;
    this.cancelAuth();
    const wc = this.webContents;
    if (wc) wc.loadURL(url).catch(() => {});
    else this.url = url;
    this.hooks.onUpdate(this);
    return true;
  }

  canGoBack() {
    return !!this.webContents?.navigationHistory.canGoBack();
  }

  canGoForward() {
    return !!this.webContents?.navigationHistory.canGoForward();
  }

  command(name) {
    const wc = this.webContents;
    if (!wc) return;
    this.cancelAuth();
    if (name === 'back') wc.navigationHistory.goBack();
    else if (name === 'forward') wc.navigationHistory.goForward();
    else if (name === 'reload') wc.reload();
    else if (name === 'stop') wc.stop();
    else if (name === 'retry') {
      this.error = null;
      wc.loadURL(this.url).catch(() => {});
      this.hooks.onUpdate(this);
    }
  }

  // Starts a search for `text`, or with `again` moves to the next (or, not
  // `forward`, previous) match of the same text. Empty text ends the search.
  findInPage(text, { forward = true, again = false } = {}) {
    const wc = this.webContents;
    if (!wc) return;
    if (!text) {
      this.stopFind();
      return;
    }
    if (!this.find) this.find = { active: 0, total: 0 };
    // Electron's findNext means "start a new search session".
    wc.findInPage(text, { forward, findNext: !again });
  }

  stopFind() {
    if (!this.find) return;
    this.find = null;
    this.webContents?.stopFindInPage('clearSelection');
    this.hooks.onUpdate(this);
  }

  // Answers the pending sign-in request; no username cancels it.
  answerAuth(username, password) {
    const auth = this.auth;
    if (!auth) return;
    this.auth = null;
    if (username) auth.callback(username, password);
    else auth.callback();
    this.hooks.onUpdate(this);
  }

  cancelAuth() {
    const auth = this.auth;
    if (!auth) return;
    this.auth = null;
    auth.callback();
  }

  exitFullscreen() {
    if (this.fullscreen) this.runExitFullscreen();
  }

  runExitFullscreen() {
    this.webContents?.executeJavaScriptInIsolatedWorld(FULLSCREEN_WORLD_ID, [{ code: EXIT_FULLSCREEN }], true).catch(() => {});
  }

  destroyView() {
    const wc = this.webContents;
    this.cancelAuth();
    this.view = null;
    this.webContentsId = null;
    if (wc) wc.close();
  }
}

module.exports = { Tab };
