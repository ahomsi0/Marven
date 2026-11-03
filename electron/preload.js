const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marvenElectron', {
  onTriggerVoice: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('trigger-voice', handler);
    return () => ipcRenderer.removeListener('trigger-voice', handler);
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
  /** Start watching a workspace root for file changes (Electron only). */
  workspaceWatchStart: (rootPath) => ipcRenderer.invoke('marven-workspace-watch', rootPath),
  workspaceWatchStop: () => ipcRenderer.invoke('marven-workspace-watch-stop'),
  onWorkspaceFileEvent: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('marven-workspace-file-event', handler);
    return () => ipcRenderer.removeListener('marven-workspace-file-event', handler);
  },
  onUpdateStatus: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
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

  // ── In-app browser ──────────────────────────────────────────────────────────
  // A native view the main process layers over the chat's browser panel.
  // `bounds` is the panel viewport's rect in CSS pixels.
  browser: {
    show: (bounds) => ipcRenderer.invoke("browser-show", bounds),
    setBounds: (bounds) => ipcRenderer.send("browser-bounds", bounds),
    hide: () => ipcRenderer.send("browser-hide"),
    freeze: () => ipcRenderer.invoke("browser-freeze"),
    unfreeze: () => ipcRenderer.send("browser-unfreeze"),
    setFocused: (focused) => ipcRenderer.send("browser-focus", focused),
    snapshot: () => ipcRenderer.invoke("browser-get-snapshot"),
    newTab: (url) => ipcRenderer.invoke("browser-new-tab", url),
    closeTab: (id) => ipcRenderer.send("browser-close-tab", id),
    activateTab: (id) => ipcRenderer.send("browser-activate-tab", id),
    moveTab: (id, toIndex) => ipcRenderer.send("browser-move-tab", id, toIndex),
    reopenClosedTab: () => ipcRenderer.send("browser-reopen-tab"),
    navigate: (id, url) => ipcRenderer.invoke("browser-navigate", id, url),
    command: (id, name) => ipcRenderer.send("browser-command", id, name),
    toggleBookmark: (url, title) => ipcRenderer.invoke("browser-toggle-bookmark", url, title),
    removeBookmark: (id) => ipcRenderer.invoke("browser-remove-bookmark", id),
    listBookmarks: (query) => ipcRenderer.invoke("browser-bookmarks", query),
    isBookmarked: (url) => ipcRenderer.invoke("browser-is-bookmarked", url),
    suggest: (query) => ipcRenderer.invoke("browser-suggest", query),
    setBlocking: (host, enabled) => ipcRenderer.send("browser-set-blocking", host, enabled),
    cancelDownload: (id) => ipcRenderer.send("browser-cancel-download", id),
    showDownload: (id) => ipcRenderer.send("browser-show-download", id),
    clearBrowsingData: () => ipcRenderer.invoke("browser-clear-data"),
    onSnapshot: (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on("browser-snapshot", handler);
      return () => ipcRenderer.removeListener("browser-snapshot", handler);
    },
    onFocusAddress: (cb) => {
      const handler = () => cb();
      ipcRenderer.on("browser-focus-address", handler);
      return () => ipcRenderer.removeListener("browser-focus-address", handler);
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
