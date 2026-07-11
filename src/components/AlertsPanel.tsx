import { useState } from 'react';
import { Bell, X, Plus, Trash2, ArrowUp, ArrowDown, Check, Percent, BarChart3, DollarSign, Pause, Play, Repeat, Activity, TrendingUp } from 'lucide-react';
import type { PriceAlert, AddAlertInput, AlertKind } from '../hooks/useAlerts';
import { useApp } from '../context';
import { usePrice } from '../hooks/usePrice';

interface AlertsPanelProps {
  alerts: PriceAlert[];
  activeAlerts: PriceAlert[];
  triggeredAlerts: PriceAlert[];
  onAdd: (input: AddAlertInput) => PriceAlert;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onClearTriggered: () => void;
  onClose: () => void;
}

function formatTime(timestamp: number) {
  const d = new Date(timestamp);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

const KIND_META: Record<AlertKind, { de: string; en: string; icon: typeof DollarSign }> = {
  price: { de: 'Kurs', en: 'Price', icon: DollarSign },
  percentChange: { de: '% Tag', en: '% Day', icon: Percent },
  volumeSpike: { de: 'Volumen', en: 'Volume', icon: BarChart3 },
  rsi: { de: 'RSI', en: 'RSI', icon: Activity },
  trendlineCross: { de: 'Trendlinie', en: 'Trend line', icon: TrendingUp },
};

/** Kinds that can be created from this panel. trendlineCross is created by
 *  drawing a line on the chart, so it is excluded from the creation grid. */
const CREATABLE_KINDS: AlertKind[] = ['price', 'percentChange', 'volumeSpike', 'rsi'];

export default function AlertsPanel({
  activeAlerts,
  triggeredAlerts,
  onAdd,
  onRemove,
  onToggle,
  onClearTriggered,
  onClose,
}: AlertsPanelProps) {
  const { t, locale, showToast } = useApp();
  const { fp } = usePrice();
  const de = locale === 'de';
  const [kind, setKind] = useState<AlertKind>('price');
  const [symbol, setSymbol] = useState('');
  const [value, setValue] = useState('');
  const [condition, setCondition] = useState<'above' | 'below'>('above');
  const [recurring, setRecurring] = useState(false);
  const [rsiPeriod, setRsiPeriod] = useState('14');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const sym = symbol.trim().toUpperCase();
    const v = parseFloat(value);
    if (!sym || isNaN(v) || v <= 0) return;

    if (kind === 'price') {
      onAdd({ kind: 'price', symbol: sym, targetPrice: v, condition, recurring });
    } else if (kind === 'percentChange') {
      onAdd({ kind: 'percentChange', symbol: sym, targetPercent: v, condition, recurring });
    } else if (kind === 'volumeSpike') {
      onAdd({ kind: 'volumeSpike', symbol: sym, targetMultiplier: v, recurring });
    } else {
      const p = parseInt(rsiPeriod, 10);
      onAdd({ kind: 'rsi', symbol: sym, targetLevel: v, period: isNaN(p) || p < 2 ? 14 : p, condition, recurring });
    }
    showToast(t('toast.alertCreated'), 'success');
    setSymbol('');
    setValue('');
  }

  function describeAlert(alert: PriceAlert): string {
    if (alert.kind === 'percentChange') {
      // targetPercent is stored as a positive magnitude; 'below' means
      // "fell by at least X%", so display the negated threshold (see useAlerts).
      const dir = alert.condition === 'above' ? '≥' : '≤';
      const threshold =
        alert.condition === 'above'
          ? Math.abs(alert.targetPercent ?? 0)
          : -Math.abs(alert.targetPercent ?? 0);
      return `${de ? 'Tagesänderung' : 'daily change'} ${dir} ${threshold}%`;
    }
    if (alert.kind === 'volumeSpike') {
      return `${de ? 'Volumen ≥' : 'volume ≥'} ${alert.targetMultiplier}× ${de ? 'Ø' : 'avg'}`;
    }
    if (alert.kind === 'rsi') {
      const dir = alert.condition === 'above' ? '≥' : '≤';
      return `RSI(${alert.period ?? 14}) ${dir} ${alert.targetLevel}`;
    }
    if (alert.kind === 'trendlineCross') {
      const arrow = alert.condition === 'above' ? '↑' : '↓';
      return `${de ? 'kreuzt Trendlinie' : 'crosses trend line'} ${arrow}`;
    }
    return `${alert.condition === 'above' ? (de ? 'über' : 'above') : (de ? 'unter' : 'below')} ${fp(alert.targetPrice ?? 0)}`;
  }

  function alertIcon(alert: PriceAlert) {
    if (alert.kind === 'trendlineCross') return <TrendingUp className="w-3.5 h-3.5 text-accent" />;
    if (alert.kind === 'rsi') return <Activity className="w-3.5 h-3.5 text-accent" />;
    if (alert.kind === 'volumeSpike') return <BarChart3 className="w-3.5 h-3.5 text-accent" />;
    if (alert.kind === 'percentChange') {
      return alert.condition === 'above'
        ? <Percent className="w-3.5 h-3.5 text-success" />
        : <Percent className="w-3.5 h-3.5 text-danger" />;
    }
    return alert.condition === 'above'
      ? <ArrowUp className="w-3.5 h-3.5 text-success" />
      : <ArrowDown className="w-3.5 h-3.5 text-danger" />;
  }

  function valueLabel(): string {
    if (kind === 'price') return de ? 'Kurs' : 'Price';
    if (kind === 'percentChange') return '%';
    if (kind === 'rsi') return de ? 'RSI-Level' : 'RSI level';
    return de ? 'Faktor (z.B. 2)' : 'Factor (e.g. 2)';
  }

  function valuePlaceholder(): string {
    if (kind === 'price') return '150.00';
    if (kind === 'percentChange') return '5';
    if (kind === 'rsi') return '70';
    return '2';
  }

  const glassStyle: React.CSSProperties = {
    background: 'var(--glass-bg)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid var(--glass-border)',
  };

  const showCondition = kind !== 'volumeSpike';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-backdrop-in"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-depth-lg w-full max-w-lg animate-scale-in max-h-[85vh] flex flex-col overflow-hidden"
        style={glassStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--glass-border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <Bell className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-lg font-bold text-txt-primary tracking-tight">
              {de ? 'Kursalarme' : 'Alerts'}
            </h2>
            {activeAlerts.length > 0 && (
              <span className="text-xs bg-accent/15 text-accent px-2.5 py-0.5 rounded-full font-semibold">
                {activeAlerts.length} {de ? 'aktiv' : 'active'}
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
        <form onSubmit={handleSubmit} className="px-5 py-4 border-b space-y-3" style={{ borderColor: 'var(--glass-border)' }}>
          {/* Kind selector */}
          <div>
            <label className="text-[10px] text-txt-muted uppercase tracking-wider font-medium mb-1.5 block">
              {de ? 'Alarmtyp' : 'Alert type'}
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {CREATABLE_KINDS.map((k) => {
                const meta = KIND_META[k];
                const Icon = meta.icon;
                const active = kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium transition-all duration-200 ${
                      active
                        ? 'bg-accent/15 border-accent/40 text-accent'
                        : 'border-border/10 text-txt-secondary hover:border-border/30'
                    }`}
                    style={!active ? { background: 'var(--glass-bg)' } : {}}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {de ? meta.de : meta.en}
                  </button>
                );
              })}
            </div>
          </div>

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
            {showCondition && (
              <div className="w-24">
                <label className="text-[10px] text-txt-muted uppercase tracking-wider font-medium">
                  {de ? 'Bedingung' : 'Condition'}
                </label>
                <select
                  value={condition}
                  onChange={(e) => setCondition(e.target.value as 'above' | 'below')}
                  className="input w-full text-sm mt-1"
                >
                  <option value="above">{de ? 'Über' : 'Above'}</option>
                  <option value="below">{de ? 'Unter' : 'Below'}</option>
                </select>
              </div>
            )}
            <div className="flex-1">
              <label className="text-[10px] text-txt-muted uppercase tracking-wider font-medium">
                {valueLabel()}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={valuePlaceholder()}
                className="input w-full text-sm mt-1"
              />
            </div>
            {kind === 'rsi' && (
              <div className="w-20">
                <label className="text-[10px] text-txt-muted uppercase tracking-wider font-medium">
                  {de ? 'Periode' : 'Period'}
                </label>
                <input
                  type="number"
                  min="2"
                  step="1"
                  value={rsiPeriod}
                  onChange={(e) => setRsiPeriod(e.target.value)}
                  placeholder="14"
                  className="input w-full text-sm mt-1"
                />
              </div>
            )}
            <button
              type="submit"
              className="btn-primary flex items-center gap-1.5 shrink-0 px-3.5 py-2.5"
              disabled={!symbol.trim() || !value}
            >
              <Plus className="w-4 h-4" />
              {de ? 'Alarm' : 'Alert'}
            </button>
          </div>

          {/* Recurring toggle */}
          <button
            type="button"
            onClick={() => setRecurring((r) => !r)}
            className="flex items-center gap-2 text-left group"
          >
            <span
              className={`flex items-center justify-center w-4 h-4 rounded border transition-all duration-200 ${
                recurring ? 'bg-accent border-accent' : 'border-border/40 group-hover:border-border/70'
              }`}
            >
              {recurring && <Check className="w-3 h-3 text-white" />}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-txt-secondary">
              <Repeat className="w-3.5 h-3.5 text-txt-muted" />
              {de ? 'Wiederkehrend (erneut auslösen)' : 'Recurring (re-arm after firing)'}
            </span>
          </button>

          <p className="text-[10px] text-txt-muted leading-snug">
            {kind === 'price' && (de
              ? 'Wird ausgelöst, wenn der Kurs den Schwellwert über- bzw. unterschreitet.'
              : 'Triggers when the price crosses the threshold.')}
            {kind === 'percentChange' && (de
              ? 'Wird ausgelöst, wenn die Tagesveränderung den Schwellwert erreicht (z.B. 5 = ±5% am Tag).'
              : 'Triggers when daily change crosses the threshold (e.g. 5 = ±5% on the day).')}
            {kind === 'volumeSpike' && (de
              ? 'Wird ausgelöst, wenn das aktuelle Volumen das durchschnittliche um den Faktor übersteigt.'
              : 'Triggers when current volume exceeds the average by the given factor.')}
            {kind === 'rsi' && (de
              ? 'Wird ausgelöst, wenn der RSI (Tageskerzen) das Level über- bzw. unterschreitet. Wird im Hintergrund ca. minütlich geprüft.'
              : 'Triggers when the RSI (daily) crosses the level. Evaluated in the background roughly every minute.')}
          </p>
        </form>

        {/* Alert list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
          {activeAlerts.length === 0 && triggeredAlerts.length === 0 && (
            <div className="text-center text-sm text-txt-secondary py-10">
              <Bell className="w-10 h-10 text-txt-muted/20 mx-auto mb-3" />
              {de ? 'Keine Alarme gesetzt.' : 'No alerts set.'}
              <br />
              <span className="text-txt-muted text-xs mt-1 block">
                {de
                  ? 'Erstelle einen Alarm um bei Kursänderungen benachrichtigt zu werden.'
                  : 'Create an alert to get notified on price changes.'}
              </span>
            </div>
          )}

          {/* Active alerts */}
          {activeAlerts.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold mb-2.5">
                {de ? 'Aktive Alarme' : 'Active alerts'} ({activeAlerts.length})
              </h3>
              {activeAlerts.map((alert) => {
                const paused = alert.enabled === false;
                return (
                <div
                  key={alert.id}
                  className={`flex items-center justify-between py-2.5 px-3.5 rounded-xl mb-1.5 transition-all duration-200 hover:bg-dark-600/20 ${paused ? 'opacity-50' : ''}`}
                  style={{ background: 'rgba(var(--color-bg-700), 0.3)' }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="p-1 rounded-lg bg-dark-700/30 shrink-0">
                      {alertIcon(alert)}
                    </div>
                    <span className="font-mono font-bold text-sm text-txt-primary shrink-0">
                      {alert.symbol}
                    </span>
                    <span className="text-xs text-txt-secondary truncate">
                      {describeAlert(alert)}
                    </span>
                    {alert.recurring && (
                      <span className="shrink-0 flex items-center gap-1 text-[9px] text-accent bg-accent/10 px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide">
                        <Repeat className="w-2.5 h-2.5" />
                        {de ? 'wdh.' : 'rec.'}
                      </span>
                    )}
                    {paused && (
                      <span className="shrink-0 text-[9px] text-warning bg-warning/10 px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide">
                        {de ? 'pausiert' : 'paused'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onToggle(alert.id)}
                      className="p-1.5 hover:bg-dark-600/50 rounded-lg transition-all duration-200"
                      title={paused ? (de ? 'Fortsetzen' : 'Resume') : (de ? 'Pausieren' : 'Pause')}
                    >
                      {paused
                        ? <Play className="w-3.5 h-3.5 text-success" />
                        : <Pause className="w-3.5 h-3.5 text-txt-muted" />}
                    </button>
                    <button
                      onClick={() => onRemove(alert.id)}
                      className="p-1.5 hover:bg-danger/20 rounded-lg transition-all duration-200"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-danger" />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}

          {/* Triggered alerts */}
          {triggeredAlerts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
                  {de ? 'Ausgelöst' : 'Triggered'} ({triggeredAlerts.length})
                </h3>
                <button
                  onClick={onClearTriggered}
                  className="text-[10px] text-txt-muted hover:text-danger transition-colors"
                >
                  {de ? 'Alle löschen' : 'Clear all'}
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
                    <span className="text-xs text-txt-secondary line-through">
                      {describeAlert(alert)}
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
          {de
            ? 'Alarme werden bei jedem Quote-Refresh (alle 30s) geprüft.'
            : 'Alerts are checked on every quote refresh (every 30s).'}
        </div>
      </div>
    </div>
  );
}
