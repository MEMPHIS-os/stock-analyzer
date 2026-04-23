import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { startServer } from '../server';

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  // In packaged mode (asar:false): resources/app/dist-electron/main.cjs → resources/app/dist/
  // In dev mode: dist-electron/main.cjs → dist/
  const distPath = path.join(__dirname, '..', 'dist');

  // Splash screen
  const splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: false,
    backgroundColor: '#0f1117',
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));

  console.log('  Static dir:', distPath);
  console.log('  Packaged:', app.isPackaged);

  // Start server (also pre-warms Yahoo auth in background)
  const port = await startServer(distPath, 0); // port 0 = random available port

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'StockAnalyzer',
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Helper to show main window and close splash (only once)
  let shown = false;
  function showMainWindow() {
    if (shown) return;
    shown = true;
    if (!splashWindow.isDestroyed()) splashWindow.close();
    mainWindow?.show();
    mainWindow?.focus();
  }

  // Show window when page is ready OR after timeout as fallback
  mainWindow.once('ready-to-show', showMainWindow);
  mainWindow.webContents.on('did-finish-load', showMainWindow);

  // Fallback: if nothing fires within 8s, show anyway
  setTimeout(showMainWindow, 8000);

  // Log load errors for debugging
  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`  Page failed to load: ${code} ${desc}`);
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  // Open DevTools in dev mode for debugging
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  // Native desktop notifications
  ipcMain.on('show-notification', (_event, { title, body }: { title: string; body: string }) => {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body,
        icon: path.join(__dirname, '..', 'build', 'icon.ico'),
        silent: false,
      });
      notification.on('click', () => {
        mainWindow?.show();
        mainWindow?.focus();
      });
      notification.show();
    }
  });

  // Auto-update (only in packaged mode)
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update-available', { version: info.version });
    });

    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('update-downloaded', { version: info.version });
    });

    ipcMain.on('install-update', () => {
      autoUpdater.quitAndInstall();
    });

    autoUpdater.checkForUpdates().catch(() => {});
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
