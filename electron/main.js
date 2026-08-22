const { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage, ipcMain, session, dialog, shell, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const { execFile } = require('child_process');
const net  = require('net');
const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sanitizedEnv } = require('./envSanitize');

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

function waitForHealth(port, healthToken, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    function attempt() {
      const req = http.get({
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        timeout: 1000,
        headers: { 'x-marven-health-token': healthToken },
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200 && /"service"\s*:\s*"marven"/.test(body)) {
            resolve(true);
          } else if (Date.now() < deadline) {
            setTimeout(attempt, 200);
          } else {
            resolve(false);
          }
        });
      });
      req.on('error', () => {
        if (Date.now() < deadline) setTimeout(attempt, 200);
        else resolve(false);
      });
      req.on('timeout', () => req.destroy());
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
  const healthToken = crypto.randomBytes(32).toString('hex');
  process.env.PORT = String(PORT);
  process.env.HOSTNAME = '127.0.0.1';
  process.env.NODE_ENV = 'production';
  process.env.MARVEN_HEALTH_TOKEN = healthToken;
  // Lets the embedded API server read persisted settings (e.g. the agent
  // safety profile) from the same file the main process manages.
  process.env.MARVEN_USER_DATA = app.getPath('userData');

  const loadServer = new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        require(serverScript);
        resolve();
      } catch (err) {
        console.error('[Marven] Server failed to start:', err.message);
        reject(err);
      }
    });
  });

  return Promise.all([loadServer, waitForHealth(PORT, healthToken)])
    .then(([, healthy]) => {
      if (!healthy) throw new Error('Server health check failed');
      return true;
    })
    .catch((err) => {
      dialog.showErrorBox('Startup Error', `The local Marven server could not be verified.\n${err instanceof Error ? err.message : String(err)}`);
      throw err;
    });
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
let updateReady = false;

// ── Persistent settings (userData/settings.json) ─────────────────────────────
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

// Default values applied for keys missing from the user's settings.json.
// New settings (e.g. inline-completion knobs) live alongside existing flags
// like `liteAgentMode` and `codebaseIndexEnabled`.
const SETTINGS_DEFAULTS = {
  inlineCompletionsEnabled: false,
  inlineCompletionProvider: 'ollama',
  inlineCompletionModel: '',
  inlineCompletionDebounceMs: 350,
  agentAutoVerifyEnabled: false,
  agentAutoVerifyCommands: '',
  voiceTtsProvider: 'system',
  elevenLabsVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
  elevenLabsModel: 'eleven_flash_v2_5',
  agentSafetyProfile: 'ask-before-write',
  agentModelFallbacks: [],
  workspaceTrustRequired: true,
  indexExcludePatterns: '',
};

const SECRET_SETTING_KEYS = [
  'groqApiKey',
  'nimApiKey',
  'openrouterApiKey',
  'openaiApiKey',
  'anthropicApiKey',
  'elevenLabsApiKey',
];
const MASKED_SECRET = '••••••••';

function canEncryptSettings() {
  try {
    return !!safeStorage && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptSetting(value) {
  if (!value) return '';
  if (!canEncryptSettings()) return value;
  try {
    return `enc:v1:${safeStorage.encryptString(value).toString('base64')}`;
  } catch (err) {
    console.warn('[Marven] Could not encrypt a secret setting; using protected file fallback:', err && err.message);
    return value;
  }
}

function decryptSetting(value) {
  if (!value || typeof value !== 'string') return '';
  if (!value.startsWith('enc:v1:')) return value;
  if (!canEncryptSettings()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(value.slice('enc:v1:'.length), 'base64'));
  } catch (err) {
    console.error('[Marven] Could not decrypt a stored secret setting:', err && err.message);
    return '';
  }
}

function readStoredSettings() {
  try {
    const p = settingsPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch (err) {
    console.warn('[Marven] Could not read settings:', err && err.message);
  }
  return {};
}

function writeStoredSettings(settings) {
  try {
    const p = settingsPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(settings, null, 2), { mode: 0o600 });
    try { fs.chmodSync(p, 0o600); } catch {}
  } catch (err) {
    console.error('[Marven] Could not write settings:', err.message);
  }
}

function loadSettings() {
  const stored = readStoredSettings();
  const settings = { ...SETTINGS_DEFAULTS, ...stored };
  let migrated = false;
  for (const key of SECRET_SETTING_KEYS) {
    const raw = stored[key];
    settings[key] = decryptSetting(raw);
    // Migrate legacy plaintext settings as soon as Electron's secure storage
    // becomes available. The renderer never needs the decrypted value.
    if (raw && typeof raw === 'string' && !raw.startsWith('enc:v1:') && canEncryptSettings()) {
      stored[key] = encryptSetting(raw);
      migrated = true;
    }
  }
  if (migrated) writeStoredSettings({ ...stored, ...Object.fromEntries(SECRET_SETTING_KEYS.map((key) => [key, stored[key]])) });
  return settings;
}

function persistSettings(settings) {
  const current = loadSettings();
  const next = { ...current, ...(settings && typeof settings === 'object' ? settings : {}) };
  const stored = { ...next };
  for (const key of SECRET_SETTING_KEYS) {
    const incoming = settings && typeof settings[key] === 'string' ? settings[key].trim() : undefined;
    const value = incoming === undefined || incoming === MASKED_SECRET ? current[key] : incoming;
    next[key] = value || '';
    stored[key] = encryptSetting(next[key]);
  }
  writeStoredSettings(stored);
  return next;
}

function publicSettings(settings) {
  const result = { ...settings };
  for (const key of SECRET_SETTING_KEYS) {
    const configured = typeof settings[key] === 'string' && settings[key].length > 0;
    result[key] = configured ? MASKED_SECRET : '';
    result[`${key}Configured`] = configured;
  }
  result.settingsSecretsEncrypted = canEncryptSettings();
  return result;
}

function applySettings(settings) {
  const setEnv = (name, value) => {
    const trimmed = typeof value === 'string' ? value.trim() : value;
    if (trimmed) process.env[name] = String(trimmed);
    else delete process.env[name];
  };
  setEnv('GROQ_API_KEY', settings.groqApiKey);
  setEnv('OLLAMA_URL', settings.ollamaUrl);
  setEnv('NIM_API_KEY', settings.nimApiKey);
  setEnv('OPENROUTER_API_KEY', settings.openrouterApiKey);
  setEnv('OPENAI_API_KEY', settings.openaiApiKey);
  setEnv('ANTHROPIC_API_KEY', settings.anthropicApiKey);
  setEnv('LM_STUDIO_URL', settings.lmStudioUrl);
  setEnv('LLAMA_SERVER_URL', settings.llamaServerUrl);
  setEnv('ELEVENLABS_API_KEY', settings.elevenLabsApiKey);
  setEnv('ELEVENLABS_TTS_PROVIDER', settings.voiceTtsProvider);
  setEnv('ELEVENLABS_VOICE_ID', settings.elevenLabsVoiceId);
  setEnv('ELEVENLABS_MODEL', settings.elevenLabsModel);
}

ipcMain.handle('get-settings', () => publicSettings(loadSettings()));
ipcMain.handle('save-settings', (_, settings) => {
  const next = persistSettings(settings);
  applySettings(next);
  return publicSettings(next);
});
ipcMain.handle('get-version', () => app.getVersion());
ipcMain.handle('check-for-updates', () => {
  if (isDev) return { status: 'dev' };
  autoUpdater.checkForUpdates();
  return { status: 'checking' };
});
ipcMain.handle('install-update', () => {
  if (!updateReady) return { ok: false, error: 'No verified update is ready.' };
  autoUpdater.quitAndInstall();
  return { ok: true };
});

// ── LSP (Language Server Protocol) ───────────────────────────────────────────
const { LspManager } = require('./lsp/lspManager');
const lspManager = new LspManager();

function broadcastToAllWindows(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

lspManager.on('notification', (n) => broadcastToAllWindows('lsp-notification', n));
lspManager.on('install-status', (s) => broadcastToAllWindows('lsp-status', { kind: 'install', ...s }));
lspManager.on('server-exit', (e) => broadcastToAllWindows('lsp-status', { kind: 'server-exit', ...e }));
lspManager.on('stderr', (s) => broadcastToAllWindows('lsp-status', { kind: 'stderr', ...s }));

ipcMain.handle('lsp-ensure', async (_event, languageId) => {
  return lspManager.ensure(languageId);
});

ipcMain.handle('lsp-open-session', async (_event, opts) => {
  return lspManager.openSession(opts);
});

ipcMain.handle('lsp-close-session', async (_event, sessionId) => {
  await lspManager.closeSession(sessionId);
  return { ok: true };
});

ipcMain.on('lsp-did-change', (_event, { sessionId, payload }) => {
  try { lspManager.didChange(sessionId, payload); }
  catch (err) { console.error('[Marven] lsp didChange:', err && err.message); }
});

ipcMain.handle('lsp-request', async (_event, { sessionId, method, params }) => {
  try {
    return { ok: true, result: await lspManager.request(sessionId, method, params) };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

// ── Codebase Indexing ────────────────────────────────────────────────────────
// Moved out of Electron main into Next.js API routes under /api/index/*.
// Electron main cannot dynamically import the TypeScript modules under
// `lib/index/` at runtime, so the previous IndexerHost silently failed in
// production. The renderer now talks to the routes directly via
// `lib/index/client.ts`. See `app/api/index/` for the new server.

ipcMain.handle('lsp-restart', async (_event, languageId) => {
  return lspManager.restart(languageId);
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
      sandbox: true,
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

  // Retry if server wasn't ready yet — capped, and never overlapping: an
  // uncapped loop would retry forever (and double-fire) if the embedded
  // server is permanently broken.
  let loadRetries = 0;
  let loadRetryTimer = null;
  const MAX_LOAD_RETRIES = 20;
  mainWindow.webContents.on('did-fail-load', (_event, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    if (loadRetries >= MAX_LOAD_RETRIES) {
      console.error('[Marven] Giving up loading the app UI after', loadRetries, 'attempts (last error', code, desc, ')');
      return;
    }
    loadRetries++;
    if (loadRetryTimer) clearTimeout(loadRetryTimer);
    loadRetryTimer = setTimeout(() => {
      loadRetryTimer = null;
      mainWindow.loadURL(`http://localhost:${appPort}`);
    }, 1500);
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Block any navigation that would take the main window away from localhost,
  // and prevent file:// URLs from opening in the system browser. External
  // http/https links are handled explicitly via the open-external IPC handler.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Compare full origins, not a string prefix: startsWith('http://localhost:47891')
    // would also accept http://localhost:47891.evil.com/ and http://localhost:478919/.
    const appUrl = `http://localhost:${appPort}`;
    let sameOrigin = false;
    try {
      sameOrigin = new URL(url).origin === appUrl;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow DevTools to open normally; block everything else from spawning a new window.
    if (url.startsWith('devtools://')) return { action: 'allow' };
    return { action: 'deny' };
  });

  // Frameless windows skip the default menu, so ⌥⌘I/F12 aren't wired. Bind
  // them explicitly so DevTools is reachable for debugging.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;
    const isToggleDevTools =
      (input.key === 'I' && input.alt && (input.meta || input.control)) ||
      input.key === 'F12';
    if (isToggleDevTools) mainWindow.webContents.toggleDevTools();
  });

  // Auto-grant microphone so SpeechRecognition (wake word) works — but ONLY for
  // our own app origin, not for any other content that might end up loaded.
  // Both handlers are required — check fires before request.
  const appOrigin = `http://localhost:${appPort}`;
  const originOf = (value) => {
    try { return new URL(value).origin; } catch { return ''; }
  };
  const isMicPermission = (permission) => permission === 'media' || permission === 'microphone';
  mainWindow.webContents.session.setPermissionCheckHandler((wc, permission, requestingOrigin) => {
    const origin = requestingOrigin || (wc ? originOf(wc.getURL()) : '');
    return isMicPermission(permission) && origin === appOrigin;
  });
  mainWindow.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = originOf((details && details.requestingUrl) || (wc ? wc.getURL() : ''));
    callback(isMicPermission(permission) && origin === appOrigin);
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

function isAllowedExternalUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return false;
  const trimmed = urlString.trim();
  if (!trimmed) return false;
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return false;
  }
  const ok = ['http:', 'https:', 'mailto:'].includes(u.protocol);
  if (!ok) return false;
  return true;
}

ipcMain.handle('open-external', async (_event, url, browser) => {
  if (!isAllowedExternalUrl(url)) {
    console.warn('[Marven] open-external: invalid or disallowed URL:', url);
    return { ok: false, error: 'invalid-url' };
  }
  const trimmed = String(url).trim();
  if (!browser || browser === 'default') {
    await shell.openExternal(trimmed);
    return { ok: true };
  }
  const appName = {
    chrome: 'Google Chrome',
    firefox: 'Firefox',
    safari: 'Safari',
    edge: 'Microsoft Edge',
    arc: 'Arc',
  }[browser];
  if (!appName) {
    await shell.openExternal(trimmed);
    return { ok: true };
  }
  return new Promise((resolve) => {
    // Use execFile with an argument array (no shell) so the URL can never be
    // interpreted as shell syntax. Passing the URL through a shell string would
    // let `$(...)`, backticks, or `$VAR` in the URL execute as commands.
    execFile('open', ['-a', appName, trimmed], (err) => {
      if (err) {
        shell.openExternal(trimmed).finally(() => resolve({ ok: true }));
      } else {
        resolve({ ok: true });
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

// ── Workspace file watcher (external edits → renderer refresh) ───────────────
let workspaceFileWatcher = null;
let workspaceWatcherRoot = null;

function broadcastWorkspaceFileEvent(relPath) {
  const payload = { root: workspaceWatcherRoot, relPath };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('marven-workspace-file-event', payload);
  }
}

ipcMain.handle('marven-workspace-watch', async (_event, rootPath) => {
  if (workspaceFileWatcher) {
    try { workspaceFileWatcher.close(); } catch {}
    workspaceFileWatcher = null;
    workspaceWatcherRoot = null;
  }
  if (!rootPath || typeof rootPath !== 'string') return { ok: true };
  let resolved;
  try {
    resolved = path.resolve(rootPath);
    if (!fs.existsSync(resolved)) return { ok: false, error: 'root-not-found' };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
  workspaceWatcherRoot = resolved;

  const tryWatch = (recursive) => {
    return fs.watch(resolved, recursive ? { recursive: true } : {}, (_ev, fname) => {
      if (!fname || typeof fname !== 'string') return;
      const rel = fname.split(path.sep).join('/');
      broadcastWorkspaceFileEvent(rel);
    });
  };

  try {
    // Prefer recursive watch (macOS / Windows). Linux often rejects recursive.
    workspaceFileWatcher = tryWatch(process.platform !== 'linux');
  } catch (err) {
    if (process.platform === 'linux') {
      try {
        workspaceFileWatcher = tryWatch(false);
      } catch (err2) {
        workspaceWatcherRoot = null;
        return { ok: false, error: String(err2 && err2.message || err2) };
      }
    } else {
      workspaceWatcherRoot = null;
      return { ok: false, error: String(err && err.message || err) };
    }
  }
  return { ok: true };
});

ipcMain.handle('marven-workspace-watch-stop', () => {
  if (workspaceFileWatcher) {
    try { workspaceFileWatcher.close(); } catch {}
    workspaceFileWatcher = null;
    workspaceWatcherRoot = null;
  }
  return { ok: true };
});

// ── Interactive terminal (node-pty) ───────────────────────────────────────────
// One PTY per `id`. The renderer derives a stable id from the workspace path
// so switching conversations within the same workspace reuses the PTY, and
// switching workspaces spawns a fresh shell. Lazy-require node-pty so a broken
// native binding only surfaces when the user actually opens the terminal.
let _pty = null;
function getPty() {
  if (_pty) return _pty;
  try {
    _pty = require('node-pty');
  } catch (err) {
    console.error('[Marven] node-pty failed to load:', err && err.message);
    _pty = null;
  }
  return _pty;
}

const ptys = new Map(); // id → { pty, buffer, lastActive }

// Keep at most this many background shells alive. Remounting the terminal UI
// (panel toggle, workspace switch) no longer kills the session, so without a
// cap, PTYs would accumulate across workspaces for the lifetime of the app.
const MAX_LIVE_PTYS = 6;
const PTY_BUFFER_LIMIT = 64 * 1024;

function evictOldestPty() {
  if (ptys.size <= MAX_LIVE_PTYS) return;
  let oldestId = null;
  let oldestTs = Infinity;
  for (const [id, entry] of ptys) {
    if (entry.lastActive < oldestTs) {
      oldestTs = entry.lastActive;
      oldestId = id;
    }
  }
  if (oldestId) {
    try { ptys.get(oldestId).pty.kill(); } catch {}
    ptys.delete(oldestId);
  }
}

ipcMain.handle('pty-start', (event, args) => {
  const { id, cwd, cols, rows } = args || {};
  if (!id) return { ok: false, error: 'missing-id' };
  const pty = getPty();
  if (!pty) return { ok: false, error: 'node-pty-unavailable' };

  // Reuse a live shell for the same id instead of killing it: remounting the
  // terminal UI (collapsing the panel, switching to Problems and back) must
  // not terminate running processes or reset the session.
  const existing = ptys.get(id);
  if (existing) {
    existing.lastActive = Date.now();
    // Replay recent output so the fresh xterm instance has context.
    if (!event.sender.isDestroyed() && existing.buffer) {
      event.sender.send('pty-data', { id, data: existing.buffer });
    }
    return { ok: true, reused: true };
  }
  evictOldestPty();

  // Pick a shell that actually exists on disk. $SHELL can point at a binary
  // that's been uninstalled or moved (e.g. fish removed via brew, bash path
  // changed) — passing that to pty.spawn surfaces as the opaque "posix_spawnp
  // failed." Walk a fallback chain and use the first one that's present.
  const shellCandidates = process.platform === 'win32'
    ? ['powershell.exe', 'cmd.exe']
    : [process.env.SHELL, '/bin/zsh', '/bin/bash', '/bin/sh'].filter(Boolean);
  let shell = null;
  for (const candidate of shellCandidates) {
    try {
      if (process.platform === 'win32' || fs.existsSync(candidate)) { shell = candidate; break; }
    } catch { /* keep looking */ }
  }
  if (!shell) {
    return { ok: false, error: `no usable shell found (tried: ${shellCandidates.join(', ')})` };
  }

  // Resolve cwd defensively — fall back to HOME if the path doesn't exist
  // (e.g. workspace was deleted while Marven was closed).
  let resolvedCwd = cwd && typeof cwd === 'string' ? cwd : process.env.HOME;
  try {
    if (!fs.existsSync(resolvedCwd)) resolvedCwd = process.env.HOME;
  } catch {
    resolvedCwd = process.env.HOME;
  }

  // Launch as a login shell on Unix — what Terminal.app/iTerm2 do. Without
  // this, zsh launched from an Electron subprocess on macOS sometimes decides
  // it's non-interactive and exits cleanly (exitCode 0) the moment it starts,
  // which leaves the user with a "shell that won't echo." -l also makes the
  // shell source /etc/zprofile and ~/.zprofile so PATH and other login-time
  // env vars are set correctly inside the PTY.
  const shellArgs = process.platform === 'win32' ? [] : ['-l'];

  try {
    const p = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: Math.max(20, Math.floor(cols || 80)),
      rows: Math.max(5, Math.floor(rows || 24)),
      cwd: resolvedCwd,
      env: sanitizedEnv({ TERM: 'xterm-256color' }),
    });
    const entry = { pty: p, buffer: '', lastActive: Date.now() };
    ptys.set(id, entry);
    p.onData((data) => {
      entry.lastActive = Date.now();
      // Ring buffer so a remounted terminal can replay what it missed.
      entry.buffer += data;
      if (entry.buffer.length > PTY_BUFFER_LIMIT) {
        entry.buffer = entry.buffer.slice(-PTY_BUFFER_LIMIT);
      }
      // Renderer may have been destroyed (window close, navigation). Guard.
      if (event.sender.isDestroyed()) return;
      event.sender.send('pty-data', { id, data });
    });
    p.onExit(({ exitCode }) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('pty-exit', { id, exitCode });
      }
      // Identity check: kill() delivers SIGHUP asynchronously, so the
      // OLD pty's exit can fire after a replacement was registered under the
      // same id. Only remove the registry entry that belongs to this process,
      // otherwise the new shell becomes unreachable and leaks.
      if (ptys.get(id)?.pty === p) {
        ptys.delete(id);
      }
    });
    return { ok: true };
  } catch (err) {
    console.error('[Marven] pty.spawn failed:', err && err.message, 'shell=', shell, 'cwd=', resolvedCwd);
    return { ok: false, error: `${err && err.message || err} (shell: ${shell}, cwd: ${resolvedCwd || '<unset>'})` };
  }
});

ipcMain.on('pty-write', (_e, args) => {
  const { id, data } = args || {};
  const entry = ptys.get(id);
  if (!entry) {
    console.warn('[Marven] pty-write: no PTY for id', id, '(known ids:', [...ptys.keys()], ')');
    return;
  }
  entry.lastActive = Date.now();
  try { entry.pty.write(data); } catch (err) { console.error('[Marven] pty.write failed:', err && err.message); }
});

ipcMain.on('pty-resize', (_e, args) => {
  const { id, cols, rows } = args || {};
  const entry = ptys.get(id);
  if (!entry) return;
  try {
    entry.pty.resize(Math.max(20, Math.floor(cols || 80)), Math.max(5, Math.floor(rows || 24)));
  } catch {}
});

ipcMain.on('pty-kill', (_e, args) => {
  const { id } = args || {};
  const entry = ptys.get(id);
  if (!entry) return;
  try { entry.pty.kill(); } catch {}
  ptys.delete(id);
});

// Cleanup all PTYs on quit so we don't leak shells.
app.on('before-quit', () => {
  if (workspaceFileWatcher) {
    try { workspaceFileWatcher.close(); } catch {}
    workspaceFileWatcher = null;
    workspaceWatcherRoot = null;
  }
  for (const entry of ptys.values()) {
    try { entry.pty.kill(); } catch {}
  }
  ptys.clear();
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
    // Keep automatic downloads enabled by design. electron-updater verifies
    // provider metadata and artifact signatures when the release is signed;
    // release CI now refuses tagged unsigned macOS/Windows artifacts.
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

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
      updateReady = true;
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

  // Content-Security-Policy for the renderer. The renderer only ever loads our
  // own local app, so we stamp a CSP on responses served by the app origin.
  // This locks down object/embed injection, base-tag hijacking, framing, and
  // form exfiltration, and sets a default-src baseline. connect-src stays open
  // because users configure arbitrary AI provider endpoints (Groq, OpenAI,
  // Anthropic, OpenRouter, NIM, Ollama, ElevenLabs, custom local servers).
  // NOTE: script-src still allows 'unsafe-inline' because Next.js App Router
  // ships inline bootstrap scripts without nonces; tightening this to a
  // nonce-based policy is a follow-up that requires launch-testing the build.
  const APP_ORIGIN = `http://localhost:${isDev ? 3000 : 47891}`;
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:" // HMR needs eval in dev
    : "'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:"; // wasm-unsafe-eval for local STT/embeddings
  const CSP = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "connect-src * data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith(APP_ORIGIN)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });

  // Fix for Web Speech API: Google's speech service checks the Origin header.
  // In Electron, requests may not carry a proper Origin. Inject it so
  // wss://www.google.com/speech-api accepts them.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://www.google.com/*', 'wss://www.google.com/*'] },
    (details, callback) => {
      details.requestHeaders['Origin'] = APP_ORIGIN;
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
}).catch((err) => {
  console.error('[Marven] Startup failed:', err && err.message ? err.message : err);
  app.quit();
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
