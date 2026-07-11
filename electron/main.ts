import { app, BrowserWindow, ipcMain, Notification, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { startServer } from '../server';

let mainWindow: BrowserWindow | null = null;
let httpServer: import('http').Server | null = null;
let serverPort: number | null = null;
let updateCheckInterval: ReturnType<typeof setInterval> | null = null;
let isQuittingForUpdate = false;
let cleanedUp = false;

/**
 * Release process resources before the app quits (normal quit OR an
 * update-install quit). Closing the HTTP server promptly frees the fixed port
 * 38473, so the relaunched (updated) app re-binds the SAME port → same
 * localStorage origin → the portfolio/watchlist survive the update. Also stops
 * the periodic update check so it can't fire mid-uninstall. Idempotent.
 */
function cleanupBeforeQuit() {
  if (cleanedUp) return;
  cleanedUp = true;
  try {
    if (updateCheckInterval) clearInterval(updateCheckInterval);
  } catch {}
  try {
    httpServer?.close();
    // Also drop keep-alive sockets (the renderer holds open connections) so
    // the port is released immediately, not when the sockets time out.
    (httpServer as any)?.closeAllConnections?.();
  } catch {}
  // Drop the references so a later createWindow (macOS 'activate' edge case)
  // starts a fresh server instead of reusing the closed one.
  httpServer = null;
  serverPort = null;
}

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

  splashWindow.loadFile(path.join(__dirname, 'splash.html'), {
    query: { v: app.getVersion() },
  });

  console.log('  Static dir:', distPath);
  console.log('  Packaged:', app.isPackaged);
  console.log('  Version:', app.getVersion());

  // Push a real loading-phase message to the splash screen (best-effort).
  const splashStatus = (text: string) => {
    if (splashWindow.isDestroyed()) return;
    splashWindow.webContents
      .executeJavaScript(`window.setStatus && window.setStatus(${JSON.stringify(text)})`)
      .catch(() => {});
  };

  // Start server on a STABLE port. The renderer loads from
  // http://localhost:<port>, and Chromium keys localStorage by that origin —
  // so a fixed port is what keeps the portfolio, watchlist, drawings and alerts
  // persisted across restarts. startServer walks up from here if the port is
  // taken (and only falls back to a random port as a last resort). Reuse an
  // already-running server (e.g. on macOS 'activate') instead of starting a
  // second one on a different port/origin.
  if (!httpServer || serverPort == null) {
    const { port, server } = await startServer(distPath, 38473);
    httpServer = server;
    serverPort = port;
  }
  const port = serverPort;
  splashStatus('Marktdaten werden geladen…');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'StockAnalyzer',
    // Transparent base + Windows 11 acrylic backdrop → the window gets a
    // frosted-glass look (blurred, see-through desktop behind it). The renderer
    // layers a translucent shell on top (see `html.acrylic` in index.css).
    // IMPORTANT: never call setOpacity() on this window — a layered window
    // disables the DWM acrylic material, so the intro fade lives in CSS instead.
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // ─── Navigation hardening ───
  // External links (news feeds etc.) must never open an Electron window that
  // inherits our preload/webPreferences — hand them to the OS browser instead.
  // about:blank stays allowed for the print-report fallback (pdfReport.ts).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    }
    return url === 'about:blank' ? { action: 'allow' } : { action: 'deny' };
  });

  const appOrigin = `http://localhost:${port}`;
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin !== appOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  // Helper to show main window and cross-fade out the splash (only once)
  let shown = false;
  function showMainWindow() {
    if (shown || !mainWindow) return;
    shown = true;

    // Show at full opacity — do NOT fade the window via setOpacity(): a layered
    // window suppresses the Windows 11 acrylic backdrop. The intro fade now
    // lives in CSS (html.acrylic #root). Re-assert the material once on show as
    // belt-and-suspenders (cheap no-op if it's already applied).
    mainWindow.show();
    mainWindow.focus();
    if (process.platform === 'win32') {
      try {
        mainWindow.setBackgroundMaterial('acrylic');
      } catch {}
    }

    // Cross-fade the (opaque, non-acrylic) splash out, then close it.
    let splashOp = 1;
    const fadeOut = setInterval(() => {
      if (splashWindow.isDestroyed()) return clearInterval(fadeOut);
      splashOp -= 0.12;
      if (splashOp <= 0) {
        clearInterval(fadeOut);
        splashWindow.close();
      } else {
        splashWindow.setOpacity(splashOp);
      }
    }, 16);
  }

  // Update splash text while the UI bundle loads.
  mainWindow.webContents.once('did-start-loading', () => splashStatus('Oberfläche wird geladen…'));

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  // ─── Native desktop notifications ───
  ipcMain.on('show-notification', (_event, payload: unknown) => {
    const data = payload as { title?: unknown; body?: unknown } | null | undefined;
    const title = typeof data?.title === 'string' ? data.title.slice(0, 256) : null;
    const body = typeof data?.body === 'string' ? data.body.slice(0, 1024) : '';
    if (!title || !Notification.isSupported()) return;
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
  });

  // ─── App version request ───
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });
}

function setupAutoUpdater() {
  // Configure
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  // Disable differential downloads — they can fail with blockmap mismatches
  // for unsigned builds. Forces full installer download (slightly larger but reliable).
  (autoUpdater as any).disableDifferentialDownload = true;

  // Persistent log file for debugging update failures
  // Saved to %APPDATA%\StockAnalyzer\logs\updater.log
  const logDir = path.join(process.env.APPDATA || process.env.HOME || '.', 'StockAnalyzer', 'logs');
  try {
    require('fs').mkdirSync(logDir, { recursive: true });
  } catch {}
  const logFile = path.join(logDir, 'updater.log');
  const fs = require('fs');

  function writeLog(level: string, msg: any) {
    const line = `[${new Date().toISOString()}] [${level}] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}\n`;
    try {
      fs.appendFileSync(logFile, line);
    } catch {}
    console.log(`[AutoUpdater:${level}]`, msg);
  }

  autoUpdater.logger = {
    info: (msg: any) => writeLog('info', msg),
    warn: (msg: any) => writeLog('warn', msg),
    error: (msg: any) => writeLog('error', msg),
    debug: (msg: any) => writeLog('debug', msg),
  } as any;

  writeLog('info', `=== AutoUpdater started, app version ${app.getVersion()} ===`);

  // ─── Events ───

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for updates...');
    mainWindow?.webContents.send('update-checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info.version);
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate,
    });

    // Show native notification
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'Update verfügbar',
        body: `StockAnalyzer v${info.version} wird heruntergeladen...`,
        icon: path.join(__dirname, '..', 'build', 'icon.ico'),
      });
      notification.show();
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[AutoUpdater] No update available.');
    mainWindow?.webContents.send('update-not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[AutoUpdater] Download: ${progress.percent.toFixed(1)}%`);
    mainWindow?.webContents.send('update-download-progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info.version);
    mainWindow?.webContents.send('update-downloaded', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });

    // Show native notification
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: 'Update bereit',
        body: `StockAnalyzer v${info.version} ist bereit zur Installation. Beim nächsten Neustart wird aktualisiert.`,
        icon: path.join(__dirname, '..', 'build', 'icon.ico'),
      });
      notification.on('click', () => {
        mainWindow?.show();
        mainWindow?.focus();
      });
      notification.show();
    }
  });

  autoUpdater.on('error', (err) => {
    const errorDetails = `${err.message}${err.stack ? `\n${err.stack}` : ''}`;
    writeLog('error', `Update error: ${errorDetails}`);
    mainWindow?.webContents.send('update-error', { message: err.message });
  });

  // ─── IPC handlers ───

  ipcMain.on('install-update', () => {
    if (isQuittingForUpdate) return; // ignore double-clicks
    isQuittingForUpdate = true;
    writeLog('info', 'User requested install — closing resources & quitAndInstall...');
    // Free port 38473 and stop the periodic check before the installer spawns,
    // so the relaunched app re-binds the same port (same localStorage origin).
    cleanupBeforeQuit();
    // Defer quitAndInstall out of the IPC dispatch frame: calling it
    // synchronously here can race with window teardown / the IPC round-trip and
    // make the app exit before the NSIS installer fully detaches (the
    // "app just closes, installer never runs" / crash class of bugs).
    setImmediate(() => {
      try {
        // Destroy all windows FIRST so the app exits the moment quitAndInstall
        // spawns the installer. A 2026-06-09 install failure showed the old
        // process lingering ~23s after the installer started — the silent NSIS
        // installer raced the still-running app, wiped the install dir and
        // aborted, leaving no app installed. Destroyed windows = nothing keeps
        // the process (or file locks) alive.
        for (const w of BrowserWindow.getAllWindows()) {
          try {
            w.destroy();
          } catch {}
        }
        // oneClick NSIS (per-user, no UAC): silent install + force relaunch.
        // NB: isForceRunAfter is ignored unless isSilent is true.
        autoUpdater.quitAndInstall(true, true);
      } catch (err: any) {
        isQuittingForUpdate = false;
        writeLog('error', `quitAndInstall failed: ${err.message}`);
        mainWindow?.webContents.send('update-error', { message: `Install failed: ${err.message}` });
      }
    });
  });

  ipcMain.on('check-for-updates', () => {
    console.log('[AutoUpdater] Manual update check requested.');
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[AutoUpdater] Manual check failed:', err.message);
    });
  });

  // ─── Initial check + periodic checks ───

  // Check after 5 seconds (give app time to start)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);

  // Re-check every 4 hours
  updateCheckInterval = setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4 * 60 * 60 * 1000);
}

// Single-instance lock: a second instance would fail to bind port 38473, walk
// to another port and therefore see a DIFFERENT localStorage origin (empty
// portfolio/watchlist; entries made there would be orphaned). Focus the
// existing window instead.
const gotInstanceLock = app.requestSingleInstanceLock();

if (!gotInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady()
    .then(() => {
      registerIpcHandlers();
      // ─── Auto-Update (only in packaged mode) ───
      if (app.isPackaged) {
        setupAutoUpdater();
      }
      return createWindow();
    })
    .catch((err) => {
      // startServer can reject if no port could be bound (rare). Don't leave the
      // app hanging on an unhandled rejection — log and exit cleanly.
      console.error('Fatal: StockAnalyzer failed to start:', err);
      app.quit();
    });

  // Run cleanup once on any quit path (normal quit or electron-updater's
  // install-on-quit), so the HTTP server/port is released before the process
  // exits. quitAndInstall closes windows first, so this also covers the update
  // flow even though before-quit ordering differs there.
  app.on('before-quit', cleanupBeforeQuit);

  app.on('window-all-closed', () => {
    cleanupBeforeQuit();
    // During an update install, quitAndInstall owns the quit — calling app.quit()
    // here too would race it (we destroy the windows right before installing).
    if (!isQuittingForUpdate) app.quit();
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow().catch((err) => {
        console.error('Fatal: StockAnalyzer failed to restart window:', err);
      });
    }
  });
}
