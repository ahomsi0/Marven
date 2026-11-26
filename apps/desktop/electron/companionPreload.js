// Preload for the Mini Me companion window. Deliberately minimal: the companion
// page gets read-only settings (secrets masked by main) and its own IPC surface,
// never the main window's full bridge.
const { contextBridge, ipcRenderer } = require('electron');

// Subscribe to a main → renderer channel; returns an unsubscribe function.
const subscribe = (channel) => (cb) => {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('marvenElectron', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('get-settings'),
  companion: {
    getSettings: () => ipcRenderer.invoke('companion:get-settings'),
    getPosition: () => ipcRenderer.invoke('companion:get-position'),
    setInteractive: (on) => ipcRenderer.send('companion:set-interactive', !!on),
    // Linux: the [data-hit] rects that shape the window (main sanitizes them).
    setHitRects: (rects) => ipcRenderer.send('companion:set-hit-rects', rects),
    setFocusable: (on) => ipcRenderer.send('companion:set-focusable', !!on),
    walkTo: (x) => ipcRenderer.send('companion:walk-to', x),
    stop: () => ipcRenderer.send('companion:stop'),
    drag: (dx, dy) => ipcRenderer.send('companion:drag', dx, dy),
    drop: () => ipcRenderer.send('companion:drop'),
    returnHome: () => ipcRenderer.send('companion:return-home'),
    // Resolves { ok: true } once Marven's window took the hand-off, else { ok: false, reason }.
    openInMarven: (messages, mode, options) =>
      ipcRenderer.invoke('companion:open-in-marven', messages, mode, options).then(
        (r) => (r && typeof r === 'object' ? r : { ok: false, reason: 'refused' }),
        () => ({ ok: false, reason: 'refused' }),
      ),
    openPath: (target) => ipcRenderer.invoke('companion:open-path', target),
    openUrl: (url) => ipcRenderer.invoke('companion:open-url', url),
    showPreview: (root, name) => ipcRenderer.invoke('companion:preview-show', root, name).then((u) => (typeof u === 'string' ? u : null), () => null),
    previewReload: () => ipcRenderer.send('companion:preview-reload'),
    listProjects: () => ipcRenderer.invoke('companion:list-projects').then((l) => (Array.isArray(l) ? l : []), () => []),
    setBubbleRect: (rect) => ipcRenderer.send('companion:bubble-rect', rect),
    onPreviewClosed: subscribe('companion:preview-closed'),
    onPreviewOpenInMarven: subscribe('companion:preview-open-in-marven'),
    readClipboard: () => ipcRenderer.invoke('companion:read-clipboard'),
    openSettings: (page) => ipcRenderer.send('companion:open-settings', page),
    onPosition: subscribe('companion:position'),
    onOpenInput: subscribe('companion:open-input'),
    onListen: subscribe('companion:listen'),
    onSettings: subscribe('companion:settings'),
  },
});
