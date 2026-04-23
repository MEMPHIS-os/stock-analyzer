import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FlaskConical,
  Search,
  Play,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Activity,
  ArrowUpDown,
  Info,
  Zap,
  RotateCcw,
  Layers,
  CalendarDays,
} from 'lucide-react';
import { fetchChart, searchSymbols } from '../api';
import { useApp } from '../context';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
} from '../indicators';
import { usePrice } from '../hooks/usePrice';
import { formatPercent } from '../formatters';
import LoadingSpinner from '../components/LoadingSpinner';
import type { OHLCVData, TimeRange } from '../types';

// ─── Types ───

interface Trade {
  type: 'buy' | 'sell';
  date: string;
  price: number;
  shares: number;
  capital: number;
  pnl?: number;
  pnlPercent?: number;
}

interface BacktestResult {
  trades: Trade[];
  finalCapital: number;
  totalReturn: number;
  totalReturnPercent: number;
  winRate: number;
  totalTrades: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;
  buyAndHoldReturn: number;
}

type StrategyType = 'sma_crossover' | 'ema_crossover' | 'rsi' | 'macd' | 'bollinger' | 'mean_reversion' | 'rsi_macd';

interface StrategyParams {
  sma_crossover: { fastPeriod: number; slowPeriod: number };
  ema_crossover: { fastPeriod: number; slowPeriod: number };
  rsi: { period: number; oversold: number; overbought: number };
  macd: { fast: number; slow: number; signal: number };
  bollinger: { period: number; stdDev: number };
  mean_reversion: { period: number; threshold: number };
  rsi_macd: { rsiPeriod: number; rsiBuy: number; rsiSell: number; macdFast: number; macdSlow: number; macdSignal: number };
}

// ─── Backtest Engine ───

function generateSignals(
  data: OHLCVData[],
  strategy: StrategyType,
  params: StrategyParams
): ('buy' | 'sell' | 'hold')[] {
  const closes = data.map((d) => d.close);
  const signals: ('buy' | 'sell' | 'hold')[] = new Array(data.length).fill('hold');

  switch (strategy) {
    case 'sma_crossover': {
      const { fastPeriod, slowPeriod } = params.sma_crossover;
      const fastSMA = calculateSMA(closes, fastPeriod);
      const slowSMA = calculateSMA(closes, slowPeriod);
      // slowSMA starts at index (slowPeriod - 1)
      // fastSMA starts at index (fastPeriod - 1)
      // Align: for index i in data, fastSMA value = fastSMA[i - (fastPeriod - 1)]
      //        slowSMA value = slowSMA[i - (slowPeriod - 1)]
      const startIdx = slowPeriod; // need at least one previous value to detect crossover
      for (let i = startIdx; i < data.length; i++) {
        const fastIdx = i - (fastPeriod - 1);
        const slowIdx = i - (slowPeriod - 1);
        const prevFastIdx = fastIdx - 1;
        const prevSlowIdx = slowIdx - 1;
        if (prevFastIdx < 0 || prevSlowIdx < 0) continue;

        const fastNow = fastSMA[fastIdx];
        const slowNow = slowSMA[slowIdx];
        const fastPrev = fastSMA[prevFastIdx];
        const slowPrev = slowSMA[prevSlowIdx];

        if (fastPrev <= slowPrev && fastNow > slowNow) {
          signals[i] = 'buy';
        } else if (fastPrev >= slowPrev && fastNow < slowNow) {
          signals[i] = 'sell';
        }
      }
      break;
    }

    case 'rsi': {
      const { period, oversold, overbought } = params.rsi;
      const rsiValues = calculateRSI(closes, period);
      // rsi[j] corresponds to data[period + j]
      for (let j = 0; j < rsiValues.length; j++) {
        const dataIdx = period + j;
        if (rsiValues[j] < oversold) {
          signals[dataIdx] = 'buy';
        } else if (rsiValues[j] > overbought) {
          signals[dataIdx] = 'sell';
        }
      }
      break;
    }

    case 'macd': {
      const { fast, slow, signal } = params.macd;
      const macdResult = calculateMACD(closes, fast, slow, signal);
      const { histogram, startIndex } = macdResult;
      // histogram[j] corresponds to data[startIndex + j]
      for (let j = 1; j < histogram.length; j++) {
        const dataIdx = startIndex + j;
        if (dataIdx >= data.length) break;
        const prevHist = histogram[j - 1];
        const currHist = histogram[j];
        if (prevHist <= 0 && currHist > 0) {
          signals[dataIdx] = 'buy';
        } else if (prevHist >= 0 && currHist < 0) {
          signals[dataIdx] = 'sell';
        }
      }
      break;
    }

    case 'ema_crossover': {
      const { fastPeriod, slowPeriod } = params.ema_crossover;
      const fastEMA = calculateEMA(closes, fastPeriod);
      const slowEMA = calculateEMA(closes, slowPeriod);
      // fastEMA[i] corresponds to data[fastPeriod - 1 + i]
      // slowEMA[i] corresponds to data[slowPeriod - 1 + i]
      const emaOffset = slowPeriod - fastPeriod;
      for (let j = 1; j < slowEMA.length; j++) {
        const dataIdx = slowPeriod - 1 + j;
        if (dataIdx >= data.length) break;
        const fastNow = fastEMA[j + emaOffset];
        const slowNow = slowEMA[j];
        const fastPrev = fastEMA[j + emaOffset - 1];
        const slowPrev = slowEMA[j - 1];
        if (fastPrev <= slowPrev && fastNow > slowNow) {
          signals[dataIdx] = 'buy';
        } else if (fastPrev >= slowPrev && fastNow < slowNow) {
          signals[dataIdx] = 'sell';
        }
      }
      break;
    }

    case 'bollinger': {
      const { period, stdDev } = params.bollinger;
      const bb = calculateBollingerBands(closes, period, stdDev);
      // bb values[j] corresponds to data[period - 1 + j]
      for (let j = 0; j < bb.upper.length; j++) {
        const dataIdx = period - 1 + j;
        if (dataIdx >= data.length) break;
        const close = closes[dataIdx];
        if (close < bb.lower[j]) {
          signals[dataIdx] = 'buy';
        } else if (close > bb.upper[j]) {
          signals[dataIdx] = 'sell';
        }
      }
      break;
    }

    case 'mean_reversion': {
      const { period, threshold } = params.mean_reversion;
      const sma = calculateSMA(closes, period);
      // sma[j] corresponds to data[period - 1 + j]
      for (let j = 0; j < sma.length; j++) {
        const dataIdx = period - 1 + j;
        if (dataIdx >= data.length) break;
        const deviation = ((closes[dataIdx] - sma[j]) / sma[j]) * 100;
        if (deviation < -threshold) {
          signals[dataIdx] = 'buy';
        } else if (deviation > threshold) {
          signals[dataIdx] = 'sell';
        }
      }
      break;
    }

    case 'rsi_macd': {
      const { rsiPeriod, rsiBuy, rsiSell, macdFast, macdSlow, macdSignal } = params.rsi_macd;
      const rsiValues = calculateRSI(closes, rsiPeriod);
      const macdResult = calculateMACD(closes, macdFast, macdSlow, macdSignal);
      const { histogram, startIndex } = macdResult;
      // Both RSI and MACD must agree
      for (let i = 0; i < data.length; i++) {
        const rsiIdx = i - rsiPeriod;
        const histIdx = i - startIndex;
        if (rsiIdx < 0 || histIdx < 1) continue;
        if (rsiIdx >= rsiValues.length || histIdx >= histogram.length) continue;
        const rsi = rsiValues[rsiIdx];
        const histNow = histogram[histIdx];
        const histPrev = histogram[histIdx - 1];
        // Buy: RSI oversold AND MACD histogram crosses above 0
        if (rsi < rsiBuy && histPrev <= 0 && histNow > 0) {
          signals[i] = 'buy';
        }
        // Sell: RSI overbought AND MACD histogram crosses below 0
        else if (rsi > rsiSell && histPrev >= 0 && histNow < 0) {
          signals[i] = 'sell';
        }
      }
      break;
    }
  }

  return signals;
}

function runBacktest(
  data: OHLCVData[],
  strategy: StrategyType,
  params: StrategyParams,
  initialCapital: number
): BacktestResult {
  const signals = generateSignals(data, strategy, params);
  const trades: Trade[] = [];

  let capital = initialCapital;
  let shares = 0;
  let holding = false;
  let buyPrice = 0;

  // Execute trades
  for (let i = 0; i < data.length; i++) {
    const price = data[i].close;
    const dateStr =
      typeof data[i].date === 'number'
        ? new Date((data[i].date as number) * 1000).toISOString().split('T')[0]
        : String(data[i].date);

    if (signals[i] === 'buy' && !holding) {
      shares = Math.floor(capital / price);
      if (shares <= 0) continue;
      const cost = shares * price;
      capital -= cost;
      holding = true;
      buyPrice = price;
      trades.push({
        type: 'buy',
        date: dateStr,
        price,
        shares,
        capital: capital + shares * price,
      });
    } else if (signals[i] === 'sell' && holding) {
      const revenue = shares * price;
      const pnl = revenue - shares * buyPrice;
      const pnlPercent = ((price - buyPrice) / buyPrice) * 100;
      capital += revenue;
      trades.push({
        type: 'sell',
        date: dateStr,
        price,
        shares,
        capital,
        pnl,
        pnlPercent,
      });
      shares = 0;
      holding = false;
    }
  }

  // If still holding at the end, calculate unrealized value
  const lastPrice = data[data.length - 1].close;
  const finalCapital = holding ? capital + shares * lastPrice : capital;

  const totalReturn = finalCapital - initialCapital;
  const totalReturnPercent = (totalReturn / initialCapital) * 100;

  // Calculate win rate
  const sellTrades = trades.filter((t) => t.type === 'sell');
  const winTrades = sellTrades.filter((t) => (t.pnl ?? 0) > 0);
  const lossTrades = sellTrades.filter((t) => (t.pnl ?? 0) <= 0);
  const winRate = sellTrades.length > 0 ? (winTrades.length / sellTrades.length) * 100 : 0;

  const avgWin =
    winTrades.length > 0
      ? winTrades.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / winTrades.length
      : 0;
  const avgLoss =
    lossTrades.length > 0
      ? lossTrades.reduce((s, t) => s + (t.pnlPercent ?? 0), 0) / lossTrades.length
      : 0;

  // Calculate daily portfolio returns for Sharpe ratio and max drawdown
  const dailyValues: number[] = [];
  let currentCapital = initialCapital;
  let currentShares = 0;
  let isHolding = false;
  let tradeIdx = 0;

  for (let i = 0; i < data.length; i++) {
    const price = data[i].close;
    const dateStr =
      typeof data[i].date === 'number'
        ? new Date((data[i].date as number) * 1000).toISOString().split('T')[0]
        : String(data[i].date);

    // Check if a trade happened on this day
    while (tradeIdx < trades.length && trades[tradeIdx].date === dateStr) {
      const trade = trades[tradeIdx];
      if (trade.type === 'buy') {
        currentShares = trade.shares;
        currentCapital = currentCapital - currentShares * trade.price;
        isHolding = true;
      } else {
        currentCapital = currentCapital + currentShares * trade.price;
        currentShares = 0;
        isHolding = false;
      }
      tradeIdx++;
    }

    const portfolioValue = isHolding ? currentCapital + currentShares * price : currentCapital;
    dailyValues.push(portfolioValue);
  }

  // Max drawdown
  let peak = dailyValues[0];
  let maxDrawdown = 0;
  for (const val of dailyValues) {
    if (val > peak) peak = val;
    const dd = ((peak - val) / peak) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Sharpe ratio (annualized, risk-free rate = 0 for simplicity)
  const dailyReturns: number[] = [];
  for (let i = 1; i < dailyValues.length; i++) {
    if (dailyValues[i - 1] > 0) {
      dailyReturns.push((dailyValues[i] - dailyValues[i - 1]) / dailyValues[i - 1]);
    }
  }
  const meanReturn = dailyReturns.length > 0
    ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
    : 0;
  const stdReturn = dailyReturns.length > 1
    ? Math.sqrt(
        dailyReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (dailyReturns.length - 1)
      )
    : 0;
  const sharpeRatio = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(252) : 0;

  // Buy and hold comparison
  const firstPrice = data[0].close;
  const buyAndHoldReturn = ((lastPrice - firstPrice) / firstPrice) * 100;

  return {
    trades,
    finalCapital,
    totalReturn,
    totalReturnPercent,
    winRate,
    totalTrades: sellTrades.length,
    avgWin,
    avgLoss,
    maxDrawdown,
    sharpeRatio,
    buyAndHoldReturn,
  };
}

// ─── Range options ───

const RANGE_OPTIONS: { value: TimeRange; labelDe: string; labelEn: string }[] = [
  { value: '6mo', labelDe: '6 Monate', labelEn: '6 Months' },
  { value: '1y', labelDe: '1 Jahr', labelEn: '1 Year' },
  { value: '2y', labelDe: '2 Jahre', labelEn: '2 Years' },
  { value: '5y', labelDe: '5 Jahre', labelEn: '5 Years' },
];

const STRATEGY_CARDS: {
  value: StrategyType;
  labelDe: string;
  labelEn: string;
  descDe: string;
  descEn: string;
  icon: typeof TrendingUp;
}[] = [
  {
    value: 'sma_crossover',
    labelDe: 'SMA Crossover',
    labelEn: 'SMA Crossover',
    descDe: 'Schnelle SMA kreuzt langsame SMA',
    descEn: 'Fast SMA crosses slow SMA',
    icon: TrendingUp,
  },
  {
    value: 'ema_crossover',
    labelDe: 'EMA Crossover',
    labelEn: 'EMA Crossover',
    descDe: 'Schnellerer EMA-basierter Crossover',
    descEn: 'Faster EMA-based crossover',
    icon: Zap,
  },
  {
    value: 'rsi',
    labelDe: 'RSI',
    labelEn: 'RSI',
    descDe: 'Überverkauft kaufen, überkauft verkaufen',
    descEn: 'Buy oversold, sell overbought',
    icon: Activity,
  },
  {
    value: 'macd',
    labelDe: 'MACD Signal',
    labelEn: 'MACD Signal',
    descDe: 'MACD-Histogramm Kreuzungen',
    descEn: 'MACD histogram crossover',
    icon: BarChart3,
  },
  {
    value: 'bollinger',
    labelDe: 'Bollinger Bands',
    labelEn: 'Bollinger Bands',
    descDe: 'Bounce an den Bollinger-Bändern',
    descEn: 'Trade bounces off bands',
    icon: ArrowUpDown,
  },
  {
    value: 'mean_reversion',
    labelDe: 'Mean Reversion',
    labelEn: 'Mean Reversion',
    descDe: 'Kaufen bei Abweichung unter SMA',
    descEn: 'Buy when price deviates below SMA',
    icon: RotateCcw,
  },
  {
    value: 'rsi_macd',
    labelDe: 'RSI + MACD',
    labelEn: 'RSI + MACD',
    descDe: 'Kombiniert RSI- und MACD-Signale',
    descEn: 'Combines RSI and MACD signals',
    icon: Layers,
  },
];

// ─── Main Component ───

export default function Backtesting() {
  const { locale, watchlist } = useApp();
  const { fp } = usePrice();
  const de = locale === 'de';

  // Symbol search
  const [symbol, setSymbol] = useState('AAPL');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ symbol: string; shortname: string }[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);

  // Config
  const [range, setRange] = useState<TimeRange>('2y');
  const [strategy, setStrategy] = useState<StrategyType>('sma_crossover');
  const [initialCapital, setInitialCapital] = useState(10000);
  const [params, setParams] = useState<StrategyParams>({
    sma_crossover: { fastPeriod: 20, slowPeriod: 50 },
    ema_crossover: { fastPeriod: 12, slowPeriod: 26 },
    rsi: { period: 14, oversold: 30, overbought: 70 },
    macd: { fast: 12, slow: 26, signal: 9 },
    bollinger: { period: 20, stdDev: 2 },
    mean_reversion: { period: 20, threshold: 3 },
    rsi_macd: { rsiPeriod: 14, rsiBuy: 35, rsiSell: 65, macdFast: 12, macdSlow: 26, macdSignal: 9 },
  });

  // Data & results
  const [data, setData] = useState<OHLCVData[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [currency, setCurrency] = useState('USD');

  // Search handler
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const results = await searchSymbols(searchQuery);
        setSearchResults(results.slice(0, 6));
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  function selectSymbol(sym: string) {
    setSymbol(sym);
    setSearchQuery('');
    setSearchOpen(false);
    setResult(null);
  }

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const chartResult = await fetchChart(symbol, range, '1d');
      setData(chartResult.quotes);
      setCurrency(chartResult.meta?.currency || 'USD');
    } catch {
      setData([]);
    }
    setLoading(false);
  }, [symbol, range]);

  // Run backtest
  const handleBacktest = useCallback(async () => {
    if (data.length === 0) {
      await loadData();
      return;
    }
    const backtestResult = runBacktest(data, strategy, params, initialCapital);
    setResult(backtestResult);
  }, [data, strategy, params, initialCapital, loadData]);

  // When data arrives after loadData, run the backtest
  useEffect(() => {
    if (data.length > 0 && !result && loading === false) {
      const backtestResult = runBacktest(data, strategy, params, initialCapital);
      setResult(backtestResult);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Update param helpers
  function updateParam<K extends StrategyType>(
    strat: K,
    key: keyof StrategyParams[K],
    value: number
  ) {
    setParams((prev) => ({
      ...prev,
      [strat]: { ...prev[strat], [key]: value },
    }));
  }

  return (
    <div className="space-y-4 animate-fade-in max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center">
            <FlaskConical className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-txt-primary">Backtesting</h1>
            <p className="text-xs text-txt-secondary">
              {de
                ? 'Teste technische Strategien auf historischen Daten'
                : 'Test technical strategies on historical data'}
            </p>
          </div>
        </div>
      </div>

      {/* Configuration Card */}
      <div className="card p-4 space-y-4">
        {/* Row 1: Symbol + Range */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Symbol search */}
          <div className="relative">
            <label className="block text-xs text-txt-secondary font-medium mb-1">
              Symbol
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-txt-muted" />
              <input
                type="text"
                value={searchOpen ? searchQuery : symbol}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder={de ? 'Symbol suchen...' : 'Search symbol...'}
                className="w-full pl-9 pr-3 py-2 bg-dark-700 border border-border/30 rounded-lg text-sm text-txt-primary focus:outline-none focus:border-accent/50"
              />
            </div>

            {/* Search dropdown */}
            {searchOpen && (searchResults.length > 0 || watchlist.length > 0) && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-dark-800 border border-border/30 rounded-lg shadow-xl z-50 overflow-hidden">
                {searchResults.length > 0 ? (
                  searchResults.map((r) => (
                    <button
                      key={r.symbol}
                      onClick={() => selectSymbol(r.symbol)}
                      className="w-full text-left px-3 py-2 hover:bg-dark-600 flex justify-between items-center transition-colors"
                    >
                      <span className="text-sm font-medium text-txt-primary">{r.symbol}</span>
                      <span className="text-xs text-txt-secondary truncate ml-2">
                        {r.shortname}
                      </span>
                    </button>
                  ))
                ) : (
                  <>
                    <div className="px-3 py-1.5 text-[10px] text-txt-muted uppercase tracking-wider">
                      Watchlist
                    </div>
                    {watchlist.slice(0, 6).map((item) => (
                      <button
                        key={item.symbol}
                        onClick={() => selectSymbol(item.symbol)}
                        className="w-full text-left px-3 py-2 hover:bg-dark-600 flex justify-between items-center transition-colors"
                      >
                        <span className="text-sm font-medium text-txt-primary">{item.symbol}</span>
                        <span className="text-xs text-txt-secondary truncate ml-2">
                          {item.name}
                        </span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Range */}
          <div>
            <label className="block text-xs text-txt-secondary font-medium mb-1">
              {de ? 'Zeitraum' : 'Time Range'}
            </label>
            <select
              value={range}
              onChange={(e) => {
                setRange(e.target.value as TimeRange);
                setResult(null);
                setData([]);
              }}
              className="w-full px-3 py-2 bg-dark-700 border border-border/30 rounded-lg text-sm text-txt-primary focus:outline-none focus:border-accent/50"
            >
              {RANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {de ? opt.labelDe : opt.labelEn}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Row 2: Strategy Cards */}
        <div>
          <label className="block text-xs text-txt-secondary font-medium mb-1">
            {de ? 'Strategie' : 'Strategy'}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {STRATEGY_CARDS.map((opt) => {
              const Icon = opt.icon;
              const isActive = strategy === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setStrategy(opt.value)}
                  className={`p-3 rounded-lg border text-left transition-all duration-150 ${
                    isActive
                      ? 'bg-accent/15 border-accent/50 ring-1 ring-accent/30'
                      : 'bg-dark-600/50 border-border/20 hover:border-border/40 hover:bg-dark-600'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-accent' : 'text-txt-muted'}`} />
                    <span className={`text-xs font-semibold ${isActive ? 'text-accent' : 'text-txt-primary'}`}>
                      {de ? opt.labelDe : opt.labelEn}
                    </span>
                  </div>
                  <p className="text-[10px] text-txt-secondary leading-snug">
                    {de ? opt.descDe : opt.descEn}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Row 3: Strategy params */}
        <div>
          <label className="block text-xs text-txt-secondary font-medium mb-1">
            Parameter
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {strategy === 'sma_crossover' && (
              <>
                <ParamInput
                  label={de ? 'Schnelle SMA' : 'Fast SMA'}
                  value={params.sma_crossover.fastPeriod}
                  onChange={(v) => updateParam('sma_crossover', 'fastPeriod', v)}
                  min={2}
                  max={100}
                />
                <ParamInput
                  label={de ? 'Langsame SMA' : 'Slow SMA'}
                  value={params.sma_crossover.slowPeriod}
                  onChange={(v) => updateParam('sma_crossover', 'slowPeriod', v)}
                  min={5}
                  max={200}
                />
              </>
            )}
            {strategy === 'ema_crossover' && (
              <>
                <ParamInput
                  label={de ? 'Schnelle EMA' : 'Fast EMA'}
                  value={params.ema_crossover.fastPeriod}
                  onChange={(v) => updateParam('ema_crossover', 'fastPeriod', v)}
                  min={2}
                  max={100}
                />
                <ParamInput
                  label={de ? 'Langsame EMA' : 'Slow EMA'}
                  value={params.ema_crossover.slowPeriod}
                  onChange={(v) => updateParam('ema_crossover', 'slowPeriod', v)}
                  min={5}
                  max={200}
                />
              </>
            )}
            {strategy === 'rsi' && (
              <>
                <ParamInput
                  label={de ? 'Periode' : 'Period'}
                  value={params.rsi.period}
                  onChange={(v) => updateParam('rsi', 'period', v)}
                  min={2}
                  max={50}
                />
                <ParamInput
                  label="Oversold"
                  value={params.rsi.oversold}
                  onChange={(v) => updateParam('rsi', 'oversold', v)}
                  min={5}
                  max={50}
                />
                <ParamInput
                  label="Overbought"
                  value={params.rsi.overbought}
                  onChange={(v) => updateParam('rsi', 'overbought', v)}
                  min={50}
                  max={95}
                />
              </>
            )}
            {strategy === 'macd' && (
              <>
                <ParamInput
                  label="Fast"
                  value={params.macd.fast}
                  onChange={(v) => updateParam('macd', 'fast', v)}
                  min={2}
                  max={50}
                />
                <ParamInput
                  label="Slow"
                  value={params.macd.slow}
                  onChange={(v) => updateParam('macd', 'slow', v)}
                  min={5}
                  max={100}
                />
                <ParamInput
                  label="Signal"
                  value={params.macd.signal}
                  onChange={(v) => updateParam('macd', 'signal', v)}
                  min={2}
                  max={50}
                />
              </>
            )}
            {strategy === 'bollinger' && (
              <>
                <ParamInput
                  label={de ? 'Periode' : 'Period'}
                  value={params.bollinger.period}
                  onChange={(v) => updateParam('bollinger', 'period', v)}
                  min={5}
                  max={100}
                />
                <ParamInput
                  label={de ? 'Std.Abw.' : 'Std Dev'}
                  value={params.bollinger.stdDev}
                  onChange={(v) => updateParam('bollinger', 'stdDev', v)}
                  min={0.5}
                  max={5}
                  step={0.1}
                />
              </>
            )}
            {strategy === 'mean_reversion' && (
              <>
                <ParamInput
                  label={de ? 'SMA Periode' : 'SMA Period'}
                  value={params.mean_reversion.period}
                  onChange={(v) => updateParam('mean_reversion', 'period', v)}
                  min={5}
                  max={100}
                />
                <ParamInput
                  label={de ? 'Schwelle (%)' : 'Threshold (%)'}
                  value={params.mean_reversion.threshold}
                  onChange={(v) => updateParam('mean_reversion', 'threshold', v)}
                  min={0.5}
                  max={15}
                  step={0.5}
                />
              </>
            )}
            {strategy === 'rsi_macd' && (
              <>
                <ParamInput
                  label="RSI Periode"
                  value={params.rsi_macd.rsiPeriod}
                  onChange={(v) => updateParam('rsi_macd', 'rsiPeriod', v)}
                  min={2}
                  max={50}
                />
                <ParamInput
                  label={de ? 'RSI Kauf' : 'RSI Buy'}
                  value={params.rsi_macd.rsiBuy}
                  onChange={(v) => updateParam('rsi_macd', 'rsiBuy', v)}
                  min={10}
                  max={50}
                />
                <ParamInput
                  label={de ? 'RSI Verkauf' : 'RSI Sell'}
                  value={params.rsi_macd.rsiSell}
                  onChange={(v) => updateParam('rsi_macd', 'rsiSell', v)}
                  min={50}
                  max={90}
                />
              </>
            )}
          </div>
        </div>

        {/* Row 4: Initial Capital + Run Button */}
        <div className="flex flex-col sm:flex-row items-end gap-3">
          <div className="flex-1 w-full sm:w-auto">
            <label className="block text-xs text-txt-secondary font-medium mb-1">
              {de ? 'Startkapital' : 'Initial Capital'}
            </label>
            <input
              type="number"
              value={initialCapital}
              onChange={(e) => setInitialCapital(Math.max(100, Number(e.target.value)))}
              min={100}
              className="w-full px-3 py-2 bg-dark-700 border border-border/30 rounded-lg text-sm text-txt-primary focus:outline-none focus:border-accent/50 font-mono"
            />
          </div>
          <button
            onClick={async () => {
              if (data.length === 0) {
                await loadData();
              } else {
                const backtestResult = runBacktest(data, strategy, params, initialCapital);
                setResult(backtestResult);
              }
            }}
            disabled={loading}
            className="w-full sm:w-auto px-6 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play className="w-4 h-4" />
            {loading
              ? de
                ? 'Lade...'
                : 'Loading...'
              : de
                ? 'Backtest starten'
                : 'Run Backtest'}
          </button>
        </div>
      </div>

      {/* Close search on outside click */}
      {searchOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setSearchOpen(false)} />
      )}

      {/* Loading */}
      {loading && (
        <LoadingSpinner text={`${de ? 'Lade Daten f\u00fcr' : 'Loading data for'} ${symbol}...`} />
      )}

      {/* Disclaimer */}
      {result && (
        <div className="flex items-start gap-2 px-3 py-2 bg-warning/10 border border-warning/20 rounded-lg">
          <Info className="w-4 h-4 text-warning shrink-0 mt-0.5" />
          <p className="text-[11px] text-warning/80">
            {de
              ? 'Backtesting-Ergebnisse basieren auf historischen Daten und stellen keine Anlageberatung dar. Vergangene Performance ist kein Indikator f\u00fcr zuk\u00fcnftige Ergebnisse. Handelskosten und Slippage sind nicht ber\u00fccksichtigt.'
              : 'Backtesting results are based on historical data and do not constitute investment advice. Past performance is not indicative of future results. Trading costs and slippage are not accounted for.'}
          </p>
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Metrics Grid */}
          <div>
            <h2 className="text-sm font-semibold text-txt-primary flex items-center gap-2 mb-3">
              <BarChart3 className="w-4 h-4 text-accent" />
              {de ? 'Ergebnis' : 'Results'}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                label={de ? 'Endkapital' : 'Final Capital'}
                value={fp(result.finalCapital, currency)}
                positive={result.totalReturn >= 0}
              />
              <MetricCard
                label={de ? 'Rendite' : 'Return'}
                value={formatPercent(result.totalReturnPercent)}
                positive={result.totalReturnPercent >= 0}
              />
              <MetricCard
                label="Trades"
                value={String(result.totalTrades)}
              />
              <MetricCard
                label="Win Rate"
                value={`${result.winRate.toFixed(1)}%`}
                positive={result.winRate >= 50}
              />
              <MetricCard
                label="Max Drawdown"
                value={`-${result.maxDrawdown.toFixed(1)}%`}
                positive={false}
              />
              <MetricCard
                label="Sharpe Ratio"
                value={result.sharpeRatio.toFixed(2)}
                positive={result.sharpeRatio > 0}
              />
              <MetricCard
                label={de ? 'Avg Gewinn' : 'Avg Win'}
                value={formatPercent(result.avgWin)}
                positive={true}
              />
              <MetricCard
                label={de ? 'Avg Verlust' : 'Avg Loss'}
                value={result.avgLoss !== 0 ? formatPercent(result.avgLoss) : '--'}
                positive={false}
              />
            </div>
          </div>

          {/* Buy & Hold Comparison */}
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowUpDown className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold text-txt-primary">
                  Buy & Hold {de ? 'Vergleich' : 'Comparison'}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-[10px] text-txt-muted uppercase tracking-wider">
                    {de ? 'Strategie' : 'Strategy'}
                  </div>
                  <span
                    className={`text-sm font-mono font-bold ${
                      result.totalReturnPercent >= 0 ? 'text-success' : 'text-danger'
                    }`}
                  >
                    {formatPercent(result.totalReturnPercent)}
                  </span>
                </div>
                <div className="text-txt-muted text-xs">vs</div>
                <div className="text-right">
                  <div className="text-[10px] text-txt-muted uppercase tracking-wider">
                    Buy & Hold
                  </div>
                  <span
                    className={`text-sm font-mono font-bold ${
                      result.buyAndHoldReturn >= 0 ? 'text-success' : 'text-danger'
                    }`}
                  >
                    {formatPercent(result.buyAndHoldReturn)}
                  </span>
                </div>
              </div>
            </div>
            {/* Visual comparison bar */}
            <div className="mt-3 flex gap-2 items-end h-8">
              <div className="flex-1">
                <div
                  className={`rounded-t ${
                    result.totalReturnPercent >= 0 ? 'bg-accent' : 'bg-danger'
                  } transition-all`}
                  style={{
                    height: `${Math.min(100, Math.max(4, Math.abs(result.totalReturnPercent) * 2))}%`,
                  }}
                />
                <div className="text-[10px] text-txt-secondary text-center mt-1">
                  {de ? 'Strategie' : 'Strategy'}
                </div>
              </div>
              <div className="flex-1">
                <div
                  className={`rounded-t ${
                    result.buyAndHoldReturn >= 0 ? 'bg-success' : 'bg-danger'
                  } transition-all`}
                  style={{
                    height: `${Math.min(100, Math.max(4, Math.abs(result.buyAndHoldReturn) * 2))}%`,
                  }}
                />
                <div className="text-[10px] text-txt-secondary text-center mt-1">Buy & Hold</div>
              </div>
            </div>
          </div>

          {/* Monthly/Yearly Returns Heatmap */}
          <MonthlyReturnsHeatmap data={data} trades={result.trades} initialCapital={initialCapital} de={de} />

          {/* Trade History */}
          {result.trades.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-txt-primary flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-accent" />
                {de ? 'Trade-Historie' : 'Trade History'}
              </h2>
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/20">
                        <th className="text-left px-4 py-2 text-xs text-txt-secondary font-medium">
                          {de ? 'Typ' : 'Type'}
                        </th>
                        <th className="text-left px-4 py-2 text-xs text-txt-secondary font-medium">
                          {de ? 'Datum' : 'Date'}
                        </th>
                        <th className="text-right px-4 py-2 text-xs text-txt-secondary font-medium">
                          {de ? 'Preis' : 'Price'}
                        </th>
                        <th className="text-right px-4 py-2 text-xs text-txt-secondary font-medium">
                          {de ? 'Anteile' : 'Shares'}
                        </th>
                        <th className="text-right px-4 py-2 text-xs text-txt-secondary font-medium">
                          {de ? 'Ergebnis' : 'P&L'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.map((trade, i) => (
                        <tr
                          key={i}
                          className="border-b border-border/10 last:border-0 hover:bg-dark-700/30 transition-colors"
                        >
                          <td className="px-4 py-2.5">
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded ${
                                trade.type === 'buy'
                                  ? 'bg-success/15 text-success'
                                  : 'bg-danger/15 text-danger'
                              }`}
                            >
                              {trade.type === 'buy' ? (
                                <>
                                  <TrendingUp className="w-3 h-3" />
                                  {de ? 'KAUF' : 'BUY'}
                                </>
                              ) : (
                                <>
                                  <TrendingDown className="w-3 h-3" />
                                  {de ? 'VERK' : 'SELL'}
                                </>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-txt-primary font-mono text-xs">
                            {formatTradeDate(trade.date, locale)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-txt-primary font-mono">
                            {fp(trade.price, currency)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-txt-primary font-mono">
                            {trade.shares}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {trade.type === 'sell' && trade.pnl != null ? (
                              <div className="flex flex-col items-end">
                                <span
                                  className={`font-mono text-xs font-medium ${
                                    trade.pnl >= 0 ? 'text-success' : 'text-danger'
                                  }`}
                                >
                                  {trade.pnl >= 0 ? '+' : ''}
                                  {fp(trade.pnl, currency)}
                                </span>
                                <span
                                  className={`text-[10px] ${
                                    (trade.pnlPercent ?? 0) >= 0 ? 'text-success' : 'text-danger'
                                  }`}
                                >
                                  ({formatPercent(trade.pnlPercent ?? 0)})
                                </span>
                              </div>
                            ) : (
                              <span className="text-txt-muted text-xs">--</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {result.trades.length === 0 && (
            <div className="card p-8 text-center">
              <Activity className="w-12 h-12 text-txt-muted mx-auto mb-3" />
              <p className="text-txt-secondary">
                {de
                  ? 'Keine Trades generiert. Versuche andere Parameter oder einen anderen Zeitraum.'
                  : 'No trades generated. Try different parameters or a different time range.'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Monthly Returns Heatmap ───

const MONTH_LABELS_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONTH_LABELS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getHeatmapCellColor(pct: number): string {
  const clamped = Math.max(-10, Math.min(10, pct));
  if (clamped >= 0) {
    const t = clamped / 10;
    return `rgba(38, 166, 154, ${0.15 + t * 0.7})`;
  } else {
    const t = -clamped / 10;
    return `rgba(239, 83, 80, ${0.15 + t * 0.7})`;
  }
}

function MonthlyReturnsHeatmap({
  data,
  trades,
  initialCapital,
  de,
}: {
  data: OHLCVData[];
  trades: Trade[];
  initialCapital: number;
  de: boolean;
}) {
  // Build daily portfolio values
  const dailyValues: { date: Date; value: number }[] = [];
  let capital = initialCapital;
  let shares = 0;
  let holding = false;
  let tradeIdx = 0;

  for (let i = 0; i < data.length; i++) {
    const price = data[i].close;
    const dateStr =
      typeof data[i].date === 'number'
        ? new Date((data[i].date as number) * 1000).toISOString().split('T')[0]
        : String(data[i].date);

    while (tradeIdx < trades.length && trades[tradeIdx].date === dateStr) {
      const trade = trades[tradeIdx];
      if (trade.type === 'buy') {
        shares = trade.shares;
        capital -= shares * trade.price;
        holding = true;
      } else {
        capital += shares * trade.price;
        shares = 0;
        holding = false;
      }
      tradeIdx++;
    }

    const value = holding ? capital + shares * price : capital;
    const d = typeof data[i].date === 'number'
      ? new Date((data[i].date as number) * 1000)
      : new Date(data[i].date);
    dailyValues.push({ date: d, value });
  }

  if (dailyValues.length < 2) return null;

  // Group by year-month and compute monthly returns
  const monthlyReturns: Record<string, Record<number, number>> = {}; // year -> month(0-11) -> return%
  const yearlyReturns: Record<string, number> = {};

  let prevMonthEnd = dailyValues[0].value;
  let prevMonth = dailyValues[0].date.getMonth();
  let prevYear = dailyValues[0].date.getFullYear();
  let yearStart = dailyValues[0].value;

  for (let i = 1; i < dailyValues.length; i++) {
    const { date, value } = dailyValues[i];
    const month = date.getMonth();
    const year = date.getFullYear();

    if (month !== prevMonth || year !== prevYear) {
      // End of previous month
      const yearKey = String(prevYear);
      if (!monthlyReturns[yearKey]) monthlyReturns[yearKey] = {};
      const ret = ((dailyValues[i - 1].value - prevMonthEnd) / prevMonthEnd) * 100;
      monthlyReturns[yearKey][prevMonth] = ret;
      prevMonthEnd = dailyValues[i - 1].value;
      prevMonth = month;

      if (year !== prevYear) {
        // Year changed — save yearly return
        yearlyReturns[String(prevYear)] = ((dailyValues[i - 1].value - yearStart) / yearStart) * 100;
        yearStart = dailyValues[i - 1].value;
        prevYear = year;
      }
    }

    // Last data point
    if (i === dailyValues.length - 1) {
      const yearKey = String(year);
      if (!monthlyReturns[yearKey]) monthlyReturns[yearKey] = {};
      const ret = ((value - prevMonthEnd) / prevMonthEnd) * 100;
      monthlyReturns[yearKey][month] = ret;
      yearlyReturns[yearKey] = ((value - yearStart) / yearStart) * 100;
    }
  }

  const years = Object.keys(monthlyReturns).sort();
  if (years.length === 0) return null;
  const monthLabels = de ? MONTH_LABELS_DE : MONTH_LABELS_EN;

  return (
    <div>
      <h2 className="text-sm font-semibold text-txt-primary flex items-center gap-2 mb-3">
        <CalendarDays className="w-4 h-4 text-accent" />
        {de ? 'Monatsrenditen' : 'Monthly Returns'}
      </h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/20">
              <th className="text-left px-2 py-2 text-txt-muted font-medium">{de ? 'Jahr' : 'Year'}</th>
              {monthLabels.map((m) => (
                <th key={m} className="text-center px-1 py-2 text-txt-muted font-medium">{m}</th>
              ))}
              <th className="text-center px-2 py-2 text-txt-muted font-medium">{de ? 'Gesamt' : 'Total'}</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <tr key={year} className="border-b border-border/10 last:border-0">
                <td className="px-2 py-1.5 text-txt-primary font-mono font-semibold">{year}</td>
                {Array.from({ length: 12 }).map((_, m) => {
                  const val = monthlyReturns[year]?.[m];
                  return (
                    <td key={m} className="px-1 py-1.5 text-center">
                      {val !== undefined ? (
                        <span
                          className="inline-block w-full px-1 py-0.5 rounded font-mono text-[11px] font-medium"
                          style={{ backgroundColor: getHeatmapCellColor(val), color: Math.abs(val) > 3 ? '#fff' : undefined }}
                        >
                          {val >= 0 ? '+' : ''}{val.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-txt-muted/30">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center">
                  {yearlyReturns[year] !== undefined ? (
                    <span
                      className={`font-mono text-[11px] font-bold ${
                        yearlyReturns[year] >= 0 ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {yearlyReturns[year] >= 0 ? '+' : ''}{yearlyReturns[year].toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-txt-muted/30">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sub-components ───

function ParamInput({
  label,
  value,
  onChange,
  min = 1,
  max = 200,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <span className="text-[11px] text-txt-muted">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-full px-3 py-1.5 bg-dark-600 border border-border/20 rounded-lg text-sm text-txt-primary font-mono focus:outline-none focus:border-accent/50"
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  const colorClass =
    positive === undefined
      ? 'text-txt-primary'
      : positive
        ? 'text-success'
        : 'text-danger';

  return (
    <div className="card p-3">
      <div className="text-[10px] text-txt-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-bold font-mono ${colorClass}`}>{value}</div>
    </div>
  );
}

function formatTradeDate(dateStr: string, locale: 'de' | 'en'): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-US', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });
  } catch {
    return dateStr;
  }
}
