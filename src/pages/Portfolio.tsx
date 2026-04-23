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
  ShieldAlert,
} from 'lucide-react';

import { usePortfolio } from '../hooks/usePortfolio';
import { useApp } from '../context';
import { fetchQuotes, fetchChart, searchSymbols } from '../api';
import { formatPercent, formatLargeNumber } from '../formatters';
import { usePrice } from '../hooks/usePrice';

import type { SearchResult } from '../types';

// Mapped quote for easy consumption
interface PortfolioQuote {
  price: number;
  change: number | null;
  changePercent: number | null;
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
// Component
// ---------------------------------------------------------------------------

export default function Portfolio() {
  const navigate = useNavigate();
  const { locale } = useApp();
  const { fp } = usePrice();
  const {
    holdings,
    transactions,
    addTransaction,
    removeHolding,
    clearAll,
    totalInvested,
    getHolding,
  } = usePortfolio();

  // -----------------------------------------------------------------------
  // Live quotes
  // -----------------------------------------------------------------------

  const [quotes, setQuotes] = useState<Record<string, PortfolioQuote>>({});
  const [quotesLoading, setQuotesLoading] = useState(false);

  const symbols = useMemo(
    () => holdings.map((h) => h.symbol),
    [holdings],
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

  const totalValue = useMemo(() => {
    return holdings.reduce((sum, h) => {
      const q = quotes[h.symbol];
      const price = q?.price ?? h.avgPrice;
      return sum + h.shares * price;
    }, 0);
  }, [holdings, quotes]);

  const totalPnl = totalValue - totalInvested;
  const totalPnlPercent = totalInvested > 0 ? totalPnl / totalInvested : 0;

  const dayChange = useMemo(() => {
    return holdings.reduce((sum, h) => {
      const q = quotes[h.symbol];
      if (!q) return sum;
      return sum + h.shares * (q.change ?? 0);
    }, 0);
  }, [holdings, quotes]);

  const dayChangePercent = useMemo(() => {
    const prevValue = totalValue - dayChange;
    return prevValue !== 0 ? dayChange / prevValue : 0;
  }, [totalValue, dayChange]);

  // -----------------------------------------------------------------------
  // Donut chart data
  // -----------------------------------------------------------------------

  const donutSegments: DonutSegment[] = useMemo(() => {
    if (totalValue === 0) return [];
    return holdings.map((h, i) => {
      const q = quotes[h.symbol];
      const price = q?.price ?? h.avgPrice;
      const marketValue = h.shares * price;
      return {
        symbol: h.symbol,
        weight: marketValue / totalValue,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
      };
    });
  }, [holdings, quotes, totalValue]);

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
  // Render helpers
  // -----------------------------------------------------------------------

  const pnlColor = (value: number) =>
    value > 0 ? 'text-success' : value < 0 ? 'text-danger' : 'text-txt-muted';

  const pnlIcon = (value: number) =>
    value >= 0 ? (
      <TrendingUp className="w-4 h-4 inline-block mr-1" />
    ) : (
      <TrendingDown className="w-4 h-4 inline-block mr-1" />
    );

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
            <span className="text-lg font-semibold text-txt-primary">Aktie ins Portfolio legen</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Briefcase className="w-7 h-7 text-accent" />
          <h1 className="text-2xl font-bold text-txt-primary">
            Portfolioübersicht
          </h1>
        </div>
        {holdings.length > 0 && (
          <button
            onClick={clearAll}
            className="btn-ghost text-sm flex items-center gap-1 text-danger"
          >
            <Trash2 className="w-4 h-4" />
            Alles löschen
          </button>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Summary cards                                                     */}
      {/* ----------------------------------------------------------------- */}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Gesamtwert */}
        <div className="card bg-dark-800 p-4 space-y-1">
          <span className="text-xs text-txt-muted uppercase tracking-wide">
            Gesamtwert
          </span>
          <p className="text-xl font-bold text-txt-primary font-mono">
            {fp(totalValue, 'USD')}
          </p>
        </div>

        {/* Investiert */}
        <div className="card bg-dark-800 p-4 space-y-1">
          <span className="text-xs text-txt-muted uppercase tracking-wide">
            Investiert
          </span>
          <p className="text-xl font-bold text-txt-primary font-mono">
            {fp(totalInvested, 'USD')}
          </p>
        </div>

        {/* Gewinn / Verlust */}
        <div className="card bg-dark-800 p-4 space-y-1">
          <span className="text-xs text-txt-muted uppercase tracking-wide">
            Gewinn/Verlust
          </span>
          <p className={`text-xl font-bold font-mono ${pnlColor(totalPnl)}`}>
            {pnlIcon(totalPnl)}
            {fp(totalPnl, 'USD')} ({formatPercent(totalPnlPercent)})
          </p>
        </div>

        {/* Tagesveränderung */}
        <div className="card bg-dark-800 p-4 space-y-1">
          <span className="text-xs text-txt-muted uppercase tracking-wide">
            Tagesveränderung
          </span>
          <p className={`text-xl font-bold font-mono ${pnlColor(dayChange)}`}>
            {pnlIcon(dayChange)}
            {fp(dayChange, 'USD')} ({formatPercent(dayChangePercent)})
          </p>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Donut chart + Holdings table                                      */}
      {/* ----------------------------------------------------------------- */}

      {holdings.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Donut chart */}
          <div className="card bg-dark-800 p-5 flex flex-col items-center justify-center lg:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <PieChart className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold text-txt-primary">
                Allokation
              </h2>
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
                Gesamtwert
              </text>
            </svg>

            {/* Legend */}
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              {donutSegments.map((seg) => (
                <div key={seg.symbol} className="flex items-center gap-1.5 text-xs text-txt-secondary">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: seg.color }}
                  />
                  {seg.symbol} ({formatPercent(seg.weight)})
                </div>
              ))}
            </div>
          </div>

          {/* Holdings table */}
          <div className="card bg-dark-800 p-5 lg:col-span-2 overflow-x-auto">
            <h2 className="text-lg font-semibold text-txt-primary mb-4">
              Bestände
            </h2>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-txt-muted border-b border-dark-700">
                  <th className="pb-2 pr-3">Aktie</th>
                  <th className="pb-2 pr-3 text-right">Anteile</th>
                  <th className="pb-2 pr-3 text-right">Ø Preis</th>
                  <th className="pb-2 pr-3 text-right">Kurs</th>
                  <th className="pb-2 pr-3 text-right">Marktwert</th>
                  <th className="pb-2 pr-3 text-right">G/V</th>
                  <th className="pb-2 pr-3 text-right">G/V (%)</th>
                  <th className="pb-2 pr-3 text-right">Gewicht</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const q = quotes[h.symbol];
                  const currentPrice = q?.price ?? h.avgPrice;
                  const marketValue = h.shares * currentPrice;
                  const pnl = marketValue - h.shares * h.avgPrice;
                  const pnlPct =
                    h.avgPrice !== 0
                      ? (currentPrice - h.avgPrice) / h.avgPrice
                      : 0;
                  const weight = totalValue > 0 ? marketValue / totalValue : 0;

                  return (
                    <tr
                      key={h.id}
                      className="border-b border-dark-700 hover:bg-dark-700/50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/stock/${h.symbol}`)}
                    >
                      <td className="py-2.5 pr-3">
                        <span className="font-semibold text-txt-primary">
                          {h.symbol}
                        </span>
                        <span className="block text-xs text-txt-muted truncate max-w-[140px]">
                          {h.name}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono text-txt-secondary">
                        {h.shares}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono text-txt-secondary">
                        {fp(h.avgPrice, 'USD')}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono text-txt-primary">
                        {quotesLoading && !q ? '...' : fp(currentPrice, 'USD')}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono text-txt-primary">
                        {fp(marketValue, 'USD')}
                      </td>
                      <td className={`py-2.5 pr-3 text-right font-mono ${pnlColor(pnl)}`}>
                        {fp(pnl, 'USD')}
                      </td>
                      <td className={`py-2.5 pr-3 text-right font-mono ${pnlColor(pnlPct)}`}>
                        {formatPercent(pnlPct)}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono text-txt-muted">
                        {formatPercent(weight)}
                      </td>
                      <td className="py-2.5">
                        <button
                          className="btn-ghost p-1 text-danger hover:bg-dark-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeHolding(h.id);
                          }}
                          title="Bestand entfernen"
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
      ) : (
        <div className="card bg-dark-800 p-12 text-center space-y-3">
          <Briefcase className="w-12 h-12 mx-auto text-txt-muted" />
          <p className="text-txt-secondary">
            Noch keine Bestände vorhanden. Füge eine Transaktion hinzu, um zu
            beginnen.
          </p>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Risiko-Analyse                                                    */}
      {/* ----------------------------------------------------------------- */}

      {holdings.length > 0 && (
        <div className="card bg-dark-800 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-txt-primary">
              Risiko-Analyse
            </h2>
          </div>

          {riskMetrics.loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-dark-700 rounded-lg p-4 animate-pulse space-y-2"
                >
                  <div className="h-3 w-20 bg-dark-600 rounded" />
                  <div className="h-6 w-16 bg-dark-600 rounded" />
                  <div className="h-2 w-28 bg-dark-600 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {/* Sharpe Ratio */}
              <div className="bg-dark-700 rounded-lg p-4">
                <span className="text-xs text-txt-muted uppercase tracking-wide">
                  Sharpe Ratio
                </span>
                <p
                  className={`text-lg font-bold font-mono mt-1 ${
                    riskMetrics.sharpeRatio >= 1
                      ? 'text-success'
                      : riskMetrics.sharpeRatio >= 0
                        ? 'text-yellow-400'
                        : 'text-danger'
                  }`}
                >
                  {riskMetrics.sharpeRatio.toFixed(2)}
                </p>
                <p className="text-[10px] text-txt-muted mt-1">
                  Risikobereinigte Rendite ({'>'}1 = gut)
                </p>
              </div>

              {/* Sortino Ratio */}
              <div className="bg-dark-700 rounded-lg p-4">
                <span className="text-xs text-txt-muted uppercase tracking-wide">
                  Sortino Ratio
                </span>
                <p
                  className={`text-lg font-bold font-mono mt-1 ${
                    riskMetrics.sortinoRatio >= 1.5
                      ? 'text-success'
                      : riskMetrics.sortinoRatio >= 0
                        ? 'text-yellow-400'
                        : 'text-danger'
                  }`}
                >
                  {riskMetrics.sortinoRatio.toFixed(2)}
                </p>
                <p className="text-[10px] text-txt-muted mt-1">
                  Abwärtsrisiko-bereinigte Rendite ({'>'}1.5 = gut)
                </p>
              </div>

              {/* Max Drawdown */}
              <div className="bg-dark-700 rounded-lg p-4">
                <span className="text-xs text-txt-muted uppercase tracking-wide">
                  Max Drawdown
                </span>
                <p
                  className={`text-lg font-bold font-mono mt-1 ${
                    riskMetrics.maxDrawdownPercent <= 0.1
                      ? 'text-success'
                      : riskMetrics.maxDrawdownPercent <= 0.2
                        ? 'text-yellow-400'
                        : 'text-danger'
                  }`}
                >
                  -{(riskMetrics.maxDrawdownPercent * 100).toFixed(2)}%
                </p>
                <p className="text-[10px] text-txt-muted mt-1">
                  Größter Rückgang vom Hoch
                </p>
              </div>

              {/* VaR (95%) */}
              <div className="bg-dark-700 rounded-lg p-4">
                <span className="text-xs text-txt-muted uppercase tracking-wide">
                  VaR (95%)
                </span>
                <p
                  className={`text-lg font-bold font-mono mt-1 ${
                    riskMetrics.valueAtRisk <= 0.02
                      ? 'text-success'
                      : riskMetrics.valueAtRisk <= 0.04
                        ? 'text-yellow-400'
                        : 'text-danger'
                  }`}
                >
                  -{(riskMetrics.valueAtRisk * 100).toFixed(2)}%
                </p>
                <p className="text-[10px] text-txt-muted mt-1">
                  Max. Tagesverlust (95% Konf.)
                </p>
              </div>

              {/* Beta */}
              <div className="bg-dark-700 rounded-lg p-4">
                <span className="text-xs text-txt-muted uppercase tracking-wide">
                  Beta
                </span>
                <p
                  className={`text-lg font-bold font-mono mt-1 ${
                    riskMetrics.beta >= 0.8 && riskMetrics.beta <= 1.2
                      ? 'text-success'
                      : riskMetrics.beta > 1.5 || riskMetrics.beta < 0
                        ? 'text-danger'
                        : 'text-yellow-400'
                  }`}
                >
                  {riskMetrics.beta.toFixed(2)}
                </p>
                <p className="text-[10px] text-txt-muted mt-1">
                  Marktrisiko vs. S&P 500 (1 = Markt)
                </p>
              </div>

              {/* Volatilität */}
              <div className="bg-dark-700 rounded-lg p-4">
                <span className="text-xs text-txt-muted uppercase tracking-wide">
                  Volatilität
                </span>
                <p
                  className={`text-lg font-bold font-mono mt-1 ${
                    riskMetrics.annualVolatility <= 0.15
                      ? 'text-success'
                      : riskMetrics.annualVolatility <= 0.25
                        ? 'text-yellow-400'
                        : 'text-danger'
                  }`}
                >
                  {(riskMetrics.annualVolatility * 100).toFixed(2)}%
                </p>
                <p className="text-[10px] text-txt-muted mt-1">
                  Annualisierte Schwankungsbreite
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Add Transaction form (collapsible)                                */}
      {/* ----------------------------------------------------------------- */}

      <div className="card bg-dark-800">
        <button
          className="w-full flex items-center justify-between p-4 text-left"
          onClick={() => setFormOpen((o) => !o)}
        >
          <div className="flex items-center gap-2">
            <Plus className="w-5 h-5 text-accent" />
            <span className="font-semibold text-txt-primary">
              Transaktion hinzufügen
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
                Aktie / Symbol
              </label>
              <input
                className="input w-full"
                placeholder="z.B. AAPL"
                value={formSymbol}
                onChange={(e) => handleSymbolChange(e.target.value)}
                onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
                onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
              />

              {searchOpen && searchResults.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full bg-dark-700 border border-dark-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {searchResults.map((r) => (
                    <li
                      key={r.symbol}
                      className="px-3 py-2 hover:bg-dark-900 cursor-pointer text-sm flex justify-between"
                      onMouseDown={() => selectSearchResult(r)}
                    >
                      <span className="font-semibold text-txt-primary">
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
              <label className="block text-xs text-txt-muted mb-1">Typ</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                    formType === 'buy'
                      ? 'bg-success/20 text-success'
                      : 'bg-dark-700 text-txt-muted'
                  }`}
                  onClick={() => setFormType('buy')}
                >
                  Kauf
                </button>
                <button
                  type="button"
                  className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                    formType === 'sell'
                      ? 'bg-danger/20 text-danger'
                      : 'bg-dark-700 text-txt-muted'
                  }`}
                  onClick={() => setFormType('sell')}
                >
                  Verkauf
                </button>
              </div>
            </div>

            {/* Shares + Price */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-txt-muted mb-1">
                  Anteile
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
                  Preis
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
              {formType === 'buy' ? 'Kaufen' : 'Verkaufen'}
            </button>
          </form>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Recent Transactions                                               */}
      {/* ----------------------------------------------------------------- */}

      {transactions.length > 0 && (
        <div className="card bg-dark-800 p-5">
          <h2 className="text-lg font-semibold text-txt-primary mb-4">
            Letzte Transaktionen
          </h2>

          <ul className="space-y-2">
            {transactions.slice(0, 10).map((tx) => (
              <li
                key={tx.id}
                className="flex items-center justify-between py-2 border-b border-dark-700 last:border-0 text-sm"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${
                      tx.type === 'buy'
                        ? 'bg-success/20 text-success'
                        : 'bg-danger/20 text-danger'
                    }`}
                  >
                    {tx.type === 'buy' ? 'Kauf' : 'Verkauf'}
                  </span>
                  <span className="font-semibold text-txt-primary font-mono">
                    {tx.symbol}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-txt-secondary font-mono">
                  <span>{tx.shares} Stk.</span>
                  <span>@ {fp(tx.price, 'USD')}</span>
                  <span className="text-txt-muted text-xs">
                    {new Date(tx.date).toLocaleDateString('de-DE', {
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
