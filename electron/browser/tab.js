// One browser tab: a native WebContentsView created the first time the tab is
// shown (restored tabs stay unloaded until then), plus the page state the UI
// draws. Security is the same for every tab: sandboxed, no Node, no preload,
// http(s) only, and window.open becomes a new tab.

const { WebContentsView } = require('electron');
const { isWebUrl } = require('./validate');

const ERR_ABORTED = -3;
const isCertificateError = (code) => code <= -200 && code > -300;

class Tab {
  /**
   * @param {{ id: string, url: string, title: string, session: Electron.Session, hooks: {
   *   onUpdate: (tab: Tab) => void,
   *   onVisit: (url: string, title: string) => void,
   *   onTitle: (url: string, title: string) => void,
   *   onFavicon: (tab: Tab, iconUrl: string) => void,
   *   onOpenTab: (tab: Tab, url: string) => void,
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
  }

  get webContents() {
    return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
  }

  ensureView() {
    if (this.webContents) return this.view;
    this.view = new WebContentsView({
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    this.view.setVisible(false);
    const wc = this.view.webContents;
    this.webContentsId = wc.id;
    this.wire(wc);
    this.hooks.onView(this);
    if (isWebUrl(this.url)) wc.loadURL(this.url).catch(() => {});
    return this.view;
  }

  wire(wc) {
    const update = () => this.hooks.onUpdate(this);

    wc.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) this.hooks.onOpenTab(this, url);
      return { action: 'deny' };
    });
    const guard = (details) => {
      if (!isWebUrl(details.url)) details.preventDefault();
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);

    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      this.blocked = 0;
      this.error = null;
      update();
    });
    wc.on('did-navigate', (_e, url) => {
      this.url = url;
      if (!this.error) this.hooks.onVisit(url, wc.getTitle());
      update();
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.url = url;
      this.hooks.onVisit(url, wc.getTitle());
      update();
    });
    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      this.hooks.onTitle(this.url, title);
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

  load(url) {
    if (!isWebUrl(url)) return false;
    this.url = url;
    this.error = null;
    this.webContents?.loadURL(url).catch(() => {});
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

  destroyView() {
    const wc = this.webContents;
    this.view = null;
    this.webContentsId = null;
    if (wc) wc.close();
  }
}

module.exports = { Tab };
