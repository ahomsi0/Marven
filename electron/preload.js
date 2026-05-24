const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marvenElectron', {
  onTriggerVoice: (cb) => {
    ipcRenderer.on('trigger-voice', (_event) => cb());
    return () => ipcRenderer.removeAllListeners('trigger-voice');
  },
  platform: process.platform,
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  openFolderDialog: () => ipcRenderer.invoke('dialog-open-folder'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  openExternal: (url, browser) => ipcRenderer.invoke('open-external', url, browser),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (cb) => {
    ipcRenderer.on('update-status', (_event, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('update-status');
  },

  // ── Interactive terminal (node-pty) ────────────────────────────────────────
  // Renderer: TerminalView calls these to drive a real shell PTY. The id is a
  // stable per-workspace string so the PTY persists across UI remounts.
  ptyStart: (args) => ipcRenderer.invoke('pty-start', args),
  ptyWrite: (args) => ipcRenderer.send('pty-write', args),
  ptyResize: (args) => ipcRenderer.send('pty-resize', args),
  ptyKill: (args) => ipcRenderer.send('pty-kill', args),
  onPtyData: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('pty-data', handler);
    return () => ipcRenderer.removeListener('pty-data', handler);
  },
  onPtyExit: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('pty-exit', handler);
    return () => ipcRenderer.removeListener('pty-exit', handler);
  },

  // ── Codebase indexing bridge ─────────────────────────────────────────────
  index: {
    status: () => ipcRenderer.invoke('index:status'),
    runFull: () => ipcRenderer.invoke('index:run-full'),
    search: (query, limit) => ipcRenderer.invoke('index:search', query, limit),
    cancel: () => ipcRenderer.invoke('index:cancel'),
    clear: () => ipcRenderer.invoke('index:clear'),
    setWorkspace: (root) => ipcRenderer.invoke('index:set-workspace', root),
    setEnabled: (enabled) => ipcRenderer.invoke('index:set-enabled', enabled),
    updateFile: (abs) => ipcRenderer.invoke('index:update-file', abs),
    deleteFile: (abs) => ipcRenderer.invoke('index:delete-file', abs),
    onProgress: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('index:progress', h);
      return () => ipcRenderer.removeListener('index:progress', h);
    },
    onDone: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('index:done', h);
      return () => ipcRenderer.removeListener('index:done', h);
    },
    onError: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('index:error', h);
      return () => ipcRenderer.removeListener('index:error', h);
    },
  },

  // ── LSP bridge ────────────────────────────────────────────────────────────
  lsp: {
    ensure: (languageId) => ipcRenderer.invoke("lsp-ensure", languageId),
    openSession: (opts) => ipcRenderer.invoke("lsp-open-session", opts),
    closeSession: (sessionId) => ipcRenderer.invoke("lsp-close-session", sessionId),
    didChange: (sessionId, payload) => ipcRenderer.send("lsp-did-change", { sessionId, payload }),
    request: (sessionId, method, params) =>
      ipcRenderer.invoke("lsp-request", { sessionId, method, params }),
    restart: (languageId) => ipcRenderer.invoke("lsp-restart", languageId),
    onNotification: (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on("lsp-notification", handler);
      return () => ipcRenderer.removeListener("lsp-notification", handler);
    },
    onStatus: (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on("lsp-status", handler);
      return () => ipcRenderer.removeListener("lsp-status", handler);
    },
  },
});
