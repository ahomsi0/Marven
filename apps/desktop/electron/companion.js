// electron/companion.js
//
// The Mini Me companion: a small transparent, always-on-top window showing
// the /companion page. The main process owns its position: walking, dragging,
// keeping it on screen and remembering where it was. Geometry lives in
// companionPlacement.js.

const { BrowserWindow, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const placement = require('./companionPlacement');

const TICK_MS = 33;
const WALK_PX_PER_TICK = 2;
const FALL_PX_PER_TICK = 8;
const MAX_LOAD_RETRIES = 20;

function placementDisplays() {
  return screen.getAllDisplays().map((d) => ({ id: d.id, workArea: d.workArea }));
}

/**
 * @param {{
 *   appPort: number,
 *   saveSettings: (patch: object) => object,
 *   onStatusChange?: (status: { visible: boolean, hotkeyOk: boolean, unavailable: boolean, wakeWord: boolean }) => void,
 * }} options
 */
function createCompanion({ appPort, saveSettings, onStatusChange }) {
  let win = null;
  let settings = {};
  let size = placement.windowSize(3);
  let walkTarget = null;
  let walkTimer = null;
  let facing = 1;
  let hotkey = null;
  let hotkeyOk = true;
  let unavailable = false;
  const url = `http://localhost:${appPort}/companion`;

  const alive = () => !!win && !win.isDestroyed();
  const status = () => ({
    visible: alive() && win.isVisible(),
    hotkeyOk,
    unavailable,
    wakeWord: !!settings.miniMeWakeWord,
  });
  const notify = () => { if (onStatusChange) onStatusChange(status()); };

  const rendererSettings = () => ({
    speak: settings.miniMeSpeak !== false,
    scale: [2, 3, 4].includes(settings.miniMeScale) ? settings.miniMeScale : 3,
    walk: settings.miniMeWalk !== false,
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

  function savePosition() {
    if (!alive()) return;
    const [x, y] = win.getPosition();
    const miniMePosition = { x, y, displayId: currentDisplay().id };
    saveSettings({ miniMePosition });
    settings = { ...settings, miniMePosition };
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
    walkTarget = target;
    if (!walkTimer) {
      walkTimer = setInterval(() => {
        if (!alive() || !walkTarget) return stopWalking();
        const [cx, cy] = win.getPosition();
        const nx = placement.stepToward(cx, walkTarget.x, WALK_PX_PER_TICK);
        const ny = placement.stepToward(cy, walkTarget.y, FALL_PX_PER_TICK);
        win.setPosition(Math.round(nx), Math.round(ny));
        if (nx === walkTarget.x && ny === walkTarget.y) {
          stopWalking();
          savePosition();
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
    if (c.x !== x || c.y !== y) {
      stopWalking();
      win.setPosition(c.x, c.y);
    }
    sendPosition();
  }

  function create() {
    size = placement.windowSize(settings.miniMeScale);
    const pos = placement.restorePosition(settings.miniMePosition, placementDisplays(), screen.getPrimaryDisplay().id, size);
    win = new BrowserWindow({
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
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    win.setIgnoreMouseEvents(true, { forward: true });

    win.once('ready-to-show', () => {
      if (!alive()) return;
      win.showInactive();
      notify();
    });
    win.webContents.on('did-finish-load', () => sendPosition());

    // Same capped, non-overlapping retry as the main window.
    let retries = 0;
    let retryTimer = null;
    win.webContents.on('did-fail-load', (_event, _code, _desc, _url, isMainFrame) => {
      if (!isMainFrame || !alive()) return;
      if (retries >= MAX_LOAD_RETRIES) {
        unavailable = true;
        win.hide();
        notify();
        return;
      }
      retries++;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (alive()) win.loadURL(url);
      }, 1500);
    });
    win.webContents.on('render-process-gone', () => {
      unavailable = true;
      destroy();
    });
    win.on('closed', () => {
      stopWalking();
      win = null;
      notify();
    });
    win.loadURL(url);
  }

  function destroy() {
    stopWalking();
    if (alive()) win.destroy();
    win = null;
    notify();
  }

  function openInput() {
    if (!alive()) return;
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
    if (!fromCompanion(event) || typeof dx !== 'number' || typeof dy !== 'number') return;
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
    savePosition();
    sendPosition();
  });
  ipcMain.on('companion:return-home', (event) => {
    if (!fromCompanion(event)) return;
    const [x] = win.getPosition();
    const strip = placement.dockStrip(currentDisplay().workArea, size);
    walkTo({ x: Math.min(Math.max(x, strip.minX), strip.maxX), y: strip.y });
  });

  screen.on('display-added', reclamp);
  screen.on('display-removed', reclamp);
  screen.on('display-metrics-changed', reclamp);

  /** Apply the full settings object (call on launch and after every save). */
  function applySettings(next) {
    const prev = settings;
    settings = { ...next };
    const enabled = !!settings.miniMeEnabled;
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
