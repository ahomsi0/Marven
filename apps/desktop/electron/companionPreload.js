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
    setFocusable: (on) => ipcRenderer.send('companion:set-focusable', !!on),
    walkTo: (x) => ipcRenderer.send('companion:walk-to', x),
    stop: () => ipcRenderer.send('companion:stop'),
    drag: (dx, dy) => ipcRenderer.send('companion:drag', dx, dy),
    drop: () => ipcRenderer.send('companion:drop'),
    returnHome: () => ipcRenderer.send('companion:return-home'),
    // Resolves true when Marven took the hand-off; false when main refused it (or failed).
    openInMarven: (messages, mode, options) =>
      ipcRenderer.invoke('companion:open-in-marven', messages, mode, options).then((ok) => ok === true, () => false),
    openPath: (target) => ipcRenderer.invoke('companion:open-path', target),
    openUrl: (url) => ipcRenderer.invoke('companion:open-url', url),
    readClipboard: () => ipcRenderer.invoke('companion:read-clipboard'),
    openSettings: (page) => ipcRenderer.send('companion:open-settings', page),
    onPosition: subscribe('companion:position'),
    onOpenInput: subscribe('companion:open-input'),
    onListen: subscribe('companion:listen'),
    onSettings: subscribe('companion:settings'),
  },
});
