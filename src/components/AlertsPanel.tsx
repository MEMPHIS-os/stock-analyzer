import { useState } from 'react';
import { Bell, BellRing, X, Plus, Trash2, ArrowUp, ArrowDown, Check } from 'lucide-react';
import type { PriceAlert } from '../hooks/useAlerts';
import { useApp } from '../context';
import { usePrice } from '../hooks/usePrice';

interface AlertsPanelProps {
  alerts: PriceAlert[];
  activeAlerts: PriceAlert[];
  triggeredAlerts: PriceAlert[];
  onAdd: (symbol: string, targetPrice: number, condition: 'above' | 'below') => void;
  onRemove: (id: string) => void;
  onClearTriggered: () => void;
  onClose: () => void;
}

function formatTime(timestamp: number) {
  const d = new Date(timestamp);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export default function AlertsPanel({
  activeAlerts,
  triggeredAlerts,
  onAdd,
  onRemove,
  onClearTriggered,
  onClose,
}: AlertsPanelProps) {
  const { t, showToast } = useApp();
  const { fp } = usePrice();
  const [symbol, setSymbol] = useState('');
  const [price, setPrice] = useState('');
  const [condition, setCondition] = useState<'above' | 'below'>('above');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    const p = parseFloat(price);
    if (!sym || isNaN(p) || p <= 0) return;
    onAdd(sym, p, condition);
    showToast(t('toast.alertCreated'), 'success');
    setSymbol('');
    setPrice('');
  }

  const glassStyle: React.CSSProperties = {
    background: 'var(--glass-bg)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid var(--glass-border)',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-backdrop-in"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-depth-lg w-full max-w-lg animate-scale-in max-h-[80vh] flex flex-col overflow-hidden"
        style={glassStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--glass-border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <Bell className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-lg font-bold text-txt-primary tracking-tight">Kursalarme</h2>
            {activeAlerts.length > 0 && (
              <span className="text-xs bg-accent/15 text-accent px-2.5 py-0.5 rounded-full font-semibold">
                {activeAlerts.length} aktiv
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-dark-600/50 rounded-lg text-txt-secondary hover:text-txt-primary transition-all duration-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Add alert form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 border-b" style={{ borderColor: 'var(--glass-border)' }}>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-[10px] text-txt-muted uppercase tracking-wider font-medium">Symbol</label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="AAPL"
                className="input w-full text-sm mt-1"
              />
            </div>
            <div className="w-24">
              <label className="text-[10px] text-txt-muted uppercase tracking-wider font-medium">Bedingung</label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as 'above' | 'below')}
                className="input w-full text-sm mt-1"
              >
                <option value="above">Über</option>
                <option value="below">Unter</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-txt-muted uppercase tracking-wider font-medium">{t('alerts.price')}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="150.00"
                className="input w-full text-sm mt-1"
              />
            </div>
            <button
              type="submit"
              className="btn-primary flex items-center gap-1.5 shrink-0 px-3.5 py-2.5"
              disabled={!symbol.trim() || !price}
            >
              <Plus className="w-4 h-4" />
              Alarm
            </button>
          </div>
        </form>

        {/* Alert list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
          {activeAlerts.length === 0 && triggeredAlerts.length === 0 && (
            <div className="text-center text-sm text-txt-secondary py-10">
              <Bell className="w-10 h-10 text-txt-muted/20 mx-auto mb-3" />
              Keine Alarme gesetzt.
              <br />
              <span className="text-txt-muted text-xs mt-1 block">
                Erstelle einen Alarm um bei Kursänderungen benachrichtigt zu werden.
              </span>
            </div>
          )}

          {/* Active alerts */}
          {activeAlerts.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold mb-2.5">
                Aktive Alarme ({activeAlerts.length})
              </h3>
              {activeAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between py-2.5 px-3.5 rounded-xl mb-1.5 transition-all duration-200 hover:bg-dark-600/20"
                  style={{ background: 'rgba(var(--color-bg-700), 0.3)' }}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`p-1 rounded-lg ${alert.condition === 'above' ? 'bg-success/10' : 'bg-danger/10'}`}>
                      {alert.condition === 'above' ? (
                        <ArrowUp className="w-3.5 h-3.5 text-success" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-danger" />
                      )}
                    </div>
                    <span className="font-mono font-bold text-sm text-txt-primary">
                      {alert.symbol}
                    </span>
                    <span className="text-xs text-txt-secondary">
                      {alert.condition === 'above' ? 'über' : 'unter'}
                    </span>
                    <span className="font-mono text-sm text-txt-primary font-medium">
                      {fp(alert.targetPrice)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-txt-muted">
                      {formatTime(alert.createdAt)}
                    </span>
                    <button
                      onClick={() => onRemove(alert.id)}
                      className="p-1.5 hover:bg-danger/20 rounded-lg transition-all duration-200"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-danger" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Triggered alerts */}
          {triggeredAlerts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
                  Ausgelöst ({triggeredAlerts.length})
                </h3>
                <button
                  onClick={onClearTriggered}
                  className="text-[10px] text-txt-muted hover:text-danger transition-colors"
                >
                  Alle löschen
                </button>
              </div>
              {triggeredAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-center justify-between py-2.5 px-3.5 rounded-xl bg-success/5 border border-success/15 mb-1.5"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1 rounded-lg bg-success/10">
                      <Check className="w-3.5 h-3.5 text-success" />
                    </div>
                    <span className="font-mono font-bold text-sm text-success">
                      {alert.symbol}
                    </span>
                    <span className="text-xs text-txt-secondary">
                      {alert.condition === 'above' ? 'über' : 'unter'}
                    </span>
                    <span className="font-mono text-sm text-txt-secondary line-through">
                      {fp(alert.targetPrice)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-success">
                      {alert.triggeredAt ? formatTime(alert.triggeredAt) : ''}
                    </span>
                    <button
                      onClick={() => onRemove(alert.id)}
                      className="p-1.5 hover:bg-danger/20 rounded-lg transition-all duration-200"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-txt-muted" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t text-[10px] text-txt-muted" style={{ borderColor: 'var(--glass-border)' }}>
          Alarme werden bei jedem Quote-Refresh (alle 30s) geprüft. Browser-Benachrichtigungen müssen erlaubt sein.
        </div>
      </div>
    </div>
  );
}
