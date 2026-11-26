// Mini Me's preview: a small panel docked beside his speech bubble, showing a
// project folder served on 127.0.0.1 (electron/projectServer.js). It follows
// him as he walks or is dragged, hides with him, closes when his bubble
// closes, and is never a window of its own (no taskbar entry, not movable).
// It loads Marven's /companion/preview page (toolbar + iframe), nothing else.
const { BrowserWindow, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { attachedBounds, sanitizeBubbleRect } = require('./previewPlacement');

const MAX_NAME = 80;

/**
 * @param {{ appPort: number, companionWindow: () => (import('electron').BrowserWindow | null), onClosed?: () => void }} options
 */
function createPreviewWindow({ appPort, companionWindow, onClosed }) {
  const appOrigin = `http://localhost:${appPort}`;
  let win = null;
  let current = null; // { root, url, name }
  let side = null; // 'left' | 'right'
  let bubble = null; // the speech bubble's rect inside the companion window

  const alive = () => !!win && !win.isDestroyed();
  const companion = () => {
    const c = companionWindow();
    return c && !c.isDestroyed() ? c : null;
  };
  const hasIndex = () => {
    try {
      return !!current && fs.statSync(path.join(current.root, 'index.html')).isFile();
    } catch {
      return false;
    }
  };
  const pageUrl = () => {
    const q = new URLSearchParams({ u: current.url, n: current.name, ready: hasIndex() ? '1' : '0' });
    return `${appOrigin}/companion/preview?${q}`;
  };
  const isPreviewPage = (target) => {
    try {
      const u = new URL(target);
      return u.origin === appOrigin && u.pathname === '/companion/preview';
    } catch {
      return false;
    }
  };

  /** Where the panel goes for Mini Me's window as it is now. */
  function boundsFor(c) {
    const b = c.getBounds();
    const display = screen.getDisplayMatching(b);
    return attachedBounds(b, display.workArea, { prefer: side || undefined, bubble });
  }

  /** Mini Me moved (walk, drag, drop, resize): keep the panel beside him. */
  function follow() {
    const c = companion();
    if (!alive() || !c) return;
    const { side: nextSide, ...bounds } = boundsFor(c);
    side = nextSide;
    win.setBounds(bounds);
  }

  /** Show `project` (a checked folder and its server address) beside Mini Me. */
  function show(project) {
    const c = companion();
    if (!c) return false;
    current = { root: project.root, url: project.url, name: String(project.name || '').slice(0, MAX_NAME) };
    if (!alive()) {
      side = null;
      const { side: firstSide, ...bounds } = boundsFor(c);
      side = firstSide;
      win = new BrowserWindow({
        ...bounds,
        parent: c,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        show: false,
        title: current.name || 'Preview',
        backgroundColor: '#00000000',
        ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          preload: path.join(__dirname, 'previewPreload.js'),
        },
      });
      const w = win;
      w.setAlwaysOnTop(true, 'floating');
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
      const block = (event, target) => {
        if (!isPreviewPage(target)) event.preventDefault();
      };
      w.webContents.on('will-navigate', block);
      w.webContents.on('will-redirect', block);
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      w.once('ready-to-show', () => {
        if (!w.isDestroyed() && companion()?.isVisible()) w.showInactive();
      });
      w.on('closed', () => {
        if (win === w) win = null;
        onClosed?.();
      });
    } else {
      follow();
      if (!win.isVisible()) win.showInactive();
    }
    win.setTitle(current.name || 'Preview');
    win.loadURL(pageUrl());
    return true;
  }

  /** Files changed: the page reloads its frame (and learns whether index.html exists yet). */
  function reload() {
    if (alive()) win.webContents.send('preview:reload', { hasIndex: hasIndex() });
  }

  /** Where his speech bubble is now (it changes size); null: the bubble closed, and the preview goes with it. */
  function setBubble(rect) {
    bubble = sanitizeBubbleRect(rect);
    if (!bubble) close();
    else follow();
  }

  /** Mini Me was hidden or shown again. */
  function setVisible(on) {
    if (!alive()) return;
    if (on) {
      follow();
      win.showInactive();
    } else win.hide();
  }

  function close() {
    if (alive()) win.close();
  }

  const isSender = (event) => alive() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;

  return { show, reload, follow, setBubble, setVisible, close, isSender, isOpen: alive, current: () => current };
}

module.exports = { createPreviewWindow };
