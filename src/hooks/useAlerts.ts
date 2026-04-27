import { useState, useEffect, useCallback, useRef } from 'react';
import { formatPrice } from '../formatters';

export type AlertKind = 'price' | 'percentChange' | 'volumeSpike';

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
  /** For 'price' & 'percentChange': direction. 'volumeSpike' ignores this. */
  condition: 'above' | 'below';
  createdAt: number;
  triggered: boolean;
  triggeredAt?: number;
}

export type AddAlertInput =
  | { kind: 'price'; symbol: string; targetPrice: number; condition: 'above' | 'below' }
  | { kind: 'percentChange'; symbol: string; targetPercent: number; condition: 'above' | 'below' }
  | { kind: 'volumeSpike'; symbol: string; targetMultiplier: number };

interface QuoteForAlert {
  regularMarketPrice: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
  averageVolume?: number;
}

const ALERTS_KEY = 'stockanalyzer_alerts';

function loadAlerts(): PriceAlert[] {
  try {
    const stored = localStorage.getItem(ALERTS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    // Backward-compat: alerts saved before kind existed → treat as 'price'
    return parsed.map((a: PriceAlert) => ({
      ...a,
      kind: a.kind ?? 'price',
    }));
  } catch {
    return [];
  }
}

function saveAlerts(alerts: PriceAlert[]) {
  localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
}

function describeAlert(alert: PriceAlert, locale: 'de' | 'en'): string {
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
  const word = alert.condition === 'above' ? (de ? 'über' : 'above') : (de ? 'unter' : 'below');
  return `${alert.symbol} ${word} ${formatPrice(alert.targetPrice ?? 0, 'USD', locale)}`;
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
    } else {
      alert = {
        ...base,
        kind: 'volumeSpike',
        targetMultiplier: input.targetMultiplier,
        condition: 'above',
      };
    }
    setAlerts((prev) => [...prev, alert]);
    return alert;
  }, []);

  const removeAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    notifiedRef.current.delete(id);
  }, []);

  const clearTriggered = useCallback(() => {
    setAlerts((prev) => prev.filter((a) => !a.triggered));
  }, []);

  const checkAlerts = useCallback(
    (quotes: Record<string, QuoteForAlert>, locale: 'de' | 'en' = 'de') => {
      setAlerts((prev) => {
        let changed = false;
        const updated = prev.map((alert) => {
          if (alert.triggered) return alert;
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
            const avg = quote.averageVolume;
            if (vol != null && avg != null && avg > 0) {
              isTriggered = vol >= avg * alert.targetMultiplier;
            }
          }

          if (isTriggered) {
            changed = true;
            if (!notifiedRef.current.has(alert.id)) {
              notifiedRef.current.add(alert.id);
              const title = locale === 'de' ? `Kursalarm: ${alert.symbol}` : `Alert: ${alert.symbol}`;
              const body = describeAlert(alert, locale) +
                `\n${locale === 'de' ? 'Aktueller Kurs' : 'Current price'}: ${formatPrice(quote.regularMarketPrice, 'USD', locale)}`;

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
            }
            return { ...alert, triggered: true, triggeredAt: Date.now() };
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
    clearTriggered,
    checkAlerts,
  };
}
