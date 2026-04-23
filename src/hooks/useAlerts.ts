import { useState, useEffect, useCallback, useRef } from 'react';
import { formatPrice } from '../formatters';

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: 'above' | 'below';
  createdAt: number;
  triggered: boolean;
  triggeredAt?: number;
}

const ALERTS_KEY = 'stockanalyzer_alerts';

function loadAlerts(): PriceAlert[] {
  try {
    const stored = localStorage.getItem(ALERTS_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return [];
}

function saveAlerts(alerts: PriceAlert[]) {
  localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
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

  const addAlert = useCallback((symbol: string, targetPrice: number, condition: 'above' | 'below') => {
    const newAlert: PriceAlert = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      symbol: symbol.toUpperCase(),
      targetPrice,
      condition,
      createdAt: Date.now(),
      triggered: false,
    };
    setAlerts((prev) => [...prev, newAlert]);
    return newAlert;
  }, []);

  const removeAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    notifiedRef.current.delete(id);
  }, []);

  const clearTriggered = useCallback(() => {
    setAlerts((prev) => prev.filter((a) => !a.triggered));
  }, []);

  const checkAlerts = useCallback((quotes: Record<string, { regularMarketPrice: number }>, locale: 'de' | 'en' = 'de') => {
    setAlerts((prev) => {
      let changed = false;
      const updated = prev.map((alert) => {
        if (alert.triggered) return alert;
        const quote = quotes[alert.symbol];
        if (!quote) return alert;

        const price = quote.regularMarketPrice;
        const isTriggered =
          (alert.condition === 'above' && price >= alert.targetPrice) ||
          (alert.condition === 'below' && price <= alert.targetPrice);

        if (isTriggered) {
          changed = true;

          // Send notification (only once per alert)
          if (!notifiedRef.current.has(alert.id)) {
            notifiedRef.current.add(alert.id);
            const direction = alert.condition === 'above' ? '\u2191' : '\u2193';
            const title = `Kursalarm: ${alert.symbol}`;
            const body = `${alert.symbol} ist ${alert.condition === 'above' ? 'über' : 'unter'} ${formatPrice(alert.targetPrice, 'USD', locale)} ${direction}\nAktueller Kurs: ${formatPrice(price, 'USD', locale)}`;

            // Prefer native Electron notification (works when minimized)
            const electronAPI = (window as any).electronAPI;
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
  }, []);

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
