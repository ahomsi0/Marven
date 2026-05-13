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
});
