import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  onUpdateAvailable: (callback: (info: { version: string }) => void) => {
    ipcRenderer.on('update-available', (_event, info) => callback(info));
  },
  onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
    ipcRenderer.on('update-downloaded', (_event, info) => callback(info));
  },
  installUpdate: () => {
    ipcRenderer.send('install-update');
  },
  showNotification: (title: string, body: string) => {
    ipcRenderer.send('show-notification', { title, body });
  },
  isElectron: true,
});
