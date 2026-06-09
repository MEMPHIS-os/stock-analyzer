import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase,
  Plus,
  TrendingUp,
  TrendingDown,
  Trash2,
  DollarSign,
  PieChart,
  Download,
  Upload,
  LineChart,
  ShieldAlert,
  Coins,
  CalendarClock,
  Layers,
} from 'lucide-react';

import { usePortfolio } from '../hooks/usePortfolio';
import { buildTransactionsCSV, parseTransactionsCSV } from '../utils/portfolioCsv';
import { useApp } from '../context';
import { fetchQuotes, fetchChart, searchSymbols, fetchFundamentals } from '../api';
import { formatPercent, formatLargeNumber, formatPrice } from '../formatters';
import { usePrice } from '../hooks/usePrice';
import { Price } from '../components/Price';

import type { SearchResult, TimeRange, ChartInterval } from '../types';

// Mapped quote for easy consumption
interface PortfolioQuote {
  price: number;
  change: number | null;
  changePercent: number | null;
  currency: string;
  quoteType?: string;      // EQUITY | ETF | CRYPTOCURRENCY | ...
  dividendRate?: number;   // annual dividend per share, native currency
  dividendDate?: number;   // next payment, epoch seconds
}

// Risk analysis metrics
interface RiskMetrics {
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  valueAtRisk: number;   // 95% 1-day VaR as percentage
  beta: number;
  annualVolatility: number;
  loading: boolean;
}

const INITIAL_RISK_METRICS: RiskMetrics = {
  sharpeRatio: 0,
  sortinoRatio: 0,
  maxDrawdown: 0,
  maxDrawdownPercent: 0,
  valueAtRisk: 0,
  beta: 0,
  annualVolatility: 0,
  loading: true,
};

// ---------------------------------------------------------------------------
// Value-over-time range selector (1D / 1W / 1M / 1Y / 5Y / All time)
// ---------------------------------------------------------------------------

type ValueRangeKey = '1d' | '1w' | '1mo' | '1y' | '5y' | 'max';

const VALUE_RANGES: {
  key: ValueRangeKey;
  de: string;
  en: string;
  range: TimeRange;
  interval: ChartInterval;
}[] = [
  { key: '1d',  de: '1T',  en: '1D',  range: '1d',  interval: '5m'  },
  { key: '1w',  de: '1W',  en: '1W',  range: '5d',  interval: '15m' },
  { key: '1mo', de: '1M',  en: '1M',  range: '1mo', interval: '1d'  },
  { key: '1y',  de: '1J',  en: '1Y',  range: '1y',  interval: '1d'  },
  { key: '5y',  de: '5J',  en: '5Y',  range: '5y',  interval: '1wk' },
  { key: 'max', de: 'Max', en: 'Max', range: 'max', interval: '1mo' },
];

// Benchmark presets for the value-over-time comparison line.
const BENCHMARKS: { key: string; label: string; symbol: string | null }[] = [
  { key: 'sp500',  label: 'S&P 500',     symbol: '^GSPC'  },
  { key: 'nasdaq', label: 'Nasdaq 100',  symbol: '^NDX'   },
  { key: 'world',  label: 'MSCI World',  symbol: 'URTH'   },
  { key: 'dax',    label: 'DAX',         symbol: '^GDAXI' },
  { key: 'none',   label: '—',           symbol: null     },
];

// ---------------------------------------------------------------------------
// Colour palette for the donut chart
// ---------------------------------------------------------------------------

const DONUT_COLORS = [
  '#6366f1', // indigo
  '#22d3ee', // cyan
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#3b82f6', // blue
];

// ---------------------------------------------------------------------------
// Helper – build SVG donut segments
// ---------------------------------------------------------------------------

interface DonutSegment {
  symbol: string;
  weight: number;
  color: string;
}

function buildDonutPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = {
    x: cx + r * Math.cos(startAngle),
    y: cy + r * Math.sin(startAngle),
  };
  const end = {
    x: cx + r * Math.cos(endAngle),
    y: cy + r * Math.sin(endAngle),
  };
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  return [
    `M ${start.x} ${start.y}`,
    `A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`,
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Value-over-time area chart (current holdings valued across the past year)
// ---------------------------------------------------------------------------

function ValueChart({
  series,
  positive,
  benchmark,
  dates,
  currency,
  locale,
  intraday,
  benchmarkLabel,
}: {
  series: number[];
  positive: boolean;
  /** Optional benchmark series, normalised to the same start value & timeline. */
  benchmark?: number[] | null;
  /** Unix-ms timestamp per point (same length as series) for the hover tooltip. */
  dates?: number[];
  currency: string;
  locale: 'de' | 'en';
  intraday?: boolean;
  benchmarkLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  if (series.length < 2) return null;

  const W = 800;
  const H = 200;
  const PAD = 4;
  const hasBench = !!benchmark && benchmark.length === series.length;
  // Shared scale so portfolio and benchmark are visually comparable.
  const all = hasBench ? series.concat(benchmark as number[]) : series;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;
  const xOf = (i: number, n: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);
  const yOf = (v: number) => PAD + (1 - (v - min) / range) * (H - 2 * PAD);
  const toLine = (s: number[]) => s.map((v, i) => `${xOf(i, s.length).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const line = toLine(series);
  const area = `${PAD},${H - PAD} ${line} ${W - PAD},${H - PAD}`;
  const color = positive ? '#26a69a' : '#ef5350';
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => PAD + f * (H - 2 * PAD));

  const onMove = (e: React.MouseEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (series.length - 1)));
  };

  const hi = hover != null && hover >= 0 && hover < series.length ? hover : null;
  const xFrac = hi != null ? hi / (series.length - 1) : 0;
  const pYFrac = hi != null ? yOf(series[hi]) / H : 0;
  const fmtDate = (t: number) => {
    const loc = locale === 'de' ? 'de-DE' : 'en-US';
    const d = new Date(t);
    return intraday
      ? d.toLocaleString(loc, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(loc, { day: '2-digit', month: 'short', year: 'numeric' });
  };

  return (
    <div ref={wrapRef} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-44">
        <defs>
          <linearGradient id="pf-value-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {grid.map((y, i) => (
          <line
            key={i}
            x1="0"
            x2={W}
            y1={y}
            y2={y}
            stroke="rgb(var(--color-border))"
            strokeOpacity="0.3"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polygon points={area} fill="url(#pf-value-fill)" />
        {hasBench && (
          <polyline
            points={toLine(benchmark as number[])}
            fill="none"
            stroke="#94a3b8"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity="0.85"
          />
        )}
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {hi != null && (
          <line
            x1={xOf(hi, series.length)}
            x2={xOf(hi, series.length)}
            y1="0"
            y2={H}
            stroke={color}
            strokeOpacity="0.45"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* Hover marker (HTML element to avoid SVG non-uniform-scaling distortion) */}
      {hi != null && (
        <span
          className="absolute w-2.5 h-2.5 rounded-full ring-2 ring-dark-800 pointer-events-none -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${xFrac * 100}%`, top: `${pYFrac * 100}%`, background: color }}
        />
      )}

      {/* Tooltip */}
      {hi != null && (
        <div
          className="absolute z-10 top-0 pointer-events-none bg-dark-800/95 ring-1 ring-border/20 rounded-lg px-2.5 py-1.5 text-xs shadow-depth backdrop-blur-sm whitespace-nowrap"
          style={{
            left: `${xFrac * 100}%`,
            transform: `translateX(${xFrac > 0.5 ? 'calc(-100% - 8px)' : '8px'})`,
          }}
        >
          {dates && dates[hi] != null && <div className="text-txt-muted mb-0.5">{fmtDate(dates[hi])}</div>}
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-0.5 rounded-full" style={{ background: color }} />
            <span className="font-mono font-semibold text-txt-primary">{formatPrice(series[hi], currency, locale)}</span>
          </div>
          {hasBench && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-block w-2 border-t border-dashed border-[#94a3b8]" />
              <span className="text-txt-secondary">{benchmarkLabel}</span>
              <span className="font-mono text-txt-secondary">{formatPrice((benchmark as number[])[hi], currency, locale)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Portfolio() {
  const navigate = useNavigate();
  const { locale, convertPrice, showToast } = useApp();
  const de = locale === 'de';
  const { fp } = usePrice();
  const {
    holdings,
    transactions,
    addTransaction,
    importTransactions,
    removeHolding,
    clearAll,
    realizedBySymbol,
  } = usePortfolio();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // -----------------------------------------------------------------------
  // Live quotes
  // -----------------------------------------------------------------------

  const [quotes, setQuotes] = useState<Record<string, PortfolioQuote>>({});
  const [quotesLoading, setQuotesLoading] = useState(false);

  // Historical daily closes per symbol over a common 1y timeline (for the
  // value-over-time chart). Populated by the risk-analysis effect below, which
  // already fetches this data — avoids a second round-trip.
  // Selected range + benchmark for the value-over-time chart, plus the raw
  // per-symbol closes fetched for that range (kept separate from the 1y risk
  // analysis). benchPts holds the benchmark's closes on the same timeline.
  const [valueRange, setValueRange] = useState<ValueRangeKey>('1y');
  const [benchKey, setBenchKey] = useState<string>('sp500');
  const [rangeSeries, setRangeSeries] = useState<{
    perSym: { symbol: string; pts: { t: number; close: number }[] }[];
    benchPts: { t: number; close: number }[] | null;
    loading: boolean;
  }>({ perSym: [], benchPts: null, loading: true });

  const symbols = useMemo(
    () => holdings.map((h) => h.symbol),
    [holdings],
  );

  // The value chart only needs each symbol's CURRENCY from `quotes` (static per
  // symbol), not the live price. Depend on a currency signature so the 30s
  // quote refresh doesn't needlessly recompute the historical series; read the
  // actual currency through a ref to avoid a stale closure.
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  const ccySig = useMemo(
    () => symbols.map((s) => quotes[s]?.currency || 'USD').join('|'),
    [symbols, quotes],
  );

  useEffect(() => {
    if (symbols.length === 0) {
      setQuotes({});
      return;
    }

    let cancelled = false;

    const load = async () => {
      setQuotesLoading(true);
      try {
        const data = await fetchQuotes(symbols);
        if (!cancelled) {
          const map: Record<string, PortfolioQuote> = {};
          for (const q of data) {
            map[q.symbol] = {
              price: q.regularMarketPrice,
              change: q.regularMarketChange,
              changePercent: q.regularMarketChangePercent,
              currency: q.currency || 'USD',
              quoteType: q.quoteType,
              dividendRate: q.trailingAnnualDividendRate,
              dividendDate: q.dividendDate,
            };
          }
          setQuotes(map);
        }
      } catch {
        // ignore – keep stale data
      } finally {
        if (!cancelled) setQuotesLoading(false);
      }
    };

    load();

    // Refresh every 30s
    const interval = setInterval(load, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbols]);

  // -----------------------------------------------------------------------
  // Derived metrics
  // -----------------------------------------------------------------------

  // Value every holding in a common display currency via convertPrice (USD↔EUR).
  // A holding's native currency is its quote's listing currency; both the live
  // price and the cost basis (avgPrice) are denominated in it.
  const { totalValue, investedValue, dayChange, displayCcy } = useMemo(() => {
    let tv = 0, iv = 0, dc = 0;
    let ccy: string | null = null;
    let mixed = false;
    for (const h of holdings) {
      const q = quotes[h.symbol];
      const cur = q?.currency || 'USD';
      const price = q?.price ?? h.avgPrice;
      const mv = convertPrice(h.shares * price, cur);
      const cost = convertPrice(h.shares * h.avgPrice, cur);
      const chg = convertPrice(h.shares * (q?.change ?? 0), cur);
      tv += mv.value;
      iv += cost.value;
      dc += chg.value;
      if (ccy === null) ccy = mv.currency;
      else if (ccy !== mv.currency) mixed = true;
    }
    return { totalValue: tv, investedValue: iv, dayChange: dc, displayCcy: mixed ? 'USD' : (ccy ?? 'USD') };
  }, [holdings, quotes, convertPrice]);

  const totalPnl = totalValue - investedValue;
  const totalPnlPercent = investedValue > 0 ? totalPnl / investedValue : 0;

  const dayChangePercent = useMemo(() => {
    const prevValue = totalValue - dayChange;
    return prevValue !== 0 ? dayChange / prevValue : 0;
  }, [totalValue, dayChange]);

  // Realized P&L: sum each symbol's realized gain, converted from its native
  // (quote) currency into the display currency.
  const realizedPnl = useMemo(() => {
    let sum = 0;
    for (const [sym, val] of Object.entries(realizedBySymbol)) {
      const cur = quotes[sym]?.currency || 'USD';
      sum += convertPrice(val, cur).value;
    }
    return sum;
  }, [realizedBySymbol, quotes, convertPrice]);

  // Fetch historical closes for the selected range. Keyed only on symbols +
  // range, so the 30s quote refresh doesn't trigger a refetch (server caches
  // each range/interval anyway).
  useEffect(() => {
    if (symbols.length === 0) {
      setRangeSeries({ perSym: [], benchPts: null, loading: false });
      return;
    }
    const cfg = VALUE_RANGES.find((r) => r.key === valueRange) ?? VALUE_RANGES[3];
    const benchSymbol = BENCHMARKS.find((b) => b.key === benchKey)?.symbol ?? null;
    let cancelled = false;
    setRangeSeries((prev) => ({ ...prev, loading: true }));

    const toPts = (quotes: { date: string | number; close: number }[] | undefined) =>
      (quotes ?? [])
        .map((q) => ({
          t: typeof q.date === 'number' ? q.date * 1000 : Date.parse(String(q.date)),
          close: q.close as number,
        }))
        .filter((p) => isFinite(p.t) && p.close != null && isFinite(p.close))
        .sort((a, b) => a.t - b.t);

    (async () => {
      try {
        const [charts, bench] = await Promise.all([
          Promise.all(symbols.map((s) => fetchChart(s, cfg.range, cfg.interval).catch(() => null))),
          benchSymbol
            ? fetchChart(benchSymbol, cfg.range, cfg.interval).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const perSym = symbols.map((s, i) => ({ symbol: s, pts: toPts(charts[i]?.quotes) }));
        const benchPts = bench ? toPts(bench.quotes) : null;
        setRangeSeries({ perSym, benchPts, loading: false });
      } catch {
        if (!cancelled) setRangeSeries({ perSym: [], benchPts: null, loading: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbols, valueRange, benchKey]);

  // Build the portfolio value series over the selected range: at each point in
  // time, value the current holdings at the last-known close of each symbol
  // (forward-filled so holidays and differing market hours don't punch holes),
  // converted to the display currency. The opening value is back-filled so
  // every holding contributes from the first data point.
  const chartData = useMemo<{ portfolio: number[]; benchmark: number[] | null; dates: number[] }>(() => {
    const { perSym, benchPts } = rangeSeries;
    if (perSym.length === 0 || holdings.length === 0) return { portfolio: [], benchmark: null, dates: [] };
    const sharesMap = new Map(holdings.map((h) => [h.symbol, h.shares]));
    const allT = Array.from(new Set(perSym.flatMap((p) => p.pts.map((x) => x.t)))).sort(
      (a, b) => a - b,
    );
    if (allT.length < 2) return { portfolio: [], benchmark: null, dates: [] };

    const idx = perSym.map(() => 0);
    const lastClose = perSym.map((p) => (p.pts.length ? p.pts[0].close : null));
    // Benchmark forward-fill state (only when a benchmark is loaded).
    const hasBench = !!benchPts && benchPts.length > 1;
    let bIdx = 0;
    let bLast: number | null = hasBench ? benchPts![0].close : null;
    const portfolio: number[] = [];
    const dates: number[] = [];
    const benchRaw: number[] = [];

    for (const t of allT) {
      let v = 0;
      let any = false;
      perSym.forEach((p, j) => {
        while (idx[j] < p.pts.length && p.pts[idx[j]].t <= t) {
          lastClose[j] = p.pts[idx[j]].close;
          idx[j]++;
        }
        const shares = sharesMap.get(p.symbol);
        const close = lastClose[j];
        if (close != null && shares != null) {
          const cur = quotesRef.current[p.symbol]?.currency || 'USD';
          v += convertPrice(shares * close, cur).value;
          any = true;
        }
      });
      if (!any) continue;
      portfolio.push(v);
      dates.push(t);
      if (hasBench) {
        while (bIdx < benchPts!.length && benchPts![bIdx].t <= t) {
          bLast = benchPts![bIdx].close;
          bIdx++;
        }
        benchRaw.push(bLast ?? benchPts![0].close);
      }
    }

    // Normalise the benchmark to the portfolio's starting value so both lines
    // begin at the same point ("same capital invested in the index").
    let benchmark: number[] | null = null;
    if (hasBench && portfolio.length > 1 && benchRaw.length === portfolio.length) {
      const base = benchRaw[0];
      const start = portfolio[0];
      if (base > 0 && start > 0) {
        benchmark = benchRaw.map((c) => start * (c / base));
      }
    }
    return { portfolio, benchmark, dates };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeSeries, holdings, ccySig, convertPrice]);

  const valueSeries = chartData.portfolio;
  const benchmarkSeries = chartData.benchmark;

  const pctReturn = (s: number[]) => {
    if (s.length < 2 || s[0] <= 0) return null;
    return (s[s.length - 1] - s[0]) / s[0];
  };

  const periodReturn = useMemo(() => {
    const pct = pctReturn(valueSeries);
    if (pct == null) return null;
    return { abs: valueSeries[valueSeries.length - 1] - valueSeries[0], pct };
  }, [valueSeries]);

  const benchmarkReturn = useMemo(() => (benchmarkSeries ? pctReturn(benchmarkSeries) : null), [benchmarkSeries]);
  const benchmarkLabel = BENCHMARKS.find((b) => b.key === benchKey)?.label ?? '';

  // Dividend tracking: per-holding forward annual income (converted to the
  // display currency), yield, and yield-on-cost. Only dividend payers appear.
  const dividends = useMemo(() => {
    const rows = holdings
      .map((h) => {
        const q = quotes[h.symbol];
        const rate = q?.dividendRate; // native annual dividend per share
        if (!rate || rate <= 0) return null;
        const cur = q?.currency || 'USD';
        const price = q?.price ?? h.avgPrice;
        const income = convertPrice(h.shares * rate, cur).value;
        return {
          symbol: h.symbol,
          name: h.name,
          rate,
          currency: cur,
          income,
          currentYield: price > 0 ? rate / price : 0,
          yieldOnCost: h.avgPrice > 0 ? rate / h.avgPrice : 0,
          nextDate: q?.dividendDate ?? null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.income - a.income);
    const totalIncome = rows.reduce((s, r) => s + r.income, 0);
    return { rows, totalIncome };
  }, [holdings, quotes, convertPrice]);

  // Estimated income per calendar month (Jan–Dec). Quarterly schedule is
  // assumed (the standard for most payers); each holding's payments are
  // anchored at the month of its next known dividend date, then every 3 months.
  // Approximate by design — clearly labelled as an estimate in the UI.
  const monthlyDividends = useMemo(() => {
    const months = new Array(12).fill(0) as number[];
    for (const r of dividends.rows) {
      const perPayment = r.income / 4;
      const start = r.nextDate ? new Date(r.nextDate * 1000).getMonth() : 0;
      for (let k = 0; k < 4; k++) months[(start + k * 3) % 12] += perPayment;
    }
    return months;
  }, [dividends.rows]);

  // -----------------------------------------------------------------------
  // Donut chart data
  // -----------------------------------------------------------------------

  const donutSegments: DonutSegment[] = useMemo(() => {
    if (totalValue === 0) return [];
    return holdings.map((h, i) => {
      const q = quotes[h.symbol];
      const price = q?.price ?? h.avgPrice;
      const marketValue = convertPrice(h.shares * price, q?.currency || 'USD').value;
      return {
        symbol: h.symbol,
        weight: marketValue / totalValue,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      };
    });
  }, [holdings, quotes, totalValue, convertPrice]);

  // -----------------------------------------------------------------------
  // Detailed allocation: sector / region / country & asset class via profiles
  // -----------------------------------------------------------------------

  const [profiles, setProfiles] = useState<
    Record<string, { sector?: string; country?: string; category?: string }>
  >({});
  const [allocDim, setAllocDim] = useState<'class' | 'sector' | 'currency' | 'region'>('class');

  useEffect(() => {
    if (symbols.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        symbols.map(async (s) => {
          try {
            const f = await fetchFundamentals(s);
            return [
              s,
              {
                sector: f.summaryProfile?.sector,
                country: f.summaryProfile?.country,
                category: f.fundProfile?.categoryName,
              },
            ] as const;
          } catch {
            return [s, {}] as const;
          }
        }),
      );
      if (!cancelled) setProfiles(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [symbols]);

  const allocationBreakdown = useMemo(() => {
    if (holdings.length === 0 || totalValue === 0) return [];
    const na = de ? 'k.A.' : 'N/A';

    const labelFor = (symbol: string): string => {
      const q = quotes[symbol];
      const prof = profiles[symbol] || {};
      const qt = q?.quoteType;
      if (allocDim === 'currency') return q?.currency || 'USD';
      if (allocDim === 'class') {
        if (qt === 'CRYPTOCURRENCY') return de ? 'Krypto' : 'Crypto';
        if (qt === 'ETF' || qt === 'MUTUALFUND') {
          const c = (prof.category || '').toLowerCase();
          if (c.includes('bond') || c.includes('anleihe') || c.includes('fixed income'))
            return de ? 'Anleihen' : 'Bonds';
          return de ? 'ETF/Fonds' : 'ETF/Funds';
        }
        if (qt === 'EQUITY') return de ? 'Aktien' : 'Stocks';
        return de ? 'Sonstige' : 'Other';
      }
      if (allocDim === 'sector') {
        if (qt === 'CRYPTOCURRENCY') return de ? 'Krypto' : 'Crypto';
        if (qt === 'ETF' || qt === 'MUTUALFUND') return prof.category || (de ? 'ETF/Fonds' : 'ETF/Funds');
        return prof.sector || na;
      }
      // region (country of domicile / listing)
      if (qt === 'CRYPTOCURRENCY') return de ? 'Global' : 'Global';
      return prof.country || na;
    };

    const map = new Map<string, number>();
    for (const h of holdings) {
      const q = quotes[h.symbol];
      const price = q?.price ?? h.avgPrice;
      const mv = convertPrice(h.shares * price, q?.currency || 'USD').value;
      const key = labelFor(h.symbol);
      map.set(key, (map.get(key) ?? 0) + mv);
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value, pct: value / totalValue }))
      .sort((a, b) => b.value - a.value)
      .map((row, i) => ({ ...row, color: DONUT_COLORS[i % DONUT_COLORS.length] }));
  }, [holdings, quotes, profiles, allocDim, totalValue, convertPrice, de]);

  // -----------------------------------------------------------------------
  // Risk analysis
  // -----------------------------------------------------------------------

  const [riskMetrics, setRiskMetrics] = useState<RiskMetrics>(INITIAL_RISK_METRICS);

  useEffect(() => {
    if (holdings.length === 0) {
      setRiskMetrics({ ...INITIAL_RISK_METRICS, loading: false });
      return;
    }

    let cancelled = false;

    const computeRisk = async () => {
      setRiskMetrics((prev) => ({ ...prev, loading: true }));

      try {
        // Fetch 1y daily chart data for all holdings + S&P 500
        const allSymbols = [...symbols, '^GSPC'];
        const charts = await Promise.all(
          allSymbols.map((s) => fetchChart(s, '1y', '1d')),
        );

        if (cancelled) return;

        const spChart = charts[charts.length - 1]; // S&P 500
        const holdingCharts = charts.slice(0, -1);

        // Build a date-indexed map of closes for each holding
        // Use the S&P 500 dates as the reference timeline
        const spDates = spChart.quotes.map((q) => String(q.date));
        const spCloses: Record<string, number> = {};
        for (const q of spChart.quotes) {
          spCloses[String(q.date)] = q.close;
        }

        // Map holding closes by date
        const holdingClosesByDate: Record<string, number>[] = holdingCharts.map(
          (chart) => {
            const map: Record<string, number> = {};
            for (const q of chart.quotes) {
              map[String(q.date)] = q.close;
            }
            return map;
          },
        );

        // Find common dates where all holdings + S&P have data
        const commonDates = spDates.filter((d) =>
          holdingClosesByDate.every((hc) => hc[d] != null) && spCloses[d] != null
        );

        if (commonDates.length < 2) {
          setRiskMetrics({ ...INITIAL_RISK_METRICS, loading: false });
          return;
        }

        // Compute weights for each holding based on current value
        const weights = holdings.map((h) => {
          const q = quotes[h.symbol];
          const price = q?.price ?? h.avgPrice;
          return h.shares * price;
        });
        const totalW = weights.reduce((s, w) => s + w, 0);
        const normalizedWeights = totalW > 0 ? weights.map((w) => w / totalW) : weights.map(() => 1 / holdings.length);

        // Compute daily returns for portfolio and market
        const portfolioReturns: number[] = [];
        const marketReturns: number[] = [];

        for (let i = 1; i < commonDates.length; i++) {
          const today = commonDates[i];
          const yesterday = commonDates[i - 1];

          // Weighted portfolio return
          let portReturn = 0;
          for (let j = 0; j < holdings.length; j++) {
            const todayClose = holdingClosesByDate[j][today];
            const yesterdayClose = holdingClosesByDate[j][yesterday];
            if (yesterdayClose > 0) {
              portReturn += normalizedWeights[j] * ((todayClose - yesterdayClose) / yesterdayClose);
            }
          }
          portfolioReturns.push(portReturn);

          // Market return
          const mToday = spCloses[today];
          const mYesterday = spCloses[yesterday];
          if (mYesterday > 0) {
            marketReturns.push((mToday - mYesterday) / mYesterday);
          } else {
            marketReturns.push(0);
          }
        }

        const n = portfolioReturns.length;
        if (n < 2) {
          setRiskMetrics({ ...INITIAL_RISK_METRICS, loading: false });
          return;
        }

        // Mean daily return
        const meanReturn = portfolioReturns.reduce((s, r) => s + r, 0) / n;

        // Standard deviation
        const variance = portfolioReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (n - 1);
        const stdDev = Math.sqrt(variance);

        // Downside deviation (below risk-free daily rate)
        const rfDaily = 0.04 / 252; // ~0.000159
        const downsideSquares = portfolioReturns
          .filter((r) => r < rfDaily)
          .map((r) => (r - rfDaily) ** 2);
        const downsideDeviation = downsideSquares.length > 0
          ? Math.sqrt(downsideSquares.reduce((s, v) => s + v, 0) / (n - 1))
          : 0;

        // Annualized values
        const annualizedReturn = meanReturn * 252;
        const annualizedStdDev = stdDev * Math.sqrt(252);

        // Sharpe Ratio = (annualized return - risk-free rate) / annualized std dev
        const sharpeRatio = annualizedStdDev > 0
          ? (annualizedReturn - 0.04) / annualizedStdDev
          : 0;

        // Sortino Ratio = (annualized return - risk-free rate) / annualized downside dev
        const annualizedDownside = downsideDeviation * Math.sqrt(252);
        const sortinoRatio = annualizedDownside > 0
          ? (annualizedReturn - 0.04) / annualizedDownside
          : 0;

        // Max Drawdown
        let peak = 1;
        let maxDd = 0;
        let cumulativeValue = 1;
        for (const r of portfolioReturns) {
          cumulativeValue *= (1 + r);
          if (cumulativeValue > peak) peak = cumulativeValue;
          const dd = (peak - cumulativeValue) / peak;
          if (dd > maxDd) maxDd = dd;
        }

        // Value at Risk (95%, parametric) = -(mean - 1.645 * stddev) as a positive percentage
        const var95 = -(meanReturn - 1.645 * stdDev);

        // Beta = cov(portfolio, market) / var(market)
        const meanMarket = marketReturns.reduce((s, r) => s + r, 0) / marketReturns.length;
        let covariance = 0;
        let marketVariance = 0;
        for (let i = 0; i < n; i++) {
          covariance += (portfolioReturns[i] - meanReturn) * (marketReturns[i] - meanMarket);
          marketVariance += (marketReturns[i] - meanMarket) ** 2;
        }
        covariance /= (n - 1);
        marketVariance /= (n - 1);
        const beta = marketVariance > 0 ? covariance / marketVariance : 0;

        if (!cancelled) {
          setRiskMetrics({
            sharpeRatio,
            sortinoRatio,
            maxDrawdown: maxDd * totalValue, // absolute dollar amount
            maxDrawdownPercent: maxDd,
            valueAtRisk: var95,
            beta,
            annualVolatility: annualizedStdDev,
            loading: false,
          });
        }
      } catch {
        if (!cancelled) {
          setRiskMetrics({ ...INITIAL_RISK_METRICS, loading: false });
        }
      }
    };

    computeRisk();

    return () => {
      cancelled = true;
    };
  }, [holdings, symbols, quotes, totalValue]);

  // -----------------------------------------------------------------------
  // Transaction form state
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Drag & Drop from sidebar / search
  // -----------------------------------------------------------------------

  const [dropActive, setDropActive] = useState(false);
  const dropCounterRef = useRef(0);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/stock-symbol')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/stock-symbol')) {
      e.preventDefault();
      dropCounterRef.current++;
      setDropActive(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    dropCounterRef.current--;
    if (dropCounterRef.current <= 0) {
      dropCounterRef.current = 0;
      setDropActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dropCounterRef.current = 0;
    setDropActive(false);
    const raw = e.dataTransfer.getData('application/stock-symbol');
    if (!raw) return;
    try {
      const { symbol, name } = JSON.parse(raw);
      if (symbol) {
        setFormSymbol(symbol);
        setFormName(name || symbol);
        setFormType('buy');
        setFormOpen(true);
      }
    } catch {}
  }, []);

  const [formOpen, setFormOpen] = useState(false);
  const [formSymbol, setFormSymbol] = useState('');
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'buy' | 'sell'>('buy');
  const [formShares, setFormShares] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSymbolChange = useCallback((value: string) => {
    setFormSymbol(value);
    setFormName('');

    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (value.trim().length < 1) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }

    searchTimeout.current = setTimeout(async () => {
      try {
        const results = await searchSymbols(value.trim());
        setSearchResults(results);
        setSearchOpen(true);
      } catch {
        setSearchResults([]);
      }
    }, 300);
  }, []);

  const selectSearchResult = useCallback((result: SearchResult) => {
    setFormSymbol(result.symbol);
    setFormName(result.shortname ?? result.symbol);
    setSearchOpen(false);
    setSearchResults([]);
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const shares = parseFloat(formShares);
      const price = parseFloat(formPrice);
      if (!formSymbol || isNaN(shares) || shares <= 0 || isNaN(price) || price < 0) return;

      const name = formName || formSymbol.toUpperCase();
      addTransaction(formSymbol, name, formType, shares, price);

      // Reset form
      setFormSymbol('');
      setFormName('');
      setFormShares('');
      setFormPrice('');
      setFormType('buy');
    },
    [formSymbol, formName, formType, formShares, formPrice, addTransaction],
  );

  // -----------------------------------------------------------------------
  // CSV export / import
  // -----------------------------------------------------------------------

  const handleExport = useCallback(() => {
    if (transactions.length === 0) {
      showToast(de ? 'Keine Transaktionen zum Export.' : 'No transactions to export.', 'info');
      return;
    }
    const names: Record<string, string> = {};
    holdings.forEach((h) => { names[h.symbol] = h.name; });
    const csv = buildTransactionsCSV(transactions, names);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'portfolio-transaktionen.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(de ? 'Transaktionen exportiert.' : 'Transactions exported.', 'success');
  }, [transactions, holdings, showToast, de]);

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow re-importing the same file
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const { transactions: txs, names } = parseTransactionsCSV(String(reader.result || ''));
        if (txs.length === 0) {
          showToast(de ? 'Keine gültigen Transaktionen in der Datei.' : 'No valid transactions in file.', 'error');
          return;
        }
        importTransactions(txs, names);
        showToast(`${txs.length} ${de ? 'Transaktionen importiert' : 'transactions imported'}`, 'success');
      };
      reader.onerror = () => showToast(de ? 'Datei konnte nicht gelesen werden.' : 'Could not read file.', 'error');
      reader.readAsText(file);
    },
    [importTransactions, showToast, de],
  );

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const pnlColor = (value: number) =>
    value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-txt-muted';

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div
      className={`animate-fade-in space-y-6 p-4 md:p-6 relative ${dropActive ? 'ring-2 ring-accent ring-inset rounded-xl' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {dropActive && (
        <div className="absolute inset-0 bg-accent/5 border-2 border-dashed border-accent/40 rounded-xl z-10 flex items-center justify-center pointer-events-none">
          <div className="bg-dark-800/90 px-6 py-4 rounded-xl flex items-center gap-3 shadow-lg">
            <Download className="w-6 h-6 text-accent" />
            <span className="text-lg font-semibold text-txt-primary">{de ? 'Aktie ins Portfolio legen' : 'Drop stock into portfolio'}</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-accent/10">
            <Briefcase className="w-6 h-6 text-accent" />
          </div>
          <h1 className="section-title text-2xl">{de ? 'Portfolioübersicht' : 'Portfolio overview'}</h1>
        </div>
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40 transition-all duration-200 active:scale-[0.97]"
            title={de ? 'Transaktionen aus CSV importieren' : 'Import transactions from CSV'}
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Import</span>
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40 transition-all duration-200 active:scale-[0.97]"
            title={de ? 'Transaktionen als CSV exportieren' : 'Export transactions as CSV'}
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          {holdings.length > 0 && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-danger hover:bg-danger/10 transition-all duration-200 active:scale-[0.97]"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Alles löschen</span>
            </button>
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Summary cards                                                     */}
      {/* ----------------------------------------------------------------- */}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-children">
        {/* Gesamtwert */}
        <div className="card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <DollarSign className="w-4 h-4 text-accent" />
            </div>
            <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
              {de ? 'Gesamtwert' : 'Total value'}
            </span>
          </div>
          <p className="text-2xl font-bold text-txt-primary font-mono tabular-nums tracking-tight">
            <Price value={totalValue} currency={displayCcy} size={22} />
          </p>
        </div>

        {/* Investiert */}
        <div className="card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <Briefcase className="w-4 h-4 text-accent" />
            </div>
            <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
              {de ? 'Investiert' : 'Invested'}
            </span>
          </div>
          <p className="text-2xl font-bold text-txt-primary font-mono tabular-nums tracking-tight">
            <Price value={investedValue} currency={displayCcy} size={22} />
          </p>
        </div>

        {/* Gewinn / Verlust */}
        <div className="card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${totalPnl >= 0 ? 'bg-success/10' : 'bg-danger/10'}`}>
              {totalPnl >= 0 ? <TrendingUp className="w-4 h-4 text-success" /> : <TrendingDown className="w-4 h-4 text-danger" />}
            </div>
            <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
              {de ? 'Gewinn/Verlust' : 'Profit/Loss'}
            </span>
          </div>
          <p className={`text-2xl font-bold font-mono tabular-nums tracking-tight ${pnlColor(totalPnl)}`}>
            <Price value={totalPnl} currency={displayCcy} size={22} tone={totalPnl >= 0 ? 'positive' : 'negative'} />
          </p>
          <p className={`text-xs font-mono font-semibold ${pnlColor(totalPnl)}`}>{formatPercent(totalPnlPercent * 100)}</p>
        </div>

        {/* Tagesveränderung */}
        <div className="card p-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${dayChange >= 0 ? 'bg-success/10' : 'bg-danger/10'}`}>
              {dayChange >= 0 ? <TrendingUp className="w-4 h-4 text-success" /> : <TrendingDown className="w-4 h-4 text-danger" />}
            </div>
            <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
              {de ? 'Tagesveränderung' : 'Day change'}
            </span>
          </div>
          <p className={`text-2xl font-bold font-mono tabular-nums tracking-tight ${pnlColor(dayChange)}`}>
            <Price value={dayChange} currency={displayCcy} size={22} tone={dayChange >= 0 ? 'positive' : 'negative'} />
          </p>
          <p className={`text-xs font-mono font-semibold ${pnlColor(dayChange)}`}>{formatPercent(dayChangePercent * 100)}</p>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Value over time                                                   */}
      {/* ----------------------------------------------------------------- */}

      {holdings.length > 0 && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-accent/10">
                <LineChart className="w-5 h-5 text-accent" />
              </div>
              <h2 className="section-title text-lg">{de ? 'Wertentwicklung' : 'Performance'}</h2>
              <span className="text-[10px] text-txt-muted uppercase tracking-wider font-medium">
                {de ? 'aktuelle Bestände' : 'current holdings'}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {periodReturn && (
                <span
                  className={`text-sm font-mono font-semibold px-2.5 py-1 rounded-lg ${
                    periodReturn.pct >= 0 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                  }`}
                >
                  {formatPercent(periodReturn.pct * 100)}
                </span>
              )}
              {/* Time-range selector: 1D / 1W / 1M / 1Y / 5Y / All time */}
              <div className="flex items-center gap-0.5 bg-dark-700/40 rounded-lg p-0.5 ring-1 ring-border/5">
                {VALUE_RANGES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setValueRange(r.key)}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors duration-150 ${
                      valueRange === r.key
                        ? 'bg-accent text-white shadow-sm'
                        : 'text-txt-muted hover:text-txt-primary hover:bg-dark-600/40'
                    }`}
                  >
                    {de ? r.de : r.en}
                  </button>
                ))}
              </div>
              {/* Benchmark selector */}
              <select
                value={benchKey}
                onChange={(e) => setBenchKey(e.target.value)}
                title={de ? 'Vergleichsindex' : 'Benchmark'}
                className="bg-dark-700/40 ring-1 ring-border/5 rounded-lg px-2 py-1.5 text-xs font-semibold text-txt-secondary hover:text-txt-primary focus:outline-none focus:ring-accent/40 cursor-pointer"
              >
                {BENCHMARKS.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.symbol ? `vs ${b.label}` : de ? 'kein Vergleich' : 'no benchmark'}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {rangeSeries.loading && valueSeries.length === 0 ? (
            <div className="h-44 rounded-xl skeleton-shimmer" />
          ) : valueSeries.length >= 2 ? (
            <>
              <ValueChart
                series={valueSeries}
                positive={(periodReturn?.pct ?? 0) >= 0}
                benchmark={benchmarkSeries}
                dates={chartData.dates}
                currency={displayCcy}
                locale={locale}
                intraday={valueRange === '1d' || valueRange === '1w'}
                benchmarkLabel={benchmarkLabel}
              />
              {/* Legend + benchmark comparison */}
              {benchmarkReturn != null && periodReturn && (
                <div className="flex items-center justify-center gap-4 flex-wrap text-xs pt-1">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-0.5 rounded-full bg-accent" />
                    <span className="text-txt-secondary">{de ? 'Portfolio' : 'Portfolio'}</span>
                    <span className={`font-mono font-semibold ${pnlColor(periodReturn.pct)}`}>
                      {formatPercent(periodReturn.pct * 100)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 border-t border-dashed border-[#94a3b8]" />
                    <span className="text-txt-secondary">{benchmarkLabel}</span>
                    <span className={`font-mono font-semibold ${pnlColor(benchmarkReturn)}`}>
                      {formatPercent(benchmarkReturn * 100)}
                    </span>
                  </span>
                  <span
                    className={`font-mono font-semibold px-2 py-0.5 rounded-md ${
                      periodReturn.pct - benchmarkReturn >= 0
                        ? 'bg-success/10 text-success'
                        : 'bg-danger/10 text-danger'
                    }`}
                  >
                    {periodReturn.pct - benchmarkReturn >= 0 ? '▲' : '▼'}{' '}
                    {formatPercent(Math.abs(periodReturn.pct - benchmarkReturn) * 100)}{' '}
                    {de ? 'ggü. Index' : 'vs index'}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="h-44 flex items-center justify-center text-sm text-txt-muted">
              {de ? 'Nicht genügend Verlaufsdaten verfügbar.' : 'Not enough history available.'}
            </div>
          )}

          {/* Realized / unrealized / total P&L */}
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div className="bg-dark-700/40 rounded-xl p-3 ring-1 ring-border/5">
              <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold block">
                {de ? 'Realisiert' : 'Realized'}
              </span>
              <p className={`text-base font-bold font-mono tabular-nums mt-0.5 ${pnlColor(realizedPnl)}`}>
                <Price value={realizedPnl} currency={displayCcy} size={14} tone={realizedPnl >= 0 ? 'positive' : 'negative'} />
              </p>
            </div>
            <div className="bg-dark-700/40 rounded-xl p-3 ring-1 ring-border/5">
              <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold block">
                {de ? 'Unrealisiert' : 'Unrealized'}
              </span>
              <p className={`text-base font-bold font-mono tabular-nums mt-0.5 ${pnlColor(totalPnl)}`}>
                <Price value={totalPnl} currency={displayCcy} size={14} tone={totalPnl >= 0 ? 'positive' : 'negative'} />
              </p>
            </div>
            <div className="bg-dark-700/40 rounded-xl p-3 ring-1 ring-border/5">
              <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold block">
                {de ? 'Gesamt G/V' : 'Total P&L'}
              </span>
              <p className={`text-base font-bold font-mono tabular-nums mt-0.5 ${pnlColor(realizedPnl + totalPnl)}`}>
                <Price value={realizedPnl + totalPnl} currency={displayCcy} size={14} tone={realizedPnl + totalPnl >= 0 ? 'positive' : 'negative'} />
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Detailed allocation breakdown                                     */}
      {/* ----------------------------------------------------------------- */}

      {holdings.length > 0 && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-accent/10">
                <Layers className="w-5 h-5 text-accent" />
              </div>
              <h2 className="section-title text-lg">{de ? 'Allokation im Detail' : 'Allocation breakdown'}</h2>
            </div>
            <div className="flex items-center gap-0.5 bg-dark-700/40 rounded-lg p-0.5 ring-1 ring-border/5">
              {([
                ['class', de ? 'Anlageklasse' : 'Asset class'],
                ['sector', de ? 'Sektor' : 'Sector'],
                ['currency', de ? 'Währung' : 'Currency'],
                ['region', 'Region'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setAllocDim(key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors duration-150 ${
                    allocDim === key
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-txt-muted hover:text-txt-primary hover:bg-dark-600/40'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            {allocationBreakdown.map((row) => (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs gap-2">
                  <span className="flex items-center gap-2 text-txt-secondary truncate">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: row.color }} />
                    <span className="truncate">{row.label}</span>
                  </span>
                  <span className="font-mono text-txt-primary whitespace-nowrap tabular-nums">
                    {(row.pct * 100).toFixed(1)}% ·{' '}
                    <Price value={row.value} currency={displayCcy} size={11} />
                  </span>
                </div>
                <div className="h-2 rounded-full bg-dark-700/60 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${row.pct * 100}%`,
                      minWidth: row.pct > 0 ? '2px' : 0,
                      background: row.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Donut chart + Holdings table                                      */}
      {/* ----------------------------------------------------------------- */}

      {holdings.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Donut chart */}
          <div className="card p-5 flex flex-col items-center justify-center lg:col-span-1">
            <div className="flex items-center gap-2.5 mb-4 self-start">
              <div className="p-1.5 rounded-lg bg-accent/10">
                <PieChart className="w-5 h-5 text-accent" />
              </div>
              <h2 className="section-title text-lg">{de ? 'Allokation' : 'Allocation'}</h2>
            </div>

            <svg viewBox="0 0 200 200" className="w-48 h-48">
              {(() => {
                const cx = 100;
                const cy = 100;
                const r = 80;
                const strokeWidth = 28;
                let cumAngle = -Math.PI / 2; // start at top

                return donutSegments.map((seg) => {
                  const sliceAngle = seg.weight * 2 * Math.PI;
                  // Clamp to avoid full-circle edge case
                  const safeSlice = Math.min(sliceAngle, 2 * Math.PI - 0.001);
                  const startAngle = cumAngle;
                  const endAngle = cumAngle + safeSlice;
                  cumAngle += sliceAngle;

                  const path = buildDonutPath(cx, cy, r, startAngle, endAngle);

                  return (
                    <path
                      key={seg.symbol}
                      d={path}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                    />
                  );
                });
              })()}
              {/* Center label */}
              <text
                x="100"
                y="96"
                textAnchor="middle"
                className="fill-txt-primary text-sm font-bold"
                fontSize="14"
              >
                {formatLargeNumber(totalValue)}
              </text>
              <text
                x="100"
                y="114"
                textAnchor="middle"
                className="fill-txt-muted"
                fontSize="10"
              >
                {de ? 'Gesamtwert' : 'Total value'}
              </text>
            </svg>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap justify-center gap-2.5">
              {donutSegments.map((seg) => (
                <div key={seg.symbol} className="flex items-center gap-1.5 text-xs text-txt-secondary bg-dark-700/40 px-2 py-1 rounded-lg">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="font-mono font-medium text-txt-primary">{seg.symbol}</span>
                  <span className="font-mono tabular-nums text-txt-muted">{formatPercent(seg.weight * 100)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Holdings table */}
          <div className="card lg:col-span-2 overflow-hidden">
            <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
              <div className="p-1.5 rounded-lg bg-accent/10">
                <Briefcase className="w-5 h-5 text-accent" />
              </div>
              <h2 className="section-title text-lg">{de ? 'Bestände' : 'Holdings'}</h2>
            </div>

            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/10">
                  <th className="text-left px-5 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">{de ? 'Aktie' : 'Stock'}</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">{de ? 'Anteile' : 'Shares'}</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">{de ? 'Ø Preis' : 'Avg price'}</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">{de ? 'Kurs' : 'Price'}</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">{de ? 'Marktwert' : 'Market value'}</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">{de ? 'G/V' : 'P&L'}</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">{de ? 'G/V (%)' : 'P&L (%)'}</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">{de ? 'Gewicht' : 'Weight'}</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const q = quotes[h.symbol];
                  const cur = q?.currency || 'USD';
                  const currentPrice = q?.price ?? h.avgPrice;
                  const marketValue = h.shares * currentPrice;
                  const pnl = marketValue - h.shares * h.avgPrice;
                  const pnlPct =
                    h.avgPrice !== 0
                      ? (currentPrice - h.avgPrice) / h.avgPrice
                      : 0;
                  const weight = totalValue > 0 ? convertPrice(marketValue, cur).value / totalValue : 0;

                  return (
                    <tr
                      key={h.id}
                      className="border-b border-border/5 last:border-0 hover:bg-accent/[0.04] cursor-pointer transition-all duration-200 group"
                      onClick={() => navigate(`/stock/${h.symbol}`)}
                    >
                      <td className="px-5 py-3">
                        <span className="font-mono font-bold text-accent group-hover:text-accent-light transition-colors">
                          {h.symbol}
                        </span>
                        <span className="block text-[11px] text-txt-muted truncate max-w-[140px]">
                          {h.name}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-txt-secondary">
                        {h.shares}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-txt-secondary">
                        <Price value={h.avgPrice} currency={cur} size={12} flapClassName="justify-end" />
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-txt-primary">
                        {quotesLoading && !q ? '…' : <Price value={currentPrice} currency={cur} size={12} flapClassName="justify-end" />}
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-txt-primary font-medium">
                        <Price value={marketValue} currency={cur} size={12} flapClassName="justify-end" />
                      </td>
                      <td className={`px-3 py-3 text-right font-mono tabular-nums font-medium ${pnlColor(pnl)}`}>
                        <Price value={pnl} currency={cur} size={12} tone={pnl >= 0 ? 'positive' : 'negative'} flapClassName="justify-end" />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={`text-xs font-mono font-semibold ${pnlPct >= 0 ? 'badge-success' : 'badge-danger'}`}>
                          {formatPercent(pnlPct * 100)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums text-txt-muted">
                        {formatPercent(weight * 100)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          className="p-1.5 rounded-lg text-txt-muted hover:text-danger hover:bg-danger/10 transition-all duration-200"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeHolding(h.id);
                          }}
                          title={de ? 'Bestand entfernen' : 'Remove holding'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="card p-12 text-center space-y-3">
          <Briefcase className="w-12 h-12 mx-auto text-txt-muted/30" />
          <p className="text-txt-secondary">
            {de
              ? 'Noch keine Bestände vorhanden. Füge eine Transaktion hinzu, um zu beginnen.'
              : 'No holdings yet. Add a transaction to get started.'}
          </p>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Risiko-Analyse                                                    */}
      {/* ----------------------------------------------------------------- */}

      {holdings.length > 0 && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <ShieldAlert className="w-5 h-5 text-accent" />
            </div>
            <h2 className="section-title text-lg">{de ? 'Risiko-Analyse' : 'Risk analysis'}</h2>
          </div>

          {riskMetrics.loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl p-4 skeleton-shimmer h-[88px]"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {/* Sharpe Ratio */}
              <div className="bg-dark-700/40 rounded-xl p-4 ring-1 ring-border/5 hover:bg-dark-700/60 transition-colors duration-200">
                <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
                  Sharpe Ratio
                </span>
                <p
                  className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                    riskMetrics.sharpeRatio >= 1
                      ? 'text-success'
                      : riskMetrics.sharpeRatio >= 0
                        ? 'text-warning'
                        : 'text-danger'
                  }`}
                >
                  {riskMetrics.sharpeRatio.toFixed(2)}
                </p>
                <p className="text-[10px] text-txt-muted mt-1">
                  {de ? 'Risikobereinigte Rendite' : 'Risk-adjusted return'} ({'>'}1 = {de ? 'gut' : 'good'})
                </p>
              </div>

              {/* Sortino Ratio */}
              <div className="bg-dark-700/40 rounded-xl p-4 ring-1 ring-border/5 hover:bg-dark-700/60 transition-colors duration-200">
                <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
                  Sortino Ratio
                </span>
                <p
                  className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                    riskMetrics.sortinoRatio >= 1.5
                      ? 'text-success'
                      : riskMetrics.sortinoRatio >= 0
                        ? 'text-warning'
                        : 'text-danger'
                  }`}
                >
                  {riskMetrics.sortinoRatio.toFixed(2)}
                </p>
                <p className="text-[10px] text-txt-muted mt-1">
                  {de ? 'Abwärtsrisiko-bereinigte Rendite' : 'Downside-adjusted return'} ({'>'}1.5 = {de ? 'gut' : 'good'})
                </p>
              </div>

              {/* Max Drawdown */}
              <div className="bg-dark-700/40 rounded-xl p-4 ring-1 ring-border/5 hover:bg-dark-700/60 transition-colors duration-200">
                <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
                  Max Drawdown
                </span>
                <p
                  className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                    riskMetrics.maxDrawdownPercent <= 0.1
                      ? 'text-success'
                      : riskMetrics.maxDrawdownPercent <= 0.2
                        ? 'text-warning'
                        : 'text-danger'
                  }`}
                >
                  -{(riskMetrics.maxDrawdownPercent * 100).toFixed(2)}%
                </p>
                <p className="text-[10px] text-txt-muted mt-1">
                  {de ? 'Größter Rückgang vom Hoch' : 'Largest drop from peak'}
                </p>
              </div>

              {/* VaR (95%) */}
              <div className="bg-dark-700/40 rounded-xl p-4 ring-1 ring-border/5 hover:bg-dark-700/60 transition-colors duration-200">
                <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
                  VaR (95%)
                </span>
                <p
                  className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                    riskMetrics.valueAtRisk <= 0.02
                      ? 'text-success'
                      : riskMetrics.valueAtRisk <= 0.04
                        ? 'text-warning'
                        : 'text-danger'
                  }`}
                >
                  -{(riskMetrics.valueAtRisk * 100).toFixed(2)}%
                </p>
                <p className="text-[10px] text-txt-muted mt-1">
                  {de ? 'Max. Tagesverlust (95% Konf.)' : 'Max daily loss (95% conf.)'}
                </p>
              </div>

              {/* Beta */}
              <div className="bg-dark-700/40 rounded-xl p-4 ring-1 ring-border/5 hover:bg-dark-700/60 transition-colors duration-200">
                <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
                  Beta
                </span>
                <p
                  className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                    riskMetrics.beta >= 0.8 && riskMetrics.beta <= 1.2
                      ? 'text-success'
                      : riskMetrics.beta > 1.5 || riskMetrics.beta < 0
                        ? 'text-danger'
                        : 'text-warning'
                  }`}
                >
                  {riskMetrics.beta.toFixed(2)}
                </p>
                <p className="text-[10px] text-txt-muted mt-1">
                  {de ? 'Marktrisiko vs. S&P 500 (1 = Markt)' : 'Market risk vs S&P 500 (1 = market)'}
                </p>
              </div>

              {/* Volatilität */}
              <div className="bg-dark-700/40 rounded-xl p-4 ring-1 ring-border/5 hover:bg-dark-700/60 transition-colors duration-200">
                <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
                  {de ? 'Volatilität' : 'Volatility'}
                </span>
                <p
                  className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                    riskMetrics.annualVolatility <= 0.15
                      ? 'text-success'
                      : riskMetrics.annualVolatility <= 0.25
                        ? 'text-warning'
                        : 'text-danger'
                  }`}
                >
                  {(riskMetrics.annualVolatility * 100).toFixed(2)}%
                </p>
                <p className="text-[10px] text-txt-muted mt-1">
                  {de ? 'Annualisierte Schwankungsbreite' : 'Annualised volatility'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Dividenden                                                        */}
      {/* ----------------------------------------------------------------- */}

      {dividends.rows.length > 0 && (
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <Coins className="w-5 h-5 text-accent" />
            </div>
            <h2 className="section-title text-lg">{de ? 'Dividenden' : 'Dividends'}</h2>
          </div>

          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-dark-700/40 rounded-xl p-4 ring-1 ring-border/5">
              <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold block">
                {de ? 'Prognose Jahreseinkommen' : 'Projected annual income'}
              </span>
              <p className="text-xl font-bold font-mono tabular-nums mt-0.5 text-success">
                <Price value={dividends.totalIncome} currency={displayCcy} size={16} tone="positive" />
              </p>
            </div>
            <div className="bg-dark-700/40 rounded-xl p-4 ring-1 ring-border/5">
              <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold block">
                {de ? 'Ø Dividendenrendite' : 'Avg dividend yield'}
              </span>
              <p className="text-xl font-bold font-mono tabular-nums mt-0.5 text-txt-primary">
                {(totalValue > 0 ? (dividends.totalIncome / totalValue) * 100 : 0).toFixed(2)}%
              </p>
            </div>
            <div className="bg-dark-700/40 rounded-xl p-4 ring-1 ring-border/5">
              <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold block">
                Yield on Cost
              </span>
              <p className="text-xl font-bold font-mono tabular-nums mt-0.5 text-txt-primary">
                {(investedValue > 0 ? (dividends.totalIncome / investedValue) * 100 : 0).toFixed(2)}%
              </p>
            </div>
            <div className="bg-dark-700/40 rounded-xl p-4 ring-1 ring-border/5">
              <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold block">
                {de ? 'Ø pro Monat' : 'Avg per month'}
              </span>
              <p className="text-xl font-bold font-mono tabular-nums mt-0.5 text-success">
                <Price value={dividends.totalIncome / 12} currency={displayCcy} size={16} tone="positive" />
              </p>
            </div>
          </div>

          {/* Monthly distribution (estimated, quarterly schedule assumed) */}
          {(() => {
            const maxM = Math.max(...monthlyDividends, 1);
            const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
            const FULL = de
              ? ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
              : ['January','February','March','April','May','June','July','August','September','October','November','December'];
            return (
              <div className="bg-dark-700/40 rounded-xl p-4 ring-1 ring-border/5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
                    {de ? 'Ausschüttungen pro Monat' : 'Distributions per month'}
                  </span>
                  <span className="text-[10px] text-txt-muted italic">{de ? 'geschätzt · vierteljährlich angenommen' : 'estimated · quarterly assumed'}</span>
                </div>
                <div className="flex items-end justify-between gap-1.5 h-24">
                  {monthlyDividends.map((v, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 group" title={`${FULL[i]}: ${v.toFixed(0)} ${displayCcy === 'EUR' ? '€' : '$'}`}>
                      <div
                        className="w-full rounded-t bg-accent/70 group-hover:bg-accent transition-all duration-200 min-h-[2px]"
                        style={{ height: `${(v / maxM) * 100}%` }}
                      />
                      <span className="text-[9px] text-txt-muted font-mono">{MONTHS[i]}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Per-holding table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/10">
                  <th className="text-left px-3 py-2.5 text-xs text-txt-muted font-semibold uppercase tracking-wider">{de ? 'Aktie' : 'Stock'}</th>
                  <th className="text-right px-3 py-2.5 text-xs text-txt-muted font-semibold uppercase tracking-wider">{de ? 'Rendite' : 'Yield'}</th>
                  <th className="text-right px-3 py-2.5 text-xs text-txt-muted font-semibold uppercase tracking-wider">{de ? 'Div./Aktie' : 'Div./share'}</th>
                  <th className="text-right px-3 py-2.5 text-xs text-txt-muted font-semibold uppercase tracking-wider">{de ? 'Jahreseinkommen' : 'Annual income'}</th>
                  <th className="text-right px-3 py-2.5 text-xs text-txt-muted font-semibold uppercase tracking-wider">YoC</th>
                  <th className="text-right px-3 py-2.5 text-xs text-txt-muted font-semibold uppercase tracking-wider">{de ? 'Nächste Zahlung' : 'Next payment'}</th>
                </tr>
              </thead>
              <tbody>
                {dividends.rows.map((r) => (
                  <tr key={r.symbol} className="border-b border-border/5 last:border-0 hover:bg-accent/[0.04] transition-colors duration-200">
                    <td className="px-3 py-2.5">
                      <span className="font-mono font-bold text-accent">{r.symbol}</span>
                      <span className="block text-[11px] text-txt-muted truncate max-w-[160px]">{r.name}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-txt-secondary">
                      {(r.currentYield * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-txt-secondary">
                      <Price value={r.rate} currency={r.currency} size={12} flapClassName="justify-end" />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-success font-medium">
                      <Price value={r.income} currency={displayCcy} size={12} tone="positive" flapClassName="justify-end" />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-txt-secondary">
                      {(r.yieldOnCost * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-txt-muted font-mono tabular-nums">
                      {r.nextDate ? (
                        <span className="inline-flex items-center gap-1 justify-end">
                          <CalendarClock className="w-3 h-3" />
                          {new Date(r.nextDate * 1000).toLocaleDateString(de ? 'de-DE' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Add Transaction form (collapsible)                                */}
      {/* ----------------------------------------------------------------- */}

      <div className="card overflow-hidden">
        <button
          className="w-full flex items-center justify-between p-4 text-left hover:bg-dark-600/20 transition-colors duration-200"
          onClick={() => setFormOpen((o) => !o)}
        >
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <Plus className="w-5 h-5 text-accent" />
            </div>
            <span className="font-semibold text-txt-primary">
              {de ? 'Transaktion hinzufügen' : 'Add transaction'}
            </span>
          </div>
          <span
            className={`text-txt-muted transition-transform ${
              formOpen ? 'rotate-45' : ''
            }`}
          >
            <Plus className="w-5 h-5" />
          </span>
        </button>

        {formOpen && (
          <form
            onSubmit={handleSubmit}
            className="px-4 pb-5 space-y-4 animate-fade-in"
          >
            {/* Symbol search */}
            <div className="relative">
              <label className="block text-xs text-txt-muted mb-1">
                {de ? 'Aktie / Symbol' : 'Stock / symbol'}
              </label>
              <input
                className="input w-full"
                placeholder={de ? 'z.B. AAPL' : 'e.g. AAPL'}
                value={formSymbol}
                onChange={(e) => handleSymbolChange(e.target.value)}
                onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
              />

              {searchOpen && searchResults.length > 0 && (
                <ul className="absolute z-20 mt-1.5 w-full card border border-border/20 rounded-xl shadow-depth-lg max-h-48 overflow-y-auto py-1 animate-scale-in">
                  {searchResults.map((r) => (
                    <li
                      key={r.symbol}
                      className="px-3 py-2 hover:bg-dark-600/40 cursor-pointer text-sm flex justify-between transition-colors"
                      onMouseDown={() => selectSearchResult(r)}
                    >
                      <span className="font-mono font-bold text-accent">
                        {r.symbol}
                      </span>
                      <span className="text-txt-muted truncate ml-3 max-w-[60%]">
                        {r.shortname}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {formName && (
                <p className="text-xs text-txt-muted mt-0.5">{formName}</p>
              )}
            </div>

            {/* Buy / Sell toggle */}
            <div>
              <label className="block text-xs text-txt-muted mb-1">{de ? 'Typ' : 'Type'}</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    formType === 'buy'
                      ? 'bg-success/15 text-success ring-1 ring-success/25'
                      : 'bg-dark-700/60 text-txt-muted hover:text-txt-secondary ring-1 ring-border/10'
                  }`}
                  onClick={() => setFormType('buy')}
                >
                  {de ? 'Kauf' : 'Buy'}
                </button>
                <button
                  type="button"
                  className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
                    formType === 'sell'
                      ? 'bg-danger/15 text-danger ring-1 ring-danger/25'
                      : 'bg-dark-700/60 text-txt-muted hover:text-txt-secondary ring-1 ring-border/10'
                  }`}
                  onClick={() => setFormType('sell')}
                >
                  {de ? 'Verkauf' : 'Sell'}
                </button>
              </div>
            </div>

            {/* Shares + Price */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-txt-muted mb-1">
                  {de ? 'Anteile' : 'Shares'}
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="input w-full"
                  placeholder="0"
                  value={formShares}
                  onChange={(e) => setFormShares(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs text-txt-muted mb-1">
                  {de ? 'Preis' : 'Price'}
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="input w-full"
                  placeholder="0.00"
                  value={formPrice}
                  onChange={(e) => setFormPrice(e.target.value)}
                />
              </div>
            </div>

            <button type="submit" className="btn-primary w-full">
              <DollarSign className="w-4 h-4 inline-block mr-1" />
              {formType === 'buy' ? (de ? 'Kaufen' : 'Buy') : (de ? 'Verkaufen' : 'Sell')}
            </button>
          </form>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Recent Transactions                                               */}
      {/* ----------------------------------------------------------------- */}

      {transactions.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <DollarSign className="w-5 h-5 text-accent" />
            </div>
            <h2 className="section-title text-lg">{de ? 'Letzte Transaktionen' : 'Recent transactions'}</h2>
          </div>

          <ul className="space-y-1">
            {transactions.slice(0, 10).map((tx) => (
              <li
                key={tx.id}
                className="flex items-center justify-between py-2.5 px-2 -mx-2 rounded-lg border-b border-border/5 last:border-0 text-sm hover:bg-dark-600/20 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                      tx.type === 'buy'
                        ? 'bg-success/15 text-success'
                        : 'bg-danger/15 text-danger'
                    }`}
                  >
                    {tx.type === 'buy' ? (de ? 'Kauf' : 'Buy') : (de ? 'Verkauf' : 'Sell')}
                  </span>
                  <span className="font-mono font-bold text-accent">
                    {tx.symbol}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-txt-secondary font-mono tabular-nums">
                  <span>{tx.shares} {de ? 'Stk.' : 'sh.'}</span>
                  <span className="inline-flex items-center gap-1">@ <Price value={tx.price} currency="USD" size={11} /></span>
                  <span className="text-txt-muted text-xs">
                    {new Date(tx.date).toLocaleDateString(de ? 'de-DE' : 'en-US', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
