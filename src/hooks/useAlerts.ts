import { useState, useEffect, useCallback, useRef } from 'react';
import { formatPrice } from '../formatters';

export type AlertKind = 'price' | 'percentChange' | 'volumeSpike' | 'rsi' | 'trendlineCross';

/** A point on a drawn trend line: unix seconds + price. */
export interface LinePoint {
  t: number;
  price: number;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  kind: AlertKind;
  /** For kind='price': target price level */
  targetPrice?: number;
  /** For kind='percentChange': absolute percent threshold (e.g. 5 means ±5%). Compared against daily change %. */
  targetPercent?: number;
  /** For kind='volumeSpike': multiplier of average volume (e.g. 2 = 2x). */
  targetMultiplier?: number;
  /** For kind='rsi': the RSI level (0-100) to cross. */
  targetLevel?: number;
  /** For kind='rsi': RSI look-back period (default 14). */
  period?: number;
  /** For kind='trendlineCross': the two anchor points of the drawn line. */
  linePoints?: LinePoint[];
  /** For kind='trendlineCross': a short human label for the line (e.g. its color). */
  lineLabel?: string;
  /** For 'price', 'percentChange', 'rsi' & 'trendlineCross': direction.
   *  'volumeSpike' ignores this. */
  condition: 'above' | 'below';
  createdAt: number;
  triggered: boolean;
  triggeredAt?: number;
  /** When false the alert is paused (kept but not evaluated). Defaults true. */
  enabled: boolean;
  /** When true the alert re-arms after firing (edge-triggered, fires again
   *  once the condition clears and is met anew). Defaults false. */
  recurring: boolean;
}

export type AddAlertInput =
  | { kind: 'price'; symbol: string; targetPrice: number; condition: 'above' | 'below'; recurring?: boolean }
  | { kind: 'percentChange'; symbol: string; targetPercent: number; condition: 'above' | 'below'; recurring?: boolean }
  | { kind: 'volumeSpike'; symbol: string; targetMultiplier: number; recurring?: boolean }
  | { kind: 'rsi'; symbol: string; targetLevel: number; period?: number; condition: 'above' | 'below'; recurring?: boolean }
  | { kind: 'trendlineCross'; symbol: string; linePoints: LinePoint[]; condition: 'above' | 'below'; lineLabel?: string; recurring?: boolean };

interface QuoteForAlert {
  regularMarketPrice: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  averageVolume?: number;
  // Yahoo's real average-volume fields (no plain `averageVolume` is returned)
  averageDailyVolume3Month?: number;
  averageDailyVolume10Day?: number;
  currency?: string;
}

/** Optional computed metrics (e.g. RSI) keyed by symbol, supplied by the
 *  background indicator-alert evaluator. */
export interface AlertMetrics {
  rsi?: number;
}

const ALERTS_KEY = 'stockanalyzer_alerts';

function loadAlerts(): PriceAlert[] {
  try {
    const stored = localStorage.getItem(ALERTS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    // Backward-compat: fill in fields added after the alert was saved.
    return parsed.map((a: PriceAlert) => ({
      ...a,
      kind: a.kind ?? 'price',
      enabled: a.enabled ?? true,
      recurring: a.recurring ?? false,
    }));
  } catch {
    return [];
  }
}

function saveAlerts(alerts: PriceAlert[]) {
  localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
}

/** Extrapolate the price level of a drawn trend line at a given unix time. */
export function lineValueAt(points: LinePoint[] | undefined, tNow: number): number | null {
  if (!points || points.length < 2) return null;
  const [a, b] = points;
  if (b.t === a.t) return b.price;
  const slope = (b.price - a.price) / (b.t - a.t);
  return a.price + slope * (tNow - a.t);
}

function describeAlert(alert: PriceAlert, locale: 'de' | 'en', currency = 'USD'): string {
  const de = locale === 'de';
  if (alert.kind === 'percentChange') {
    const dir = alert.condition === 'above' ? '≥' : '≤';
    return de
      ? `${alert.symbol} Tagesänderung ${dir} ${alert.targetPercent}%`
      : `${alert.symbol} daily change ${dir} ${alert.targetPercent}%`;
  }
  if (alert.kind === 'volumeSpike') {
    return de
      ? `${alert.symbol} Volumen ≥ ${alert.targetMultiplier}× Ø`
      : `${alert.symbol} volume ≥ ${alert.targetMultiplier}× avg`;
  }
  if (alert.kind === 'rsi') {
    const dir = alert.condition === 'above' ? '≥' : '≤';
    return de
      ? `${alert.symbol} RSI(${alert.period ?? 14}) ${dir} ${alert.targetLevel}`
      : `${alert.symbol} RSI(${alert.period ?? 14}) ${dir} ${alert.targetLevel}`;
  }
  if (alert.kind === 'trendlineCross') {
    const arrow = alert.condition === 'above' ? '↑' : '↓';
    return de
      ? `${alert.symbol} kreuzt Trendlinie ${arrow}`
      : `${alert.symbol} crosses trend line ${arrow}`;
  }
  const word = alert.condition === 'above' ? (de ? 'über' : 'above') : (de ? 'unter' : 'below');
  return `${alert.symbol} ${word} ${formatPrice(alert.targetPrice ?? 0, currency, locale)}`;
}

export function useAlerts() {
  const [alerts, setAlerts] = useState<PriceAlert[]>(loadAlerts);
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    saveAlerts(alerts);
  }, [alerts]);

  // Request notification permission on first use
  useEffect(() => {
    if (alerts.length > 0 && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [alerts.length]);

  const addAlert = useCallback((input: AddAlertInput): PriceAlert => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const base = {
      id,
      symbol: input.symbol.toUpperCase(),
      createdAt: Date.now(),
      triggered: false,
      enabled: true,
      recurring: input.recurring ?? false,
    } as const;

    let alert: PriceAlert;
    if (input.kind === 'price') {
      alert = { ...base, kind: 'price', targetPrice: input.targetPrice, condition: input.condition };
    } else if (input.kind === 'percentChange') {
      alert = {
        ...base,
        kind: 'percentChange',
        targetPercent: input.targetPercent,
        condition: input.condition,
      };
    } else if (input.kind === 'volumeSpike') {
      alert = {
        ...base,
        kind: 'volumeSpike',
        targetMultiplier: input.targetMultiplier,
        condition: 'above',
      };
    } else if (input.kind === 'rsi') {
      alert = {
        ...base,
        kind: 'rsi',
        targetLevel: input.targetLevel,
        period: input.period ?? 14,
        condition: input.condition,
      };
    } else {
      alert = {
        ...base,
        kind: 'trendlineCross',
        linePoints: input.linePoints,
        lineLabel: input.lineLabel,
        condition: input.condition,
      };
    }
    setAlerts((prev) => [...prev, alert]);
    return alert;
  }, []);

  const removeAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    notifiedRef.current.delete(id);
  }, []);

  const toggleAlert = useCallback((id: string) => {
    // Clear any armed-notification state so re-enabling fires cleanly.
    notifiedRef.current.delete(id);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)));
  }, []);

  const clearTriggered = useCallback(() => {
    setAlerts((prev) => prev.filter((a) => !a.triggered));
  }, []);

  const checkAlerts = useCallback(
    (
      quotes: Record<string, QuoteForAlert>,
      locale: 'de' | 'en' = 'de',
      metrics: Record<string, AlertMetrics> = {},
    ) => {
      setAlerts((prev) => {
        let changed = false;
        const updated = prev.map((alert) => {
          if (alert.enabled === false) return alert;        // paused
          if (alert.triggered && !alert.recurring) return alert; // one-shot already fired
          const quote = quotes[alert.symbol];
          if (!quote) return alert;

          let isTriggered = false;

          if (alert.kind === 'price' && alert.targetPrice != null) {
            const price = quote.regularMarketPrice;
            isTriggered =
              (alert.condition === 'above' && price >= alert.targetPrice) ||
              (alert.condition === 'below' && price <= alert.targetPrice);
          } else if (alert.kind === 'percentChange' && alert.targetPercent != null) {
            const pct = quote.regularMarketChangePercent;
            if (pct != null && !isNaN(pct)) {
              isTriggered =
                (alert.condition === 'above' && pct >= alert.targetPercent) ||
                (alert.condition === 'below' && pct <= alert.targetPercent);
            }
          } else if (alert.kind === 'volumeSpike' && alert.targetMultiplier != null) {
            const vol = quote.regularMarketVolume;
            const avg = quote.averageVolume ?? quote.averageDailyVolume3Month ?? quote.averageDailyVolume10Day;
            if (vol != null && avg != null && avg > 0) {
              isTriggered = vol >= avg * alert.targetMultiplier;
            }
          } else if (alert.kind === 'rsi' && alert.targetLevel != null) {
            const rsi = metrics[alert.symbol]?.rsi;
            if (rsi != null && !isNaN(rsi)) {
              isTriggered =
                (alert.condition === 'above' && rsi >= alert.targetLevel) ||
                (alert.condition === 'below' && rsi <= alert.targetLevel);
            }
          } else if (alert.kind === 'trendlineCross' && alert.linePoints) {
            const target = lineValueAt(alert.linePoints, Date.now() / 1000);
            if (target != null) {
              const price = quote.regularMarketPrice;
              isTriggered =
                (alert.condition === 'above' && price >= target) ||
                (alert.condition === 'below' && price <= target);
            }
          }

          if (isTriggered) {
            // Fire the notification only once per "arm" (edge-triggered).
            if (notifiedRef.current.has(alert.id)) return alert;
            notifiedRef.current.add(alert.id);

            const title = locale === 'de' ? `Kursalarm: ${alert.symbol}` : `Alert: ${alert.symbol}`;
            const ccy = quote.currency || 'USD';
            const body = describeAlert(alert, locale, ccy) +
              `\n${locale === 'de' ? 'Aktueller Kurs' : 'Current price'}: ${formatPrice(quote.regularMarketPrice, ccy, locale)}`;

            const electronAPI = (window as unknown as { electronAPI?: { showNotification?: (t: string, b: string) => void } }).electronAPI;
            if (electronAPI?.showNotification) {
              electronAPI.showNotification(title, body);
            } else if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(title, {
                body,
                icon: '/favicon.ico',
                tag: alert.id,
              });
            }

            changed = true;
            // Recurring alerts stay active and re-arm once the condition clears;
            // one-shot alerts move to the "triggered" list.
            return alert.recurring
              ? { ...alert, triggeredAt: Date.now() }
              : { ...alert, triggered: true, triggeredAt: Date.now() };
          }

          // Condition not met → re-arm a recurring alert so it can fire again.
          if (alert.recurring && notifiedRef.current.has(alert.id)) {
            notifiedRef.current.delete(alert.id);
          }
          return alert;
        });
        return changed ? updated : prev;
      });
    },
    []
  );

  const activeAlerts = alerts.filter((a) => !a.triggered);
  const triggeredAlerts = alerts.filter((a) => a.triggered);

  return {
    alerts,
    activeAlerts,
    triggeredAlerts,
    addAlert,
    removeAlert,
    toggleAlert,
    clearTriggered,
    checkAlerts,
  };
}
