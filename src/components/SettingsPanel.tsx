import { useEffect, useState } from 'react';
import { X, Settings, Sun, Moon, Globe, Keyboard, RefreshCw } from 'lucide-react';
import { useApp } from '../context';

const SHORTCUTS = [
  { keys: 'Ctrl+K', de: 'Aktie suchen', en: 'Search stock' },
  { keys: 'F', de: 'Vollbild-Chart', en: 'Fullscreen chart' },
  { keys: '1 - 8', de: 'Zeitraum wählen', en: 'Select time range' },
  { keys: 'C / L / A / H', de: 'Chart-Typ wechseln', en: 'Switch chart type' },
  { keys: 'W', de: 'Sidebar ein-/ausblenden', en: 'Toggle sidebar' },
  { keys: 'Esc', de: 'Overlay schließen', en: 'Close overlay' },
  { keys: '?', de: 'Tastenkürzel anzeigen', en: 'Show shortcuts' },
];

interface SettingsPanelProps {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { theme, toggleTheme, locale, setLocale, displayCurrency, toggleDisplayCurrency } = useApp();
  const de = locale === 'de';
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center animate-backdrop-in"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-depth-lg w-full max-w-md animate-scale-in mx-4 overflow-hidden"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          border: '1px solid var(--glass-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--glass-border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <Settings className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-base font-bold text-txt-primary tracking-tight">
              {de ? 'Einstellungen' : 'Settings'}
            </h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* Theme */}
          <div>
            <label className="text-[11px] text-txt-muted font-semibold uppercase tracking-wider mb-2.5 block">
              {de ? 'Darstellung' : 'Appearance'}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => { if (theme !== 'dark') toggleTheme(); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-all duration-200 ${
                  theme === 'dark'
                    ? 'bg-accent/15 border-accent/40 text-accent shadow-glow-sm'
                    : 'border-border/10 text-txt-secondary hover:border-border/30 hover:bg-dark-700/30'
                }`}
                style={theme !== 'dark' ? { background: 'var(--glass-bg)' } : {}}
              >
                <Moon className="w-4 h-4" />
                <span className="text-sm font-medium">Dark</span>
              </button>
              <button
                onClick={() => { if (theme !== 'light') toggleTheme(); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-all duration-200 ${
                  theme === 'light'
                    ? 'bg-accent/15 border-accent/40 text-accent shadow-glow-sm'
                    : 'border-border/10 text-txt-secondary hover:border-border/30 hover:bg-dark-700/30'
                }`}
                style={theme !== 'light' ? { background: 'var(--glass-bg)' } : {}}
              >
                <Sun className="w-4 h-4" />
                <span className="text-sm font-medium">Light</span>
              </button>
            </div>
          </div>

          {/* Language */}
          <div>
            <label className="text-[11px] text-txt-muted font-semibold uppercase tracking-wider mb-2.5 block">
              {de ? 'Sprache' : 'Language'}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setLocale('de')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-all duration-200 ${
                  locale === 'de'
                    ? 'bg-accent/15 border-accent/40 text-accent shadow-glow-sm'
                    : 'border-border/10 text-txt-secondary hover:border-border/30 hover:bg-dark-700/30'
                }`}
                style={locale !== 'de' ? { background: 'var(--glass-bg)' } : {}}
              >
                <Globe className="w-4 h-4" />
                <span className="text-sm font-medium">Deutsch</span>
              </button>
              <button
                onClick={() => setLocale('en')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-all duration-200 ${
                  locale === 'en'
                    ? 'bg-accent/15 border-accent/40 text-accent shadow-glow-sm'
                    : 'border-border/10 text-txt-secondary hover:border-border/30 hover:bg-dark-700/30'
                }`}
                style={locale !== 'en' ? { background: 'var(--glass-bg)' } : {}}
              >
                <Globe className="w-4 h-4" />
                <span className="text-sm font-medium">English</span>
              </button>
            </div>
          </div>

          {/* Currency */}
          <div>
            <label className="text-[11px] text-txt-muted font-semibold uppercase tracking-wider mb-2.5 block">
              {de ? 'Anzeigewährung' : 'Display Currency'}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => { if (displayCurrency !== 'EUR') toggleDisplayCurrency(); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-all duration-200 ${
                  displayCurrency === 'EUR'
                    ? 'bg-accent/15 border-accent/40 text-accent shadow-glow-sm'
                    : 'border-border/10 text-txt-secondary hover:border-border/30 hover:bg-dark-700/30'
                }`}
                style={displayCurrency !== 'EUR' ? { background: 'var(--glass-bg)' } : {}}
              >
                <span className="text-base font-bold">&#8364;</span>
                <span className="text-sm font-medium">Euro</span>
              </button>
              <button
                onClick={() => { if (displayCurrency !== 'native') toggleDisplayCurrency(); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-all duration-200 ${
                  displayCurrency === 'native'
                    ? 'bg-accent/15 border-accent/40 text-accent shadow-glow-sm'
                    : 'border-border/10 text-txt-secondary hover:border-border/30 hover:bg-dark-700/30'
                }`}
                style={displayCurrency !== 'native' ? { background: 'var(--glass-bg)' } : {}}
              >
                <span className="text-base font-bold">$</span>
                <span className="text-sm font-medium">Original</span>
              </button>
            </div>
          </div>

          {/* Shortcuts */}
          <div>
            <label className="text-[11px] text-txt-muted font-semibold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Keyboard className="w-3.5 h-3.5" />
              {de ? 'Tastenkürzel' : 'Keyboard Shortcuts'}
            </label>
            <div className="rounded-xl p-3.5 space-y-1.5" style={{ background: 'rgba(var(--color-bg-700), 0.3)' }}>
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-center justify-between py-1">
                  <span className="text-xs text-txt-secondary">{de ? s.de : s.en}</span>
                  <kbd className="px-2 py-0.5 rounded-lg text-[10px] font-mono text-txt-primary border"
                    style={{ background: 'var(--glass-bg)', borderColor: 'var(--glass-border)' }}
                  >
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          {/* Version & Updates */}
          <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--glass-border)' }}>
            <div className="text-xs text-txt-muted">
              StockAnalyzer {appVersion ? `v${appVersion}` : ''}
            </div>
            {window.electronAPI && (
              <button
                onClick={() => {
                  setCheckingUpdate(true);
                  window.electronAPI?.checkForUpdates();
                  setTimeout(() => setCheckingUpdate(false), 3000);
                }}
                disabled={checkingUpdate}
                className="flex items-center gap-1.5 text-xs text-txt-secondary hover:text-accent transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />
                {checkingUpdate
                  ? (de ? 'Prüfe...' : 'Checking...')
                  : (de ? 'Nach Updates suchen' : 'Check for updates')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
