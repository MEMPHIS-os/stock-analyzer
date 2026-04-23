import { useEffect, useRef, useCallback } from 'react';
import type { ToastType } from '../context';

// ─── Market Schedule Definitions ───

interface MarketSchedule {
  name: string;
  nameEn: string;
  timezone: string;
  openHour: number;
  openMinute: number;
  /** Weekdays only (1=Mon ... 5=Fri) */
}

const MARKETS: MarketSchedule[] = [
  { name: 'NYSE', nameEn: 'NYSE', timezone: 'America/New_York', openHour: 9, openMinute: 30 },
  { name: 'NASDAQ', nameEn: 'NASDAQ', timezone: 'America/New_York', openHour: 9, openMinute: 30 },
  { name: 'Frankfurt (XETRA)', nameEn: 'Frankfurt (XETRA)', timezone: 'Europe/Berlin', openHour: 9, openMinute: 0 },
  { name: 'London (LSE)', nameEn: 'London (LSE)', timezone: 'Europe/London', openHour: 8, openMinute: 0 },
  { name: 'Tokyo (TSE)', nameEn: 'Tokyo (TSE)', timezone: 'Asia/Tokyo', openHour: 9, openMinute: 0 },
  { name: 'Hong Kong (HKEX)', nameEn: 'Hong Kong (HKEX)', timezone: 'Asia/Hong_Kong', openHour: 9, openMinute: 30 },
];

const STORAGE_KEY = 'stockanalyzer_market_alerts';
const ALERT_MINUTES = [10, 5]; // Alert at these minutes before open

function isWeekday(date: Date, timezone: string): boolean {
  // Get the day of week in the market's timezone
  const dayStr = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: timezone });
  return !['Sat', 'Sun'].includes(dayStr);
}

function getMinutesUntilOpen(now: Date, market: MarketSchedule): number {
  // Get current time in the market's timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: market.timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);

  const nowMinutes = hour * 60 + minute;
  const openMinutes = market.openHour * 60 + market.openMinute;

  return openMinutes - nowMinutes;
}

export function loadMarketAlertsEnabled(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== 'false'; // Default: enabled
  } catch {
    return true;
  }
}

export function setMarketAlertsEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
}

// ─── Hook ───

export function useMarketAlerts(
  showToast: (message: string, type?: ToastType, duration?: number) => void,
  locale: 'de' | 'en',
  enabled: boolean = true
): void {
  const notifiedRef = useRef<Set<string>>(new Set());
  const lastDateRef = useRef<string>('');

  const checkMarkets = useCallback(() => {
    if (!enabled) return;

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

    // Reset notified set at midnight
    if (todayStr !== lastDateRef.current) {
      notifiedRef.current.clear();
      lastDateRef.current = todayStr;
    }

    for (const market of MARKETS) {
      // Skip weekends in the market's timezone
      if (!isWeekday(now, market.timezone)) continue;

      const minutesUntil = getMinutesUntilOpen(now, market);

      for (const alertMinutes of ALERT_MINUTES) {
        // Check if we're within the alert window (±1 minute tolerance for the 60s interval)
        if (minutesUntil >= alertMinutes - 0.5 && minutesUntil <= alertMinutes + 0.5) {
          const key = `${market.name}-${todayStr}-${alertMinutes}`;
          if (!notifiedRef.current.has(key)) {
            notifiedRef.current.add(key);

            const message =
              locale === 'de'
                ? `🔔 ${market.name} öffnet in ${alertMinutes} Minuten`
                : `🔔 ${market.nameEn} opens in ${alertMinutes} minutes`;

            showToast(message, 'info', 6000);
          }
        }
      }
    }
  }, [showToast, locale, enabled]);

  useEffect(() => {
    if (!enabled) return;

    // Check immediately on mount
    checkMarkets();

    // Then check every 60 seconds
    const iv = setInterval(checkMarkets, 60_000);
    return () => clearInterval(iv);
  }, [checkMarkets, enabled]);
}
