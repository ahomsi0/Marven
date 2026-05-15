const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marvenElectron', {
  onTriggerVoice: (cb) => {
    ipcRenderer.on('trigger-voice', (_event) => cb());
    return () => ipcRenderer.removeAllListeners('trigger-voice');
  },
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  openFolderDialog: () => ipcRenderer.invoke('dialog-open-folder'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
});
