import { useEffect, useState } from 'react';
import { X, Settings, Sun, Moon, Globe, Keyboard, RefreshCw, LayoutGrid, Palette, Coins } from 'lucide-react';
import { useApp, ACCENTS, type AccentColor } from '../context';
import { SplitFlap } from './SplitFlap';

const ACCENT_LABELS_EN: Record<AccentColor, string> = {
  blue: 'Blue', green: 'Green', violet: 'Violet', amber: 'Amber',
};

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
  const {
    theme,
    toggleTheme,
    locale,
    setLocale,
    displayCurrency,
    toggleDisplayCurrency,
    splitFlapEnabled,
    toggleSplitFlap,
    accent,
    setAccent,
  } = useApp();
  const de = locale === 'de';
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [previewValue, setPreviewValue] = useState('123.45');

  // Cycle the preview value while the panel is open so the user sees the flip
  useEffect(() => {
    const samples = ['123.45', '124.10', '123.88', '125.02'];
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % samples.length;
      setPreviewValue(samples[i]);
    }, 1500);
    return () => clearInterval(id);
  }, []);

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

          {/* Accent color */}
          <div>
            <label className="text-[11px] text-txt-muted font-semibold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" />
              {de ? 'Akzentfarbe' : 'Accent Color'}
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(Object.keys(ACCENTS) as AccentColor[]).map((key) => {
                const def = ACCENTS[key];
                const active = accent === key;
                return (
                  <button
                    key={key}
                    onClick={() => setAccent(key)}
                    className={`flex flex-col items-center gap-2 py-2.5 rounded-xl border transition-all duration-200 ${
                      active
                        ? 'border-accent/40 shadow-glow-sm'
                        : 'border-border/10 hover:border-border/30 hover:bg-dark-700/30'
                    }`}
                    style={{ background: 'var(--glass-bg)' }}
                    title={de ? def.label : ACCENT_LABELS_EN[key]}
                  >
                    <span
                      className="w-6 h-6 rounded-full ring-2 ring-white/10 transition-transform duration-200"
                      style={{
                        background: def.accent,
                        transform: active ? 'scale(1.1)' : 'scale(1)',
                        boxShadow: active ? `0 0 12px -2px ${def.accent}` : 'none',
                      }}
                    />
                    <span className={`text-[11px] font-medium ${active ? 'text-accent' : 'text-txt-secondary'}`}>
                      {de ? def.label : ACCENT_LABELS_EN[key]}
                    </span>
                  </button>
                );
              })}
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
                title={de ? 'Jede Aktie in ihrer Heimatwährung' : 'Each stock in its native currency'}
              >
                <Coins className="w-4 h-4" />
                <span className="text-sm font-medium">Original</span>
              </button>
            </div>
          </div>

          {/* Split-Flap (Solari board) */}
          <div>
            <label className="text-[11px] text-txt-muted font-semibold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <LayoutGrid className="w-3.5 h-3.5" />
              {de ? 'Anzeigetafel-Modus' : 'Split-Flap Display'}
            </label>
            <button
              onClick={toggleSplitFlap}
              className={`w-full flex items-center justify-between gap-3 p-3 rounded-xl border transition-all duration-200 ${
                splitFlapEnabled
                  ? 'bg-accent/10 border-accent/40 shadow-glow-sm'
                  : 'border-border/10 hover:border-border/30'
              }`}
              style={!splitFlapEnabled ? { background: 'var(--glass-bg)' } : {}}
            >
              <div className="flex flex-col items-start gap-0.5 text-left">
                <span className="text-sm font-medium text-txt-primary">
                  {de ? 'Klassische Anzeigetafel' : 'Classic departure board'}
                </span>
                <span className="text-[11px] text-txt-muted leading-snug">
                  {de
                    ? 'Ticker & großer Detail-Kurs blättern wie alte Flughafen-Anzeigen'
                    : 'Ticker & large detail price flip like old airport displays'}
                </span>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <SplitFlap value={previewValue} size={20} tone="accent" />
                <span
                  className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 ${
                    splitFlapEnabled ? 'bg-accent' : 'bg-dark-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                      splitFlapEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </span>
              </div>
            </button>
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
