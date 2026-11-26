// Preload for Mini Me's preview window: reload notices in, toolbar actions out.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marvenPreview', {
  onReload: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('preview:reload', handler);
    return () => ipcRenderer.removeListener('preview:reload', handler);
  },
  openInBrowser: () => ipcRenderer.send('preview:open-browser'),
  openFolder: () => ipcRenderer.send('preview:open-folder'),
  openInMarven: () => ipcRenderer.send('preview:open-in-marven'),
  close: () => ipcRenderer.send('preview:close'),
});
