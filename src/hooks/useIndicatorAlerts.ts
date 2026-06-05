import { useEffect, useRef } from 'react';
import { fetchChart, fetchQuotes } from '../api';
import { calculateRSI } from '../indicators';
import type { PriceAlert, AlertMetrics } from './useAlerts';

type CheckFn = (
  quotes: Record<string, any>,
  locale: 'de' | 'en',
  metrics: Record<string, AlertMetrics>,
) => void;

// ---------------------------------------------------------------------------
// Background evaluator for indicator-based alerts (currently RSI).
// The regular alert loop in the sidebar only has live quotes; RSI must be
// computed from chart data, so this hook periodically fetches the charts for
// symbols that have an active RSI alert, computes the value, and feeds it into
// the shared checkAlerts() routine via its `metrics` argument.
// ---------------------------------------------------------------------------

export function useIndicatorAlerts(
  alerts: PriceAlert[],
  checkAlerts: CheckFn,
  locale: 'de' | 'en',
) {
  const runningRef = useRef(false);

  useEffect(() => {
    // Active (not paused, not one-shot-fired) RSI alerts only.
    const rsiAlerts = alerts.filter(
      (a) => a.kind === 'rsi' && a.enabled !== false && (!a.triggered || a.recurring),
    );
    if (!rsiAlerts.length) return;

    async function evaluate() {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        // Group symbols by RSI period so each gets its own calculation.
        const byPeriod = new Map<number, Set<string>>();
        for (const a of rsiAlerts) {
          const p = a.period ?? 14;
          if (!byPeriod.has(p)) byPeriod.set(p, new Set());
          byPeriod.get(p)!.add(a.symbol);
        }

        for (const [period, symbolSet] of byPeriod) {
          const symbols = [...symbolSet];
          const metrics: Record<string, AlertMetrics> = {};
          const quoteMap: Record<string, any> = {};

          // Quotes (for the notification body + the symbol-present guard).
          try {
            const quotes = await fetchQuotes(symbols);
            for (const q of quotes) if (q?.symbol) quoteMap[q.symbol] = q;
          } catch {}

          // RSI per symbol from 6 months of daily closes.
          await Promise.all(
            symbols.map(async (sym) => {
              try {
                const { quotes } = await fetchChart(sym, '6mo', '1d');
                const closes = quotes.map((c) => c.close).filter((v) => v != null && !isNaN(v));
                if (closes.length < period + 2) return;
                const rsi = calculateRSI(closes, period);
                if (rsi.length) metrics[sym] = { rsi: rsi[rsi.length - 1] };
              } catch {}
            }),
          );

          if (Object.keys(metrics).length) {
            checkAlerts(quoteMap, locale, metrics);
          }
        }
      } finally {
        runningRef.current = false;
      }
    }

    evaluate();
    const id = setInterval(evaluate, 60_000);
    return () => clearInterval(id);
    // Re-subscribe when the set of RSI alerts changes (ids/enabled/period).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    alerts
      .filter((a) => a.kind === 'rsi')
      .map((a) => `${a.id}:${a.enabled}:${a.triggered}:${a.period}:${a.targetLevel}:${a.condition}`)
      .join('|'),
    locale,
  ]);
}
