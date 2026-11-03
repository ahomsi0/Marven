// Where the active page's native view sits in Marven's window: at most one
// view is attached, over the panel's viewport. Tracks whether the panel is
// shown and whether a toolbar menu has the page frozen, keeps the attached
// view's visibility in step, and mutes every view that isn't on screen. While
// a page is fullscreen (a video), its view covers the whole window instead
// (Electron itself takes the window in and out of fullscreen).
// Works with views only; the manager decides which view is active.

const FREEZE_JPEG_QUALITY = 80;

function setMuted(view, muted) {
  const wc = view?.webContents;
  if (wc && !wc.isDestroyed() && wc.isAudioMuted() !== muted) wc.setAudioMuted(muted);
}

/**
 * @param {{
 *   getWindow: () => Electron.BrowserWindow | null,
 *   getPage: () => { showable: boolean, views: Iterable<Electron.WebContentsView | null> },
 * }} options `getPage` says whether the active page may be drawn (it exists
 *   and isn't showing an error) and lists every tab's view.
 */
function createViewHost({ getWindow, getPage }) {
  let bounds = null;
  let shown = false;
  let frozen = false;
  let freezeToken = 0;
  let attached = null;
  let fullscreen = false;
  let onWindowResize = null;

  function liveWindow() {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : null;
  }

  function wholeWindow(win) {
    const [width, height] = win.getContentSize();
    return { x: 0, y: 0, width, height };
  }

  // Where the attached view goes: the panel's viewport, or the whole window.
  function placement() {
    const win = liveWindow();
    return fullscreen && win ? wholeWindow(win) : bounds;
  }

  function detach() {
    if (!attached) return;
    const win = liveWindow();
    attached.setVisible(false);
    setMuted(attached, true);
    if (win && win.contentView.children.includes(attached)) win.contentView.removeChildView(attached);
    attached = null;
  }

  // Attaches `view` (or nothing, for null) in place of the current one.
  function showActive(view) {
    const win = liveWindow();
    if (!win) return;
    if (attached !== view) detach();
    if (view) {
      if (!win.contentView.children.includes(view)) win.contentView.addChildView(view);
      attached = view;
      const b = placement();
      if (b) view.setBounds(b);
    }
    syncVisibility();
  }

  // Only the page on screen plays sound: every other view is muted, so closing
  // the panel, opening an overlay or switching tabs silences it. A frozen page
  // (a toolbar menu is open over it) still counts as on screen.
  function syncVisibility() {
    const { showable, views } = getPage();
    if (attached) attached.setVisible(shown && !frozen && showable);
    for (const view of views) {
      if (view) setMuted(view, !(shown && view === attached));
    }
  }

  function show(b) {
    bounds = b;
    shown = true;
    frozen = false;
    freezeToken += 1;
  }

  function setBounds(b) {
    bounds = b;
    if (attached && !fullscreen) attached.setBounds(b);
  }

  function setFullscreen(on) {
    const win = liveWindow();
    if (!win || on === fullscreen) return;
    fullscreen = on;
    if (on) {
      // The window grows while it animates into fullscreen.
      onWindowResize = () => {
        if (attached) attached.setBounds(wholeWindow(win));
      };
      win.on('resize', onWindowResize);
    } else {
      if (onWindowResize) win.off('resize', onWindowResize);
      onWindowResize = null;
    }
    const b = placement();
    if (attached && b) attached.setBounds(b);
  }

  function hide() {
    shown = false;
    syncVisibility();
  }

  // Menus in the toolbar open over the page area, but a native view draws
  // above the DOM. The renderer shows this screenshot in its place meanwhile.
  async function freeze() {
    if (!attached || !shown || frozen || !getPage().showable) return null;
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

  // The window is gone, and every view with it.
  function windowClosed() {
    attached = null;
    shown = false;
    fullscreen = false;
    onWindowResize = null;
  }

  return {
    hasWindow: () => !!liveWindow(),
    isShown: () => shown,
    isAttached: (view) => !!attached && attached === view,
    isFullscreen: () => fullscreen,
    setFullscreen,
    detach,
    showActive,
    syncVisibility,
    show,
    setBounds,
    hide,
    freeze,
    unfreeze,
    windowClosed,
  };
}

module.exports = { createViewHost };
