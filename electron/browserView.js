// In-app browser: one native WebContentsView layered over the renderer, where
// the chat's browser panel reserves space. The renderer tells us where (its
// viewport div's rect) and what to load; page state flows back as events.
//
// Security model — the page is untrusted web content:
//  - its own session partition: no cookies/storage shared with Marven's UI
//  - sandboxed, context-isolated, no Node, no preload
//  - only http(s) navigations (checked on navigate + redirect); popups open in
//    the same view instead of new windows
//  - every permission request (camera, mic, geolocation, notifications…) denied
//  - downloads are handed to the system browser rather than written to disk
//  - IPC is only accepted from Marven's own window

const { WebContentsView, ipcMain, session, shell } = require('electron');

const PARTITION = 'persist:marven-browser';

function isWebUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function cleanBounds(b) {
  if (!b || typeof b !== 'object') return null;
  const n = (v) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : NaN);
  const bounds = { x: n(b.x), y: n(b.y), width: n(b.width), height: n(b.height) };
  return Object.values(bounds).some(Number.isNaN) ? null : bounds;
}

/**
 * @param {() => import('electron').BrowserWindow | null} getWindow
 */
function registerInAppBrowser(getWindow) {
  let view = null;
  let sessionReady = false;

  const fromApp = (event) => {
    const win = getWindow();
    return !!win && !win.isDestroyed() && event.sender === win.webContents;
  };

  function sendState() {
    const win = getWindow();
    if (!view || !win || win.isDestroyed()) return;
    const wc = view.webContents;
    if (wc.isDestroyed()) return;
    const history = wc.navigationHistory;
    win.webContents.send('browser-state', {
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: history ? history.canGoBack() : wc.canGoBack(),
      canGoForward: history ? history.canGoForward() : wc.canGoForward(),
      loading: wc.isLoading(),
    });
  }

  function prepareSession() {
    const ses = session.fromPartition(PARTITION);
    if (sessionReady) return ses;
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event, item) => {
      event.preventDefault();
      const url = item.getURL();
      if (isWebUrl(url)) void shell.openExternal(url);
    });
    sessionReady = true;
    return ses;
  }

  function ensureView() {
    if (view && !view.webContents.isDestroyed()) return view;
    view = new WebContentsView({
      webPreferences: {
        session: prepareSession(),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void wc.loadURL(url);
      return { action: 'deny' };
    });
    const guard = (event, url) => {
      if (!isWebUrl(url)) event.preventDefault();
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    for (const name of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) {
      wc.on(name, sendState);
    }
    return view;
  }

  function attach(win) {
    const v = ensureView();
    if (!win.contentView.children.includes(v)) win.contentView.addChildView(v);
    return v;
  }

  function hide() {
    if (view && !view.webContents.isDestroyed()) view.setVisible(false);
  }

  ipcMain.handle('browser-show', (event, { bounds, url } = {}) => {
    if (!fromApp(event)) return false;
    const win = getWindow();
    const b = cleanBounds(bounds);
    if (!b) return false;
    const v = attach(win);
    v.setBounds(b);
    v.setVisible(true);
    const current = v.webContents.getURL();
    if (url && isWebUrl(url) && (!current || current === 'about:blank')) void v.webContents.loadURL(url);
    sendState();
    return true;
  });

  ipcMain.on('browser-bounds', (event, bounds) => {
    if (!fromApp(event) || !view) return;
    const b = cleanBounds(bounds);
    if (b) view.setBounds(b);
  });

  ipcMain.on('browser-hide', (event) => {
    if (fromApp(event)) hide();
  });

  ipcMain.handle('browser-navigate', (event, url) => {
    if (!fromApp(event) || !isWebUrl(url)) return false;
    void ensureView().webContents.loadURL(url);
    return true;
  });

  ipcMain.on('browser-command', (event, command) => {
    if (!fromApp(event) || !view || view.webContents.isDestroyed()) return;
    const wc = view.webContents;
    const history = wc.navigationHistory;
    if (command === 'back') history ? history.goBack() : wc.goBack();
    else if (command === 'forward') history ? history.goForward() : wc.goForward();
    else if (command === 'reload') wc.reload();
    else if (command === 'stop') wc.stop();
  });

  // Hook the window once it exists: a renderer reload (HMR, crash recovery)
  // must not leave the native view floating over a page that no longer has a
  // browser panel.
  return function attachWindow(win) {
    win.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) hide();
    });
    win.on('closed', () => {
      if (view && !view.webContents.isDestroyed()) view.webContents.close();
      view = null;
    });
  };
}

module.exports = { registerInAppBrowser, isWebUrl };
