import { useState, useEffect } from 'react';
import { Download, X, RefreshCw, CheckCircle, Loader2 } from 'lucide-react';

interface ElectronAPI {
  onUpdateChecking: (cb: () => void) => void;
  onUpdateAvailable: (cb: (info: { version: string; releaseNotes?: string }) => void) => void;
  onUpdateNotAvailable: (cb: () => void) => void;
  onUpdateDownloadProgress: (cb: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => void;
  onUpdateDownloaded: (cb: (info: { version: string; releaseNotes?: string }) => void) => void;
  onUpdateError: (cb: (error: { message: string }) => void) => void;
  installUpdate: () => void;
  checkForUpdates: () => void;
  getAppVersion: () => Promise<string>;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

type UpdateState = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function UpdateBanner() {
  const [state, setState] = useState<UpdateState>('idle');
  const [version, setVersion] = useState('');
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [transferred, setTransferred] = useState(0);
  const [total, setTotal] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.onUpdateChecking(() => {
      setState('checking');
    });

    api.onUpdateAvailable((info) => {
      setVersion(info.version);
      setState('downloading');
    });

    api.onUpdateNotAvailable(() => {
      setState('idle');
    });

    api.onUpdateDownloadProgress((prog) => {
      setProgress(prog.percent);
      setSpeed(prog.bytesPerSecond);
      setTransferred(prog.transferred);
      setTotal(prog.total);
    });

    api.onUpdateDownloaded((info) => {
      setVersion(info.version);
      setState('ready');
      setDismissed(false); // Re-show if dismissed
    });

    api.onUpdateError((err) => {
      setErrorMessage(err?.message || 'Unbekannter Fehler');
      setState('error');
      // Errors stay visible until manually dismissed - don't auto-hide
    });
  }, []);

  // Don't show anything for idle/checking states or dismissed
  if (state === 'idle') return null;
  if (state === 'checking') return null;
  if (dismissed && state !== 'ready') return null;

  return (
    <div
      className="relative z-[100] text-white text-sm shrink-0 overflow-hidden"
      style={{
        background: state === 'ready'
          ? 'linear-gradient(135deg, #26a69a 0%, #2bbbad 100%)'
          : state === 'error'
          ? 'linear-gradient(135deg, #ef5350 0%, #e53935 100%)'
          : 'linear-gradient(135deg, #2962ff 0%, #1e88e5 100%)',
      }}
    >
      {/* Download progress bar */}
      {state === 'downloading' && (
        <div
          className="absolute bottom-0 left-0 h-0.5 bg-white/40 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      )}

      <div className="flex items-center justify-center gap-3 py-2 px-4">
        {state === 'downloading' && (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>
              Update v{version} wird heruntergeladen — {progress.toFixed(0)}%
              <span className="hidden sm:inline text-white/70 ml-2">
                ({formatBytes(transferred)} / {formatBytes(total)} · {formatBytes(speed)}/s)
              </span>
            </span>
          </>
        )}

        {state === 'ready' && (
          <>
            <CheckCircle className="w-4 h-4" />
            <span>Version {version} ist bereit!</span>
            <button
              onClick={() => window.electronAPI?.installUpdate()}
              className="px-3 py-0.5 bg-white/20 hover:bg-white/30 rounded-lg font-medium transition-colors"
            >
              Jetzt installieren & neustarten
            </button>
            <button onClick={() => setDismissed(true)} className="ml-2 hover:bg-white/20 rounded-lg p-1 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </>
        )}

        {state === 'error' && (
          <>
            <X className="w-4 h-4 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold">Update fehlgeschlagen</span>
              {errorMessage && (
                <span className="ml-2 text-white/80 text-xs font-mono break-all">
                  {errorMessage}
                </span>
              )}
            </div>
            <button
              onClick={() => {
                setErrorMessage('');
                window.electronAPI?.checkForUpdates();
                setState('checking');
              }}
              className="px-3 py-0.5 bg-white/20 hover:bg-white/30 rounded-lg font-medium transition-colors flex items-center gap-1.5 shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Erneut versuchen
            </button>
            <button onClick={() => setDismissed(true)} className="ml-2 hover:bg-white/20 rounded-lg p-1 transition-colors shrink-0">
              <X className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
