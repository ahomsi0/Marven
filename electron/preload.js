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

  // Codebase indexing — moved to /api/index/* (see lib/index/client.ts). The
  // renderer talks to the Next.js server directly; no IPC bridge needed.

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
