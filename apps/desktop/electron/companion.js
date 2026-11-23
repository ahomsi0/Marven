// electron/companion.js
//
// The Mini Me companion: a small transparent, always-on-top window showing
// the /companion page. The main process owns its position: walking, dragging,
// keeping it on screen and remembering where it was. Geometry lives in
// companionPlacement.js.

const { BrowserWindow, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const placement = require('./companionPlacement');
const { isReservedHotkey } = require('./companionGuards');

const TICK_MS = 33;
const WALK_PX_BY_SPEED = { slow: 1, normal: 2, fast: 4 };
const ACTIVITIES = ['lively', 'calm', 'still'];
const PERSONALITIES = ['playful', 'neutral', 'detailed'];
const FALL_PX_PER_TICK = 8;
const MAX_LOAD_RETRIES = 20;
const POSITION_SAVE_INTERVAL_MS = 30000;

function placementDisplays() {
  return screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }));
}

/**
 * @param {{
 *   appPort: number,
 *   savePosition: (position: { x: number, y: number, displayId: number }) => void,
 *   isQuitting?: () => boolean,
 *   onStatusChange?: (status: { visible: boolean, hotkeyOk: boolean, unavailable: boolean, wakeWord: boolean }) => void,
 * }} options
 */
function createCompanion({ appPort, savePosition, isQuitting = () => false, onStatusChange }) {
  let win = null;
  let settings = {};
  let size = placement.windowSize(3);
  let walkTarget = null;
  let walkTimer = null;
  let facing = 1;
  let hotkey = null;
  let hotkeyOk = true;
  let unavailable = false;
  let retryTimer = null;
  let savePending = false;
  let lastSaveAt = 0;
  let saveTimer = null;
  const url = `http://localhost:${appPort}/companion`;

  const alive = () => !!win && !win.isDestroyed();
  const status = () => ({
    visible: alive() && win.isVisible(),
    hotkeyOk,
    unavailable,
    wakeWord: !!settings.miniMeWakeWord,
  });
  const notify = () => { if (onStatusChange) onStatusChange(status()); };

  const walkStep = () => WALK_PX_BY_SPEED[settings.miniMeSpeed] || WALK_PX_BY_SPEED.normal;

  const rendererSettings = () => ({
    speak: settings.miniMeSpeak !== false,
    scale: [2, 3, 4].includes(Number(settings.miniMeScale)) ? Number(settings.miniMeScale) : 3,
    // miniMeWalk (a boolean) predates miniMeActivity: false meant "stays put".
    activity: ACTIVITIES.includes(settings.miniMeActivity) ? settings.miniMeActivity : settings.miniMeWalk === false ? 'still' : 'lively',
    personality: PERSONALITIES.includes(settings.miniMePersonality) ? settings.miniMePersonality : 'playful',
    sleepMinutes: Number(settings.miniMeSleepMinutes) > 0 ? Number(settings.miniMeSleepMinutes) : 5,
    wakeWord: !!settings.miniMeWakeWord,
  });

  function currentDisplay() {
    const [x, y] = win.getPosition();
    const { displayId } = placement.clampToDisplays({ x, y, ...size }, placementDisplays());
    return screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();
  }

  function sendPosition(extra = {}) {
    if (!alive()) return;
    const [x, y] = win.getPosition();
    const wa = currentDisplay().workArea;
    const strip = placement.dockStrip(wa, size);
    win.webContents.send('companion:position', {
      x,
      y,
      facing,
      walking: !!walkTarget,
      inDock: placement.isInDockStrip({ x, y, ...size }, wa),
      strip: { minX: strip.minX, maxX: strip.maxX },
      ...extra,
    });
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

  function stopWalking() {
    if (walkTimer) clearInterval(walkTimer);
    walkTimer = null;
    walkTarget = null;
  }

  function walkTo(target) {
    if (!alive()) return;
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
        const ny = placement.stepToward(cy, walkTarget.y, FALL_PX_PER_TICK);
        win.setPosition(Math.round(nx), Math.round(ny));
        const [ax, ay] = win.getPosition();
        // Arrived, or the window didn't move at all (blocked): stop either way.
        const reached = nx === walkTarget.x && ny === walkTarget.y;
        if (reached || (ax === cx && ay === cy)) {
          stopWalking();
          recordPosition({ immediate: false });
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
    size = placement.windowSize(settings.miniMeScale);
    const pos = placement.restorePosition(settings.miniMePosition, placementDisplays(), screen.getPrimaryDisplay().id, size);
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
      focusable: false,
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
    win.setIgnoreMouseEvents(true, { forward: true });

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
    const accel = typeof settings.miniMeHotkey === 'string' ? settings.miniMeHotkey.trim() : '';
    if (!accel || !settings.miniMeEnabled) return;
    if (isReservedHotkey(accel)) {
      hotkeyOk = false; // Marven's own Listen shortcut
      return;
    }
    try {
      hotkeyOk = globalShortcut.register(accel, openInput);
    } catch {
      hotkeyOk = false;
    }
    if (hotkeyOk) hotkey = accel;
  }

  // ── IPC from the companion page only ────────────────────────────────────────
  const fromCompanion = (event) => alive() && event.sender === win.webContents;

  ipcMain.handle('companion:get-settings', (event) => (fromCompanion(event) ? rendererSettings() : null));
  ipcMain.on('companion:set-interactive', (event, on) => {
    if (fromCompanion(event)) win.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on('companion:set-focusable', (event, on) => {
    if (!fromCompanion(event)) return;
    win.setFocusable(!!on);
    if (on) win.focus();
    else win.blur();
  });
  ipcMain.on('companion:walk-to', (event, x) => {
    if (!fromCompanion(event) || typeof x !== 'number' || !Number.isFinite(x)) return;
    const [, y] = win.getPosition();
    const strip = placement.dockStrip(currentDisplay().workArea, size);
    walkTo({ x: Math.round(Math.min(Math.max(x, strip.minX), strip.maxX)), y });
  });
  ipcMain.on('companion:stop', (event) => {
    if (!fromCompanion(event)) return;
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
    win.setPosition(c.x, onDock ? placement.dockStrip(display.workArea, size).y : c.y);
    recordPosition({ immediate: true });
    sendPosition({ dropped: true });
  });
  ipcMain.on('companion:return-home', (event) => {
    if (!fromCompanion(event)) return;
    const [x] = win.getPosition();
    const strip = placement.dockStrip(currentDisplay().workArea, size);
    walkTo({ x: Math.min(Math.max(x, strip.minX), strip.maxX), y: strip.y, dock: true });
  });

  screen.on('display-added', reclamp);
  screen.on('display-removed', reclamp);
  screen.on('display-metrics-changed', reclamp);

  /** Apply the full settings object (call on launch and after every save). */
  function applySettings(next) {
    const prev = settings;
    settings = { ...next };
    // A not-yet-saved position is newer than whatever the caller loaded from disk.
    if (savePending && prev.miniMePosition) settings.miniMePosition = prev.miniMePosition;
    const enabled = !!settings.miniMeEnabled;
    if (!enabled) unavailable = false;
    if (enabled && !alive()) {
      unavailable = false;
      create();
    } else if (!enabled && alive()) {
      destroy();
    } else if (alive() && settings.miniMeScale !== prev.miniMeScale) {
      // Keep the feet where they are: the window grows or shrinks upwards.
      const oldHeight = size.height;
      size = placement.windowSize(settings.miniMeScale);
      const [x, y] = win.getPosition();
      stopWalking();
      win.setBounds({ x, y: y + oldHeight - size.height, ...size });
      reclamp();
    }
    if (enabled !== !!prev.miniMeEnabled || settings.miniMeHotkey !== prev.miniMeHotkey) registerHotkey();
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
