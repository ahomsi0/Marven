const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain, session, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { exec } = require('child_process');
const net  = require('net');
const fs   = require('fs');
const path = require('path');

const isDev = !app.isPackaged;

// Fix PATH for GUI-launched apps. When users launch Marven from Finder/Dock,
// Electron inherits a minimal PATH that's missing /opt/homebrew/bin, /usr/local/bin,
// nvm dirs, etc. — so `npm`, `node`, `yarn`, etc. aren't found and the agent's
// run_command fails to start dev servers. fix-path queries the user's login
// shell for the real PATH and merges it into process.env.PATH.
try {
  const fixPath = require('fix-path');
  // Default export shape — fix-path v5 returns a function
  if (typeof fixPath === 'function') fixPath();
  else if (typeof fixPath.default === 'function') fixPath.default();
} catch (err) {
  console.warn('[Marven] fix-path failed (continuing with raw PATH):', err && err.message);
}

// Also splice in common Homebrew / nvm paths defensively, in case fix-path
// missed something or the shell config doesn't expose them.
{
  const extras = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    path.join(process.env.HOME || '', '.nvm/current/bin'),
    path.join(process.env.HOME || '', '.volta/bin'),
    path.join(process.env.HOME || '', '.bun/bin'),
    path.join(process.env.HOME || '', '.cargo/bin'),
  ].filter(Boolean);
  const have = (process.env.PATH || '').split(':');
  const merged = [...have];
  for (const p of extras) if (p && !have.includes(p)) merged.push(p);
  process.env.PATH = merged.join(':');
}

function waitForPort(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    function attempt() {
      const sock = net.createConnection({ port, host: '127.0.0.1' });
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() < deadline) setTimeout(attempt, 200);
        else resolve(false);
      });
    }
    attempt();
  });
}

function startNextServer() {
  if (isDev) return Promise.resolve();
  const serverDir = path.join(process.resourcesPath, 'nextjs-server');
  const serverScript = path.join(serverDir, 'server.js');

  if (!fs.existsSync(serverScript)) {
    dialog.showErrorBox('Startup Error', `Server not found:\n${serverScript}`);
    return Promise.reject(new Error('Server not found'));
  }

  // Run the Next.js standalone server inside the Electron main process.
  // This avoids spawning an unsigned child binary (which macOS blocks on arm64).
  const PORT = 47891;
  process.env.PORT = String(PORT);
  process.env.HOSTNAME = '127.0.0.1';
  process.env.NODE_ENV = 'production';

  setImmediate(() => {
    try {
      require(serverScript);
    } catch (err) {
      console.error('[Marven] Server failed to start:', err.message);
    }
  });

  return waitForPort(PORT);
}

// ── Load icons from buffer (more reliable than createFromPath with spaces in path) ──
function loadIcon(filename, scaleFactor = 1) {
  try {
    const buf = fs.readFileSync(path.join(__dirname, 'assets', filename));
    return nativeImage.createFromBuffer(buf, { scaleFactor });
  } catch {
    return nativeImage.createEmpty();
  }
}

const APP_ICON  = loadIcon('icon.png', 2);   // 512×512 dark background (@2x)
const TRAY_ICON = loadIcon('tray.png', 2);   // 44×44 → rendered at 22×22 on Retina

// ── Required for Web Speech API (SpeechRecognition) in Electron ────────────────
app.commandLine.appendSwitch('enable-features', 'WebSpeechAPI');
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess');
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', 'http://localhost:3000');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// ── Persistent settings (userData/settings.json) ─────────────────────────────
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const p = settingsPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {}
  return {};
}

function persistSettings(settings) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[Marven] Could not write settings:', err.message);
  }
}

function applySettings(settings) {
  if (settings.groqApiKey)       process.env.GROQ_API_KEY        = settings.groqApiKey;
  if (settings.ollamaUrl)        process.env.OLLAMA_URL          = settings.ollamaUrl;
  if (settings.nimApiKey)        process.env.NIM_API_KEY         = settings.nimApiKey;
  if (settings.openrouterApiKey) process.env.OPENROUTER_API_KEY  = settings.openrouterApiKey;
  if (settings.openaiApiKey)     process.env.OPENAI_API_KEY      = settings.openaiApiKey;
  if (settings.anthropicApiKey)  process.env.ANTHROPIC_API_KEY   = settings.anthropicApiKey;
}

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (_, settings) => {
  persistSettings(settings);
  applySettings(settings);
  return true;
});
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('check-for-updates', () => {
  if (isDev) return { status: 'dev' };
  autoUpdater.checkForUpdates();
  return { status: 'checking' };
});
ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall();
});

// ── Tray icon — dedicated transparent PNG, set as template so macOS renders
//    it correctly in both light and dark menu bars ─────────────────────────────
function buildTrayIcon() {
  const img = TRAY_ICON.isEmpty() ? APP_ICON.resize({ width: 22, height: 22 }) : TRAY_ICON;
  img.setTemplateImage(true);
  return img;
}

function createWindow() {
  const windowOptions = {
    width: 1300,
    height: 880,
    minWidth: 900,
    minHeight: 640,
    frame: false,
    backgroundColor: '#1a1a1a',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  };

  // macOS-specific options
  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hidden';
    windowOptions.trafficLightPosition = { x: 16, y: 16 };
    windowOptions.vibrancy = 'under-window';
    windowOptions.visualEffectState = 'active';
  }

  if (!APP_ICON.isEmpty()) windowOptions.icon = APP_ICON;
  mainWindow = new BrowserWindow(windowOptions);

  const appPort = isDev ? 3000 : 47891;
  mainWindow.loadURL(`http://localhost:${appPort}`);

  // Retry if server wasn't ready yet
  mainWindow.webContents.on('did-fail-load', () => {
    setTimeout(() => mainWindow.loadURL(`http://localhost:${appPort}`), 1500);
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Auto-grant microphone so SpeechRecognition (wake word) works.
  // Both handlers are required — check fires before request.
  mainWindow.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media' || permission === 'microphone';
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone');
  });

  // Prime getUserMedia so Chromium's speech engine has an active mic grant
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(s => { s.getTracks().forEach(t => t.stop()); })
        .catch(() => {});
    `).catch(() => {});
  });

  // On macOS: hide to menu bar when closed. On Windows/Linux: quit.
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function triggerVoice() {
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('trigger-voice');
}

function createTray() {
  try {
    const icon = buildTrayIcon();
    tray = new Tray(icon);
  } catch (err) {
    console.warn('[Marven] Could not create tray icon, falling back:', err.message);
    tray = new Tray(nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    ));
  }

  tray.setToolTip('Marven — right-click for options');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show Marven',
      click() { mainWindow.show(); mainWindow.focus(); },
    },
    {
      label: 'Listen  (Cmd+Shift+M)',
      click() { triggerVoice(); },
    },
    { type: 'separator' },
    {
      label: 'Quit Marven',
      click() { isQuitting = true; app.quit(); },
    },
  ]);

  tray.setContextMenu(menu);

  tray.on('click', () => {
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── IPC window controls ───────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (!mainWindow) return;
  if (process.platform === 'darwin') {
    mainWindow.hide();
  } else {
    isQuitting = true;
    app.quit();
  }
});

ipcMain.handle('open-external', async (_event, url, browser) => {
  if (!browser || browser === 'default') {
    return shell.openExternal(url);
  }
  const appName = {
    chrome: 'Google Chrome',
    firefox: 'Firefox',
    safari: 'Safari',
    edge: 'Microsoft Edge',
    arc: 'Arc',
  }[browser];
  if (!appName) return shell.openExternal(url);
  return new Promise((resolve) => {
    exec(`open -a "${appName}" ${JSON.stringify(url)}`, (err) => {
      if (err) {
        shell.openExternal(url).finally(resolve);
      } else {
        resolve();
      }
    });
  });
});

ipcMain.handle('dialog-open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

app.whenReady().then(async () => {
  applySettings(loadSettings());
  await startNextServer();
  // Set custom dock icon on macOS
  if (process.platform === 'darwin' && !APP_ICON.isEmpty()) {
    app.dock.setIcon(APP_ICON);
  }

  createWindow();
  createTray();

  if (!isDev) {
    autoUpdater.autoDownload = true;

    autoUpdater.on('update-available', (info) => {
      if (mainWindow) mainWindow.webContents.send('update-status', { type: 'available', version: info.version });
    });

    autoUpdater.on('download-progress', (progress) => {
      if (mainWindow) mainWindow.webContents.send('update-status', {
        type: 'progress',
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      if (mainWindow) mainWindow.webContents.send('update-status', { type: 'ready', version: info.version });
    });

    autoUpdater.on('update-not-available', () => {
      if (mainWindow) mainWindow.webContents.send('update-status', { type: 'up-to-date' });
    });

    autoUpdater.on('error', (err) => {
      console.error('[Marven] Auto-updater error:', err.message);
      if (mainWindow) mainWindow.webContents.send('update-status', { type: 'error', message: err.message });
    });

    autoUpdater.checkForUpdates();
  }

  // Fix for Web Speech API: Google's speech service checks the Origin header.
  // In Electron, requests may not carry a proper Origin. Inject it so
  // wss://www.google.com/speech-api accepts them.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.google.com/*', 'wss://www.google.com/*'] },
    (details, callback) => {
      details.requestHeaders['Origin'] = 'http://localhost:3000';
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  const ok = globalShortcut.register('CommandOrControl+Shift+M', () => {
    triggerVoice();
  });

  if (!ok) {
    console.warn('[Marven] Global shortcut Cmd+Shift+M could not be registered.');
    console.warn('[Marven] Another app may already own this shortcut.');
  } else {
    console.log('[Marven] Global shortcut registered: Cmd+Shift+M');
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});
