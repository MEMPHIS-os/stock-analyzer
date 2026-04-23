import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

interface ElectronAPI {
  onUpdateAvailable: (cb: (info: { version: string }) => void) => void;
  onUpdateDownloaded: (cb: (info: { version: string }) => void) => void;
  installUpdate: () => void;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export default function UpdateBanner() {
  const [updateReady, setUpdateReady] = useState(false);
  const [version, setVersion] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.onUpdateDownloaded((info) => {
      setVersion(info.version);
      setUpdateReady(true);
    });
  }, []);

  if (!updateReady || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-accent text-white text-center py-1.5 px-4 text-sm flex items-center justify-center gap-2">
      <Download className="w-4 h-4" />
      <span>Version {version} ist bereit — </span>
      <button
        onClick={() => window.electronAPI?.installUpdate()}
        className="underline font-medium hover:opacity-80"
      >
        Jetzt aktualisieren
      </button>
      <button onClick={() => setDismissed(true)} className="ml-4 hover:opacity-80">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
