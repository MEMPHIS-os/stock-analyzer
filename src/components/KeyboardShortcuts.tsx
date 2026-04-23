import { X, Keyboard } from 'lucide-react';

interface KeyboardShortcutsProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: 'Ctrl+K', description: 'Aktie suchen' },
  { keys: 'F', description: 'Vollbild-Chart' },
  { keys: '1 - 8', description: 'Zeitraum wählen (1T, 5T, 1M, ...)' },
  { keys: 'C', description: 'Kerzen-Chart' },
  { keys: 'L', description: 'Linien-Chart' },
  { keys: 'A', description: 'Flächen-Chart' },
  { keys: 'H', description: 'Heikin Ashi Chart' },
  { keys: 'W', description: 'Sidebar ein-/ausblenden' },
  { keys: 'Esc', description: 'Overlay schließen' },
  { keys: '?', description: 'Tastenkürzel anzeigen' },
];

export default function KeyboardShortcuts({ open, onClose }: KeyboardShortcutsProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-dark-800 rounded-xl border border-border/50 shadow-2xl w-full max-w-md animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-accent" />
            <h2 className="text-base font-semibold text-txt-primary">
              Tastenkürzel
            </h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-2">
          {SHORTCUTS.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between py-1.5"
            >
              <span className="text-sm text-txt-secondary">{s.description}</span>
              <kbd className="px-2 py-0.5 rounded bg-dark-600 text-xs font-mono text-txt-primary border border-border/30">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
