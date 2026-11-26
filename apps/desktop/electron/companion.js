// electron/companion.js
//
// The Mini Me companion: a small transparent, always-on-top window showing
// the /companion page. The main process owns its position: walking, dragging,
// keeping it on screen and remembering where it was. Geometry lives in
// companionPlacement.js.
//
// How Linux differs (macOS and Windows are unchanged):
// - Click-through. macOS/Windows make the window ignore the mouse with
//   `setIgnoreMouseEvents(true, { forward: true })`; the page still sees mouse
//   moves and asks for the mouse back (companion:set-interactive) while the
//   pointer is over a `[data-hit]` element. `forward` is macOS/Windows only, so
//   on Linux the page would never see the pointer. There the window gets a
//   shape instead (`setShape`, Windows/Linux): the page reports its `[data-hit]`
//   rects (companion:set-hit-rects), and only that area (padded, see
//   companionShape.js) is drawn and takes clicks; everything else falls
//   through. set-interactive is a no-op there.
// - Keyboard focus. macOS/Windows build the window non-focusable and toggle it
//   with setFocusable (companion:set-focusable) while the bubble's input is in
//   use. setFocusable is macOS/Windows only, and on Linux `focusable: false`
//   takes the window out of the window manager's hands for good, so the input
//   could never be typed in. On Linux the window is built focusable instead
//   (skipTaskbar, always-on-top and all workspaces as elsewhere) and
//   set-focusable(true) focuses it; set-focusable(false) leaves focus alone.
//   Because the shape limits clicks to Mini Me and his bubble, the window can
//   only take focus when the user clicks him (or opens the bubble with the
//   shortcut).
// - Wayland. Under native Wayland a window can't position itself (setPosition
//   and setBounds are ignored), and always-on-top and shapes aren't reliable,
//   so Mini Me couldn't walk or be dragged. main.js relaunches Marven under
//   XWayland (`--ozone-platform=x11`) while Mini Me is on; see linuxDisplay.js.
//   MARVEN_NATIVE_WAYLAND=1 opts out. Turning Mini Me on while already running
//   natively on Wayland needs a restart: the window isn't created until then
//   (it couldn't be placed or kept on top), and status() reports
//   needsRestartForLinux (Settings → Mini Me offers "Restart now"). If the
//   XWayland relaunch died before it was ready, that launch stays native and
//   status() reports xwaylandFailed instead; Mini Me shows but can't move.
// - Display scale changes re-apply the window shape (it's in window DIPs).

const { BrowserWindow, screen, globalShortcut, ipcMain, clipboard, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const placement = require('./companionPlacement');
const shape = require('./companionShape');
const { isReservedHotkey, projectFolderInside, isLoopbackHttpUrl, DEFAULT_PROJECTS_DIR } = require('./companionGuards');

const TICK_MS = 33;
const WALK_PX_BY_SPEED = { slow: 1, normal: 2, fast: 4 };
const ACTIVITIES = ['lively', 'calm', 'still'];
const PERSONALITIES = ['playful', 'neutral', 'detailed'];
const FALL_PX_PER_TICK = 8;
const MAX_LOAD_RETRIES = 20;
const POSITION_SAVE_INTERVAL_MS = 30000;
const MAX_CLIPBOARD_CHARS = 20000;
// Linux has no forwarded mouse moves: click-through comes from the window shape instead.
const USE_SHAPE = process.platform === 'linux';
// Linux can't toggle focusability (setFocusable is macOS/Windows only): the window is built focusable.
const ALWAYS_FOCUSABLE = process.platform === 'linux';

/** The configured projects folder, as typed (a leading ~ is the home folder). */
function projectsDirSetting(s) {
  return typeof s.miniMeProjectsDir === 'string' && s.miniMeProjectsDir.trim() ? s.miniMeProjectsDir.trim() : DEFAULT_PROJECTS_DIR;
}

function placementDisplays() {
  return screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }));
}

/** The window size for the saved size step and the look's art style (validated in companionPlacement). */
const windowSizeFor = (s) => placement.windowSize(
  s.miniMeScale,
  s.miniMeLook && typeof s.miniMeLook === 'object' ? s.miniMeLook.artStyle : undefined,
);
const sameSize = (a, b) => a.width === b.width && a.height === b.height;

/**
 * @param {{
 *   appPort: number,
 *   savePosition: (position: { x: number, y: number, displayId: number }) => void,
 *   isQuitting?: () => boolean,
 *   onStatusChange?: (status: { visible: boolean, hotkeyOk: boolean, hotkeyReason: 'reserved' | 'taken' | null, unavailable: boolean, wakeWord: boolean, needsRestartForLinux: boolean, xwaylandFailed: boolean }) => void,
 *   nativeWayland?: boolean,
 *   xwaylandFailed?: boolean,
 * }} options
 *
 * `nativeWayland`: this process runs natively on Wayland where XWayland would
 * have been used had Mini Me been on at launch; Mini Me waits for a restart.
 * `xwaylandFailed`: the XWayland relaunch died before it was ready; this launch
 * is on native Wayland (Mini Me shows, but can't move).
 */
function createCompanion({ appPort, savePosition, isQuitting = () => false, onStatusChange, nativeWayland = false, xwaylandFailed = false }) {
  let win = null;
  let settings = {};
  let size = placement.windowSize(3);
  let walkTarget = null;
  let walkTimer = null;
  let fallTicks = 0;
  let facing = 1;
  let hotkey = null;
  let hotkeyOk = true;
  let hotkeyReason = null;
  let unavailable = false;
  let retryTimer = null;
  let savePending = false;
  let lastSaveAt = 0;
  let saveTimer = null;
  let hitRects = []; // Linux: the page's last reported [data-hit] rects
  let appliedShape = null;
  const url = `http://localhost:${appPort}/companion`;

  const alive = () => !!win && !win.isDestroyed();
  // Linux, native Wayland, Mini Me turned on: no window until Marven restarts under XWayland.
  const waitingForRestart = () => !!nativeWayland && !!settings.miniMeEnabled;
  const status = () => ({
    visible: alive() && win.isVisible(),
    hotkeyOk,
    hotkeyReason,
    unavailable,
    wakeWord: !!settings.miniMeWakeWord,
    needsRestartForLinux: waitingForRestart(),
    xwaylandFailed: !!xwaylandFailed && !!settings.miniMeEnabled,
  });
  const notify = () => { if (onStatusChange) onStatusChange(status()); };

  const walkStep = () => WALK_PX_BY_SPEED[settings.miniMeSpeed] || WALK_PX_BY_SPEED.normal;

  const rendererSettings = () => ({
    speak: settings.miniMeSpeak !== false,
    scale: [2, 3, 4].includes(Number(settings.miniMeScale)) ? Number(settings.miniMeScale) : 3,
    activity: ACTIVITIES.includes(settings.miniMeActivity) ? settings.miniMeActivity : 'lively',
    personality: PERSONALITIES.includes(settings.miniMePersonality) ? settings.miniMePersonality : 'playful',
    drop: placement.dropMode(settings.miniMeDrop),
    sleepMinutes: Number(settings.miniMeSleepMinutes) > 0 ? Number(settings.miniMeSleepMinutes) : 5,
    wakeWord: !!settings.miniMeWakeWord,
    projectsDir: projectsDirSetting(settings),
    // Passed through as-is; the renderer validates it (parseLook).
    look: settings.miniMeLook && typeof settings.miniMeLook === 'object' && !Array.isArray(settings.miniMeLook) ? settings.miniMeLook : null,
  });

  function currentDisplay() {
    const [x, y] = win.getPosition();
    const { displayId } = placement.clampToDisplays({ x, y, ...size }, placementDisplays());
    return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
  }

  function positionPayload(extra = {}) {
    if (!alive()) return null;
    const [x, y] = win.getPosition();
    const wa = currentDisplay().workArea;
    const strip = placement.dockStrip(wa, size);
    return {
      x,
      y,
      facing,
      walking: !!walkTarget,
      inDock: placement.isInDockStrip({ x, y, ...size }, wa),
      strip: { minX: strip.minX, maxX: strip.maxX },
      ...extra,
    };
  }

  function sendPosition(extra = {}) {
    const payload = positionPayload(extra);
    if (payload) win.webContents.send('companion:position', payload);
  }

  function flushPosition() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (!savePending) return;
    savePending = false;
    lastSaveAt = Date.now();
    const pos = settings.miniMePosition;
    if (pos && typeof savePosition === 'function') {
      try { savePosition(pos); } catch { /* best effort */ }
    }
  }

  /**
   * Remember the current position in memory every time; persist it right away
   * on a drop, and at most once per POSITION_SAVE_INTERVAL_MS after walks.
   */
  function recordPosition({ immediate }) {
    if (!alive()) return;
    const [x, y] = win.getPosition();
    settings = { ...settings, miniMePosition: { x, y, displayId: currentDisplay().id } };
    savePending = true;
    if (immediate) return flushPosition();
    if (saveTimer) return;
    const wait = Math.max(0, lastSaveAt + POSITION_SAVE_INTERVAL_MS - Date.now());
    if (wait === 0) return flushPosition();
    saveTimer = setTimeout(flushPosition, wait);
  }

  /** Linux: shape the window to the hit rects (or the default sprite box), skipping no-op updates. */
  function applyShape() {
    if (!USE_SHAPE || !alive()) return;
    const next = shape.shapeFor(hitRects, size);
    if (appliedShape && shape.sameRects(next, appliedShape)) return;
    appliedShape = next;
    try {
      win.setShape(next);
    } catch (err) {
      console.warn('[Marven] Mini Me: could not set the window shape:', err && err.message);
    }
  }

  function stopWalking() {
    if (walkTimer) clearInterval(walkTimer);
    walkTimer = null;
    walkTarget = null;
  }

  const isFalling = () => !!walkTarget && !!walkTarget.fall;

  function walkTo(target) {
    if (!alive()) return;
    if (target.fall && !isFalling()) fallTicks = 0;
    const [x] = win.getPosition();
    if (target.x !== x) facing = target.x > x ? 1 : -1;
    const wa = currentDisplay().workArea;
    const [, y] = win.getPosition();
    walkTarget = { ...target, dock: placement.isInDockStrip({ x, y, ...size }, wa) || !!target.dock };
    if (!walkTimer) {
      walkTimer = setInterval(() => {
        if (!alive() || !walkTarget) return stopWalking();
        const [cx, cy] = win.getPosition();
        const nx = placement.stepToward(cx, walkTarget.x, walkStep());
        const ny = placement.stepToward(cy, walkTarget.y, walkTarget.fall ? placement.fallSpeed(fallTicks++) : FALL_PX_PER_TICK);
        win.setPosition(Math.round(nx), Math.round(ny));
        const [ax, ay] = win.getPosition();
        // Arrived, or the window didn't move at all (blocked): stop either way.
        const reached = nx === walkTarget.x && ny === walkTarget.y;
        if (reached || (ax === cx && ay === cy)) {
          const landed = !!walkTarget.fall;
          stopWalking();
          recordPosition({ immediate: landed });
          sendPosition({ arrived: true });
        }
      }, TICK_MS);
    }
    sendPosition();
  }

  function reclamp() {
    if (!alive()) return;
    const [x, y] = win.getPosition();
    const c = placement.clampToDisplays({ x, y, ...size }, placementDisplays());
    if (c.x !== x || c.y !== y) win.setPosition(c.x, c.y);
    if (walkTarget) {
      // Keep walking, now along the strip of whichever display the window landed on.
      const display = screen.getAllDisplays().find((d) => d.id === c.displayId) || screen.getPrimaryDisplay();
      const strip = placement.dockStrip(display.workArea, size);
      walkTarget = {
        ...walkTarget,
        x: Math.min(Math.max(walkTarget.x, strip.minX), strip.maxX),
        y: walkTarget.dock
          ? strip.y
          : Math.min(Math.max(walkTarget.y, display.workArea.y), display.workArea.y + display.workArea.height - size.height),
      };
    }
    sendPosition();
  }

  function create() {
    size = windowSizeFor(settings);
    const pos = placement.restorePosition(settings.miniMePosition, placementDisplays(), screen.getPrimaryDisplay().id, size, {
      dockOnly: placement.dropMode(settings.miniMeDrop) === 'dock',
    });
    const w = new BrowserWindow({
      ...size,
      x: pos.x,
      y: pos.y,
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
      focusable: ALWAYS_FOCUSABLE,
      backgroundColor: '#00000000',
      // A non-activating panel: typing in the bubble doesn't pull Marven's main window forward.
      ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'companionPreload.js'),
      },
    });
    win = w;
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    if (USE_SHAPE) {
      // Until the page reports its rects, take clicks over the sprite's spot only.
      hitRects = [];
      appliedShape = null;
      applyShape();
    } else {
      win.setIgnoreMouseEvents(true, { forward: true });
    }

    // Never let the companion page leave the app origin.
    const appOrigin = `http://localhost:${appPort}`;
    const blockOffOrigin = (event, target) => {
      let ok = false;
      try {
        const u = new URL(target);
        ok = u.origin === appOrigin && (u.pathname === '/companion' || u.pathname.startsWith('/companion/'));
      } catch { ok = false; }
      if (!ok) event.preventDefault();
    };
    w.webContents.on('will-navigate', (event, target) => blockOffOrigin(event, target));
    w.webContents.on('will-redirect', (event, target) => blockOffOrigin(event, target));
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    let loadFailed = false;
    let retries = 0;
    const isCompanionUrl = (target) => {
      try {
        const u = new URL(target);
        return u.origin === appOrigin && (u.pathname === '/companion' || u.pathname.startsWith('/companion/'));
      } catch { return false; }
    };
    const load = () => { loadFailed = false; w.loadURL(url); };

    // Only show once the real page has loaded (not Chromium's error page).
    w.webContents.on('did-finish-load', () => {
      if (win !== w || w.isDestroyed()) return;
      if (loadFailed || !isCompanionUrl(w.webContents.getURL())) return;
      retries = 0;
      if (!w.isVisible()) w.showInactive();
      // A focusable window is managed by the window manager on Linux: ask again to keep it
      // out of the taskbar now that it's mapped (the option is documented for macOS/Windows only).
      if (ALWAYS_FOCUSABLE) w.setSkipTaskbar(true);
      sendPosition();
      notify();
    });

    // Same capped, non-overlapping retry as the main window.
    w.webContents.on('did-fail-load', (_event, _code, _desc, _url, isMainFrame) => {
      if (!isMainFrame || win !== w || w.isDestroyed()) return;
      loadFailed = true;
      if (retries >= MAX_LOAD_RETRIES) {
        unavailable = true;
        w.hide();
        registerHotkey(); // no window to open: free the shortcut
        notify();
        return;
      }
      retries++;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (win === w && !w.isDestroyed()) load();
      }, 1500);
    });
    w.webContents.on('render-process-gone', () => {
      if (win !== w) return;
      unavailable = true;
      destroy();
      registerHotkey();
    });
    // Veto accidental closes (Cmd+W, Alt+F4) unless the app is quitting.
    // Mini Me is turned off through applySettings, which uses destroy() and skips this.
    w.on('close', (event) => {
      if (!isQuitting()) event.preventDefault();
    });
    w.on('closed', () => {
      if (win === w) {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
        stopWalking();
        flushPosition();
        win = null;
      }
      notify();
    });
    load();
  }

  function destroy() {
    stopWalking();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    flushPosition();
    if (alive()) win.destroy();
    win = null;
    notify();
  }

  function openInput() {
    if (!alive() || unavailable) return;
    if (!win.isVisible()) win.showInactive();
    win.webContents.send('companion:open-input');
  }

  function registerHotkey() {
    if (hotkey) {
      globalShortcut.unregister(hotkey);
      hotkey = null;
    }
    hotkeyOk = true;
    hotkeyReason = null;
    const accel = typeof settings.miniMeHotkey === 'string' ? settings.miniMeHotkey.trim() : '';
    if (!accel || !settings.miniMeEnabled || unavailable || waitingForRestart()) return;
    if (isReservedHotkey(accel)) {
      hotkeyOk = false; // Marven's own Listen shortcut
      hotkeyReason = 'reserved';
      return;
    }
    try {
      hotkeyOk = globalShortcut.register(accel, openInput);
    } catch {
      hotkeyOk = false;
    }
    if (hotkeyOk) hotkey = accel;
    else hotkeyReason = 'taken';
  }

  // ── IPC from the companion page only ────────────────────────────────────────
  const fromCompanion = (event) => alive() && event.sender === win.webContents;

  ipcMain.handle('companion:get-position', (event) => (fromCompanion(event) ? positionPayload() : null));
  ipcMain.handle('companion:get-settings', (event) => (fromCompanion(event) ? rendererSettings() : null));
  ipcMain.handle('companion:read-clipboard', (event) => {
    if (!fromCompanion(event)) return '';
    try {
      return clipboard.readText().slice(0, MAX_CLIPBOARD_CHARS);
    } catch {
      return '';
    }
  });
  // Open a finished project's folder: only paths inside the projects folder.
  ipcMain.handle('companion:open-path', async (event, target) => {
    if (!fromCompanion(event)) return 'not allowed';
    const real = projectFolderInside(target, settings.miniMeProjectsDir, { home: os.homedir(), realpath: fs.realpathSync.native, lstat: fs.lstatSync });
    if (!real) return 'not allowed';
    return shell.openPath(real);
  });
  // Open the dev server a build started: http(s) on this machine only.
  ipcMain.handle('companion:open-url', async (event, url) => {
    if (!fromCompanion(event) || !isLoopbackHttpUrl(url)) return false;
    await shell.openExternal(url);
    return true;
  });
  ipcMain.on('companion:set-interactive', (event, on) => {
    // Linux: the window shape decides where clicks land (see the top of this file).
    if (USE_SHAPE || !fromCompanion(event)) return;
    win.setIgnoreMouseEvents(!on, { forward: true });
  });
  // Linux only: the page's [data-hit] rects, in window coordinates.
  ipcMain.on('companion:set-hit-rects', (event, rects) => {
    if (!USE_SHAPE || !fromCompanion(event)) return;
    hitRects = shape.sanitizeHitRects(rects, size);
    applyShape();
  });
  ipcMain.on('companion:set-focusable', (event, on) => {
    if (!fromCompanion(event)) return;
    if (ALWAYS_FOCUSABLE) {
      // Linux: no setFocusable, and no blur() (focus goes back when the user clicks elsewhere).
      if (on) {
        win.focus();
        win.webContents.focus();
      }
      return;
    }
    win.setFocusable(!!on);
    if (on) win.focus();
    // On macOS, blur() orders the window out and straight back in, which shows
    // as Mini Me blinking off and on when the bubble closes. Making the window
    // non-focusable is enough there; elsewhere blur() just drops focus.
    else if (process.platform !== 'darwin') win.blur();
  });
  ipcMain.on('companion:walk-to', (event, x) => {
    if (!fromCompanion(event) || typeof x !== 'number' || !Number.isFinite(x) || isFalling()) return;
    const [, y] = win.getPosition();
    const strip = placement.dockStrip(currentDisplay().workArea, size);
    walkTo({ x: Math.round(Math.min(Math.max(x, strip.minX), strip.maxX)), y });
  });
  ipcMain.on('companion:stop', (event) => {
    // A fall can't be interrupted (the bubble opening mid-fall asks for a stop): he lands first.
    if (!fromCompanion(event) || isFalling()) return;
    stopWalking();
    sendPosition();
  });
  ipcMain.on('companion:drag', (event, dx, dy) => {
    if (!fromCompanion(event) || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    stopWalking();
    const [x, y] = win.getPosition();
    win.setPosition(Math.round(x + dx), Math.round(y + dy));
  });
  ipcMain.on('companion:drop', (event) => {
    if (!fromCompanion(event)) return;
    const [x, y] = win.getPosition();
    const c = placement.clampToDisplays({ x, y, ...size }, placementDisplays());
    const display = screen.getAllDisplays().find((d) => d.id === c.displayId) || screen.getPrimaryDisplay();
    const onDock = placement.isInDockStrip({ x: c.x, y: c.y, ...size }, display.workArea);
    const strip = placement.dockStrip(display.workArea, size);
    win.setPosition(c.x, onDock ? strip.y : c.y);
    if (!onDock && placement.dropMode(settings.miniMeDrop) === 'dock') {
      // Fall straight down to the Dock strip; the walk timer reports "arrived" and saves on landing.
      walkTo({ x: c.x, y: strip.y, dock: true, fall: true });
      sendPosition({ dropped: true, falling: true });
      return;
    }
    recordPosition({ immediate: true });
    sendPosition({ dropped: true });
  });
  ipcMain.on('companion:return-home', (event) => {
    if (!fromCompanion(event) || isFalling()) return;
    const [x] = win.getPosition();
    const strip = placement.dockStrip(currentDisplay().workArea, size);
    walkTo({ x: Math.min(Math.max(x, strip.minX), strip.maxX), y: strip.y, dock: true });
  });

  screen.on('display-added', reclamp);
  screen.on('display-removed', reclamp);
  screen.on('display-metrics-changed', reclamp);
  // Linux: the shape is in window DIPs; re-apply it when the display's scale changes.
  screen.on('display-metrics-changed', (_event, _display, changedMetrics) => {
    if (!USE_SHAPE || !Array.isArray(changedMetrics) || !changedMetrics.includes('scaleFactor')) return;
    appliedShape = null;
    applyShape();
  });

  /** Apply the full settings object (call on launch and after every save). */
  function applySettings(next) {
    const prev = settings;
    const wasUnavailable = unavailable;
    settings = { ...next };
    // A not-yet-saved position is newer than whatever the caller loaded from disk.
    if (savePending && prev.miniMePosition) settings.miniMePosition = prev.miniMePosition;
    const enabled = !!settings.miniMeEnabled;
    if (!enabled) unavailable = false;
    if (enabled && !alive() && !waitingForRestart()) {
      unavailable = false;
      create();
    } else if (!enabled && alive()) {
      destroy();
    } else if (alive() && !sameSize(windowSizeFor(settings), size)) {
      // Size step or art style changed. Keep the feet where they are: the window grows or shrinks upwards.
      const oldHeight = size.height;
      size = windowSizeFor(settings);
      const [x, y] = win.getPosition();
      stopWalking();
      win.setBounds({ x, y: y + oldHeight - size.height, ...size });
      // Linux: the old rects are stale; the sprite's default spot until the page re-reports its layout.
      hitRects = [];
      applyShape();
      reclamp();
    }
    // Switched to "fall back to the Dock" while perched somewhere else: drop him now.
    if (alive() && placement.dropMode(settings.miniMeDrop) === 'dock' && placement.dropMode(prev.miniMeDrop) !== 'dock' && !isFalling()) {
      const [x, y] = win.getPosition();
      const display = currentDisplay();
      if (!placement.isInDockStrip({ x, y, ...size }, display.workArea)) {
        walkTo({ x, y: placement.dockStrip(display.workArea, size).y, dock: true, fall: true });
        sendPosition({ dropped: true, falling: true });
      }
    }
    if (enabled !== !!prev.miniMeEnabled || settings.miniMeHotkey !== prev.miniMeHotkey || unavailable !== wasUnavailable) registerHotkey();
    if (alive()) win.webContents.send('companion:settings', rendererSettings());
    notify();
    return status();
  }

  /** ⌘⇧M while Mini Me is on screen: listen in Mini Me instead of the main window. */
  function triggerListen() {
    if (!status().visible) return false;
    win.webContents.send('companion:listen');
    return true;
  }

  return {
    applySettings,
    status,
    triggerListen,
    webContentsId: () => (alive() ? win.webContents.id : null),
  };
}

module.exports = { createCompanion };
