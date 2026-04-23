import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Update events ───
  onUpdateChecking: (callback: () => void) => {
    ipcRenderer.on('update-checking', () => callback());
  },
  onUpdateAvailable: (callback: (info: { version: string; releaseNotes?: string; releaseDate?: string }) => void) => {
    ipcRenderer.on('update-available', (_event, info) => callback(info));
  },
  onUpdateNotAvailable: (callback: () => void) => {
    ipcRenderer.on('update-not-available', () => callback());
  },
  onUpdateDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => {
    ipcRenderer.on('update-download-progress', (_event, progress) => callback(progress));
  },
  onUpdateDownloaded: (callback: (info: { version: string; releaseNotes?: string }) => void) => {
    ipcRenderer.on('update-downloaded', (_event, info) => callback(info));
  },
  onUpdateError: (callback: (error: { message: string }) => void) => {
    ipcRenderer.on('update-error', (_event, error) => callback(error));
  },

  // ─── Update actions ───
  installUpdate: () => {
    ipcRenderer.send('install-update');
  },
  checkForUpdates: () => {
    ipcRenderer.send('check-for-updates');
  },

  // ─── App info ───
  getAppVersion: (): Promise<string> => {
    return ipcRenderer.invoke('get-app-version');
  },

  // ─── Notifications ───
  showNotification: (title: string, body: string) => {
    ipcRenderer.send('show-notification', { title, body });
  },

  isElectron: true,
});
