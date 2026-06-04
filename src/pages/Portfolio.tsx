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
} from 'lucide-react';

import { usePortfolio } from '../hooks/usePortfolio';
import { buildTransactionsCSV, parseTransactionsCSV } from '../utils/portfolioCsv';
import { useApp } from '../context';
import { fetchQuotes, fetchChart, searchSymbols } from '../api';
import { formatPercent, formatLargeNumber } from '../formatters';
import { usePrice } from '../hooks/usePrice';
import { Price } from '../components/Price';

import type { SearchResult } from '../types';

// Mapped quote for easy consumption
interface PortfolioQuote {
  price: number;
  change: number | null;
  changePercent: number | null;
  currency: string;
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
// Value-over-time area chart (current holdings valued across the past year)
// ---------------------------------------------------------------------------

function ValueChart({ series, positive }: { series: number[]; positive: boolean }) {
  if (series.length < 2) return null;
  const W = 800;
  const H = 200;
  const PAD = 4;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const pts = series.map((v, i) => ({
    x: PAD + (i / (series.length - 1)) * (W - 2 * PAD),
    y: PAD + (1 - (v - min) / range) * (H - 2 * PAD),
  }));
  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${PAD},${H - PAD} ${line} ${W - PAD},${H - PAD}`;
  const color = positive ? '#26a69a' : '#ef5350';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-44">
      <defs>
        <linearGradient id="pf-value-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#pf-value-fill)" />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
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
  const [priceHistory, setPriceHistory] = useState<{
    dates: string[];
    closesBySymbol: Record<string, Record<string, number>>;
  } | null>(null);

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
              currency: q.currency || 'USD',
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

  // Value-over-time series: current holdings valued at each historical close,
  // converted to the display currency. Recomputes on currency toggle without
  // refetching, because the raw closes are cached in priceHistory.
  const valueSeries = useMemo(() => {
    if (!priceHistory || holdings.length === 0) return [];
    return priceHistory.dates.map((d) => {
      let v = 0;
      for (const h of holdings) {
        const close = priceHistory.closesBySymbol[h.symbol]?.[d];
        if (close == null) continue;
        const cur = quotes[h.symbol]?.currency || 'USD';
        v += convertPrice(h.shares * close, cur).value;
      }
      return v;
    });
  }, [priceHistory, holdings, quotes, convertPrice]);

  const periodReturn = useMemo(() => {
    if (valueSeries.length < 2) return null;
    const first = valueSeries[0];
    const last = valueSeries[valueSeries.length - 1];
    if (first <= 0) return null;
    return { abs: last - first, pct: (last - first) / first };
  }, [valueSeries]);

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
          setPriceHistory(null);
          return;
        }

        // Stash the aligned closes for the value-over-time chart.
        const closesBySymbol: Record<string, Record<string, number>> = {};
        symbols.forEach((sym, j) => {
          closesBySymbol[sym] = holdingClosesByDate[j];
        });
        setPriceHistory({ dates: commonDates, closesBySymbol });

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
            <span className="text-lg font-semibold text-txt-primary">Aktie ins Portfolio legen</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-accent/10">
            <Briefcase className="w-6 h-6 text-accent" />
          </div>
          <h1 className="section-title text-2xl">Portfolioübersicht</h1>
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
              Gesamtwert
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
              Investiert
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
              Gewinn/Verlust
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
              Tagesveränderung
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
              <h2 className="section-title text-lg">Wertentwicklung</h2>
              <span className="text-[10px] text-txt-muted uppercase tracking-wider font-medium">
                1 Jahr · aktuelle Bestände
              </span>
            </div>
            {periodReturn && (
              <span
                className={`text-sm font-mono font-semibold px-2.5 py-1 rounded-lg ${
                  periodReturn.pct >= 0 ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'
                }`}
              >
                {formatPercent(periodReturn.pct * 100)}
              </span>
            )}
          </div>

          {riskMetrics.loading && valueSeries.length === 0 ? (
            <div className="h-44 rounded-xl skeleton-shimmer" />
          ) : valueSeries.length >= 2 ? (
            <ValueChart series={valueSeries} positive={(periodReturn?.pct ?? 0) >= 0} />
          ) : (
            <div className="h-44 flex items-center justify-center text-sm text-txt-muted">
              Nicht genügend Verlaufsdaten verfügbar.
            </div>
          )}

          {/* Realized / unrealized / total P&L */}
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div className="bg-dark-700/40 rounded-xl p-3 ring-1 ring-border/5">
              <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold block">
                Realisiert
              </span>
              <p className={`text-base font-bold font-mono tabular-nums mt-0.5 ${pnlColor(realizedPnl)}`}>
                <Price value={realizedPnl} currency={displayCcy} size={14} tone={realizedPnl >= 0 ? 'positive' : 'negative'} />
              </p>
            </div>
            <div className="bg-dark-700/40 rounded-xl p-3 ring-1 ring-border/5">
              <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold block">
                Unrealisiert
              </span>
              <p className={`text-base font-bold font-mono tabular-nums mt-0.5 ${pnlColor(totalPnl)}`}>
                <Price value={totalPnl} currency={displayCcy} size={14} tone={totalPnl >= 0 ? 'positive' : 'negative'} />
              </p>
            </div>
            <div className="bg-dark-700/40 rounded-xl p-3 ring-1 ring-border/5">
              <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold block">
                Gesamt G/V
              </span>
              <p className={`text-base font-bold font-mono tabular-nums mt-0.5 ${pnlColor(realizedPnl + totalPnl)}`}>
                <Price value={realizedPnl + totalPnl} currency={displayCcy} size={14} tone={realizedPnl + totalPnl >= 0 ? 'positive' : 'negative'} />
              </p>
            </div>
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
              <h2 className="section-title text-lg">Allokation</h2>
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
              <h2 className="section-title text-lg">Bestände</h2>
            </div>

            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/10">
                  <th className="text-left px-5 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">Aktie</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">Anteile</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">Ø Preis</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">Kurs</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">Marktwert</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">G/V</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">G/V (%)</th>
                  <th className="text-right px-3 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">Gewicht</th>
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
        </div>
      ) : (
        <div className="card p-12 text-center space-y-3">
          <Briefcase className="w-12 h-12 mx-auto text-txt-muted/30" />
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
        <div className="card p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <ShieldAlert className="w-5 h-5 text-accent" />
            </div>
            <h2 className="section-title text-lg">Risiko-Analyse</h2>
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
                  Risikobereinigte Rendite ({'>'}1 = gut)
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
                  Abwärtsrisiko-bereinigte Rendite ({'>'}1.5 = gut)
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
                  Größter Rückgang vom Hoch
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
                  Max. Tagesverlust (95% Konf.)
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
                  Marktrisiko vs. S&P 500 (1 = Markt)
                </p>
              </div>

              {/* Volatilität */}
              <div className="bg-dark-700/40 rounded-xl p-4 ring-1 ring-border/5 hover:bg-dark-700/60 transition-colors duration-200">
                <span className="text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
                  Volatilität
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
              <label className="block text-xs text-txt-muted mb-1">Typ</label>
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
                  Kauf
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
        <div className="card p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <DollarSign className="w-5 h-5 text-accent" />
            </div>
            <h2 className="section-title text-lg">Letzte Transaktionen</h2>
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
                    {tx.type === 'buy' ? 'Kauf' : 'Verkauf'}
                  </span>
                  <span className="font-mono font-bold text-accent">
                    {tx.symbol}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-txt-secondary font-mono tabular-nums">
                  <span>{tx.shares} Stk.</span>
                  <span className="inline-flex items-center gap-1">@ <Price value={tx.price} currency="USD" size={11} /></span>
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
