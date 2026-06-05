import { useEffect, useState, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  CandlestickChart,
  LineChart,
  AreaChart,
  BarChart3,
  AlertCircle,
  Maximize2,
  Minimize2,
  Camera,
  Download,
  FileText,
  Building2,
  Activity,
  Newspaper,
  CalendarDays,
  Target,
  ListOrdered,
  ChevronDown,
  Layers,
  Briefcase,
  GitCompareArrows,
  X,
  Search,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Rewind,
  Bookmark,
  Save,
  Trash2,
} from 'lucide-react';
import { fetchQuote, fetchChart, fetchFundamentals, fetchNews, searchSymbols } from '../api';
import { useApp } from '../context';
import StockChart from '../components/StockChart';
import type { StockChartRef } from '../components/StockChart';
import ComparisonChart, { COMPARE_COLORS } from '../components/ComparisonChart';
import StockOverview from '../components/StockOverview';
import FundamentalsPanel from '../components/FundamentalsPanel';
import FundPanel from '../components/FundPanel';
import IndexConstituents from '../components/IndexConstituents';
import TechnicalSummary from '../components/TechnicalSummary';
import NewsFeed from '../components/NewsFeed';
import EarningsCalendar from '../components/EarningsCalendar';
import { ForecastPanel } from './Forecast';
import LoadingSpinner from '../components/LoadingSpinner';
import { SkeletonStockOverview, SkeletonChart, SkeletonBlock } from '../components/Skeleton';
import DrawingToolbar from '../components/DrawingToolbar';
import { YoYToggleButton, useYoYOverlay } from '../components/YoYOverlay';
import { useDrawings } from '../hooks/useDrawings';
import { useChartTemplates } from '../hooks/useChartTemplates';
import { downloadScreenshotFromCanvas, exportOHLCVtoCSV } from '../exportUtils';
import { buildEarningsMarkers } from '../utils/earningsMarkers';
import { generateStockReport } from '../utils/pdfReport';
import type { QuoteData, OHLCVData, FundamentalsData, TimeRange, ChartType, IndicatorType, ChartInterval, SearchResult } from '../types';

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: '1d', label: '1T' },
  { value: '5d', label: '5T' },
  { value: '1mo', label: '1M' },
  { value: '3mo', label: '3M' },
  { value: '6mo', label: '6M' },
  { value: 'ytd', label: 'YTD' },
  { value: '1y', label: '1J' },
  { value: '2y', label: '2J' },
  { value: '5y', label: '5J' },
  { value: 'max', label: 'Max' },
];

// Intervals Yahoo accepts per range (1m ≤ 7d, 5m/15m ≤ 60d, 1h ≤ 730d, daily+ any).
const INTERVAL_LABELS: Record<ChartInterval, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '1d': '1T', '1wk': '1W', '1mo': '1M',
};

function validIntervals(range: TimeRange): ChartInterval[] {
  switch (range) {
    case '1d': return ['1m', '5m', '15m', '1h'];
    case '5d': return ['1m', '5m', '15m', '1h', '1d'];
    case '1mo': return ['5m', '15m', '1h', '1d'];
    case '3mo':
    case '6mo':
    case 'ytd':
    case '1y': return ['1h', '1d', '1wk'];
    case '2y': return ['1h', '1d', '1wk', '1mo'];
    case '5y': return ['1d', '1wk', '1mo'];
    case 'max': return ['1d', '1wk', '1mo'];
    default: return ['1d'];
  }
}

// Sensible default interval per range (matches getIntervalForRange where it overlaps).
function defaultInterval(range: TimeRange): ChartInterval {
  switch (range) {
    case '1d': return '5m';
    case '5d': return '15m';
    case '1mo': return '1h';
    case '5y':
    case 'max': return '1wk';
    default: return '1d';
  }
}

const CHART_TYPES: { value: ChartType; label: string; icon: typeof CandlestickChart }[] = [
  { value: 'candlestick', label: 'Kerzen', icon: CandlestickChart },
  { value: 'heikinashi', label: 'Heikin Ashi', icon: BarChart3 },
  { value: 'line', label: 'Linie', icon: LineChart },
  { value: 'area', label: 'Fläche', icon: AreaChart },
];

const INDICATORS: { value: IndicatorType; label: string; group: string }[] = [
  { value: 'sma20', label: 'SMA 20', group: 'Moving Avg.' },
  { value: 'sma50', label: 'SMA 50', group: 'Moving Avg.' },
  { value: 'sma200', label: 'SMA 200', group: 'Moving Avg.' },
  { value: 'ema12', label: 'EMA 12', group: 'Moving Avg.' },
  { value: 'ema26', label: 'EMA 26', group: 'Moving Avg.' },
  { value: 'vwap', label: 'VWAP', group: 'Overlay' },
  { value: 'bb', label: 'Bollinger', group: 'Volatility' },
  { value: 'atr', label: 'ATR', group: 'Volatility' },
  { value: 'rsi', label: 'RSI', group: 'Oszillator' },
  { value: 'macd', label: 'MACD', group: 'Oszillator' },
  { value: 'stochastic', label: 'Stochastik', group: 'Oszillator' },
  { value: 'williamsR', label: 'Williams %R', group: 'Oszillator' },
  { value: 'pivotPoints', label: 'Pivot', group: 'S/R' },
];

// ── Compare control: search + add symbols to overlay on the chart ──
function CompareControl({
  onAdd,
  disabled,
  locale,
}: {
  onAdd: (symbol: string) => void;
  disabled: boolean;
  locale: 'de' | 'en';
}) {
  const de = locale === 'de';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      try { setResults(await searchSymbols(query.trim())); } catch { setResults([]); }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 ring-1 ${
          open
            ? 'bg-accent/15 text-accent ring-accent/30'
            : 'bg-dark-700/60 text-txt-secondary ring-border/10 hover:text-txt-primary hover:bg-dark-600/40'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        title={de ? 'Symbol zum Vergleich hinzufügen' : 'Add symbol to compare'}
      >
        <GitCompareArrows className="w-4 h-4" />
        {de ? 'Vergleichen' : 'Compare'}
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-2 w-64 rounded-xl shadow-depth-lg z-50 overflow-hidden animate-scale-in"
          style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', border: '1px solid var(--glass-border)' }}
        >
          <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: 'var(--glass-border)' }}>
            <Search className="w-4 h-4 text-txt-muted shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={de ? 'Symbol suchen…' : 'Search symbol…'}
              className="flex-1 bg-transparent outline-none text-sm text-txt-primary placeholder:text-txt-muted"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {results.length === 0 && query.trim() && (
              <div className="px-3 py-2 text-xs text-txt-muted">{de ? 'Keine Treffer' : 'No results'}</div>
            )}
            {results.map((r) => (
              <button
                key={r.symbol}
                onClick={() => { onAdd(r.symbol); setQuery(''); setResults([]); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-dark-600/40 transition-colors"
              >
                <span className="font-mono font-bold text-sm text-accent min-w-[52px]">{r.symbol}</span>
                <span className="text-xs text-txt-secondary truncate flex-1">{r.shortname}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type TabType = 'fundamentals' | 'constituents' | 'technical' | 'news' | 'earnings' | 'forecast' | 'fund';

const TAB_CONFIG_STOCK: { key: TabType; i18nKey: string; icon: typeof Building2 }[] = [
  { key: 'fundamentals', i18nKey: 'detail.tab.fundamentals', icon: Building2 },
  { key: 'technical', i18nKey: 'detail.tab.technical', icon: Activity },
  { key: 'news', i18nKey: 'detail.tab.news', icon: Newspaper },
  { key: 'earnings', i18nKey: 'detail.tab.earnings', icon: CalendarDays },
  { key: 'forecast', i18nKey: 'detail.tab.forecast', icon: Target },
];

const TAB_CONFIG_FUND: { key: TabType; i18nKey: string; icon: typeof Building2 }[] = [
  { key: 'fund', i18nKey: 'detail.tab.fund', icon: Briefcase },
  { key: 'fundamentals', i18nKey: 'detail.tab.fundamentals', icon: Building2 },
  { key: 'technical', i18nKey: 'detail.tab.technical', icon: Activity },
  { key: 'news', i18nKey: 'detail.tab.news', icon: Newspaper },
  { key: 'forecast', i18nKey: 'detail.tab.forecast', icon: Target },
];

const TAB_CONFIG_INDEX: { key: TabType; i18nKey: string; icon: typeof Building2 }[] = [
  { key: 'constituents', i18nKey: 'detail.tab.constituents', icon: ListOrdered },
  { key: 'technical', i18nKey: 'detail.tab.technical', icon: Activity },
  { key: 'news', i18nKey: 'detail.tab.news', icon: Newspaper },
  { key: 'forecast', i18nKey: 'detail.tab.forecast', icon: Target },
];

// Crypto has no fundamentals/earnings/analyst targets — keep it to price-based tabs.
const TAB_CONFIG_CRYPTO: { key: TabType; i18nKey: string; icon: typeof Building2 }[] = [
  { key: 'technical', i18nKey: 'detail.tab.technical', icon: Activity },
  { key: 'news', i18nKey: 'detail.tab.news', icon: Newspaper },
];

export default function StockDetail() {
  const { symbol = 'AAPL' } = useParams<{ symbol: string }>();
  const { locale, activeAlerts, t } = useApp();
  const isIndex = symbol.startsWith('^');
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const isFund = !isIndex && (quote?.quoteType === 'ETF' || quote?.quoteType === 'MUTUALFUND');
  const isCrypto = !isIndex && quote?.quoteType === 'CRYPTOCURRENCY';
  const TAB_CONFIG = isIndex ? TAB_CONFIG_INDEX : isCrypto ? TAB_CONFIG_CRYPTO : isFund ? TAB_CONFIG_FUND : TAB_CONFIG_STOCK;
  const [chartData, setChartData] = useState<OHLCVData[]>([]);
  const [range, setRange] = useState<TimeRange>('1y');
  const [chartInterval, setChartInterval] = useState<ChartInterval>('1d');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [indicators, setIndicators] = useState<IndicatorType[]>(['sma20']);
  const [activeTab, setActiveTab] = useState<TabType>(isIndex ? 'constituents' : 'fundamentals');
  const [loadingQuote, setLoadingQuote] = useState(true);
  const [loadingChart, setLoadingChart] = useState(true);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [yoyEnabled, setYoyEnabled] = useState(false);
  const [logScale, setLogScale] = useState(false);
  const [showVolProfile, setShowVolProfile] = useState(false);
  // ─── Bar replay ───
  const [replayMode, setReplayMode] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replaySpeed, setReplaySpeed] = useState(500); // ms per bar
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  const [compareData, setCompareData] = useState<Record<string, OHLCVData[]>>({});
  const [chartApi, setChartApi] = useState<import('lightweight-charts').IChartApi | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsData | null>(null);
  const [showEarnings, setShowEarnings] = useState(true);
  const [newsCount, setNewsCount] = useState<number | null>(null);
  const [indicatorDropdownOpen, setIndicatorDropdownOpen] = useState(false);
  const indicatorDropdownRef = useRef<HTMLDivElement>(null);
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const templateDropdownRef = useRef<HTMLDivElement>(null);
  const { templates, userTemplates, saveTemplate, deleteTemplate } = useChartTemplates();
  const chartRef = useRef<StockChartRef>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const {
    drawings, activeTool, setActiveTool, pendingPoints, pendingTextPoint,
    handleChartClick, confirmTextDrawing, cancelTextDrawing,
    cancelDrawing, removeDrawing, updateDrawing, clearAll,
  } = useDrawings(symbol);

  // Filter alerts for the current symbol
  const symbolAlerts = useMemo(() =>
    activeAlerts.filter(a => a.symbol === symbol.toUpperCase()),
    [activeAlerts, symbol]
  );

  // ─── Bar replay: feed the chart a truncated slice while replaying ───
  const displayChartData = useMemo(
    () => (replayMode ? chartData.slice(0, replayIndex + 1) : chartData),
    [replayMode, chartData, replayIndex]
  );

  // Leaving replay (or a fresh chart load) resets the playhead
  useEffect(() => {
    setReplayMode(false);
    setReplayPlaying(false);
  }, [symbol, range, chartInterval]);

  const enterReplay = useCallback(() => {
    if (chartData.length < 5) return;
    // Start ~60% in so there is both history and "future" to step through
    setReplayIndex(Math.max(2, Math.floor(chartData.length * 0.6)));
    setReplayMode(true);
    setReplayPlaying(false);
  }, [chartData.length]);

  const exitReplay = useCallback(() => {
    setReplayMode(false);
    setReplayPlaying(false);
  }, []);

  const stepReplay = useCallback((delta: number) => {
    setReplayPlaying(false);
    setReplayIndex((i) => Math.min(chartData.length - 1, Math.max(0, i + delta)));
  }, [chartData.length]);

  // Playback timer
  useEffect(() => {
    if (!replayMode || !replayPlaying) return;
    const id = window.setInterval(() => {
      setReplayIndex((i) => {
        if (i >= chartData.length - 1) {
          setReplayPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, replaySpeed);
    return () => window.clearInterval(id);
  }, [replayMode, replayPlaying, replaySpeed, chartData.length]);

  // Track the chart API instance (updates when chart is recreated)
  useEffect(() => {
    // Short delay to ensure StockChart has finished rendering and the ref is set
    const timer = setTimeout(() => {
      setChartApi(chartRef.current?.getChartApi() ?? null);
    }, 50);
    return () => clearTimeout(timer);
  }, [chartData, chartType, indicators, loadingChart]);

  // YoY overlay hook
  const { loading: yoyLoading } = useYoYOverlay({
    symbol,
    currentData: chartData,
    range,
    chartApi,
    enabled: yoyEnabled,
  });

  // Load quote
  useEffect(() => {
    let cancelled = false;
    setLoadingQuote(true);
    setError('');

    fetchQuote(symbol)
      .then((data) => {
        if (!cancelled) setQuote(data);
      })
      .catch(() => {
        if (!cancelled) setError('Kursdaten konnten nicht geladen werden.');
      })
      .finally(() => {
        if (!cancelled) setLoadingQuote(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Load fundamentals (for earnings markers + PDF report)
  useEffect(() => {
    let cancelled = false;
    fetchFundamentals(symbol)
      .then((data) => { if (!cancelled) setFundamentals(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [symbol]);

  // Earnings markers computed from fundamentals
  const earningsMarkers = useMemo(() => {
    if (!showEarnings || !fundamentals?.earnings?.earningsChart?.quarterly) return [];
    return buildEarningsMarkers(fundamentals.earnings.earningsChart.quarterly, locale, quote?.currency);
  }, [showEarnings, fundamentals, locale, quote?.currency]);

  // When the range changes, snap the interval back to a sensible default that
  // is valid for that range (Yahoo rejects e.g. 1m for multi-year ranges).
  useEffect(() => {
    setChartInterval((prev) => (validIntervals(range).includes(prev) ? prev : defaultInterval(range)));
  }, [range]);

  // Load chart data
  const loadChart = useCallback(async () => {
    setLoadingChart(true);
    try {
      const result = await fetchChart(symbol, range, chartInterval);
      setChartData(result.quotes);
    } catch {
      setChartData([]);
    } finally {
      setLoadingChart(false);
    }
  }, [symbol, range, chartInterval]);

  useEffect(() => {
    loadChart();
  }, [loadChart]);

  // Reset comparison overlay when navigating to a different symbol.
  useEffect(() => {
    setCompareSymbols([]);
    setCompareData({});
  }, [symbol]);

  // Once the asset kind is known, snap the active tab to a valid one
  // (e.g. crypto has no fundamentals/earnings/forecast tabs).
  useEffect(() => {
    if (!TAB_CONFIG.some((tab) => tab.key === activeTab)) {
      setActiveTab(TAB_CONFIG[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCrypto, isFund, isIndex]);

  // Fetch chart data for each compared symbol (same range + interval as primary).
  useEffect(() => {
    if (compareSymbols.length === 0) { setCompareData({}); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        compareSymbols.map(async (s) => {
          try {
            const r = await fetchChart(s, range, chartInterval);
            return [s, r.quotes] as const;
          } catch {
            return [s, [] as OHLCVData[]] as const;
          }
        }),
      );
      if (!cancelled) setCompareData(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [compareSymbols, range, chartInterval]);

  const compareMode = compareSymbols.length > 0;
  const compareEntries = useMemo(
    () => compareSymbols.map((s, i) => ({
      symbol: s,
      data: compareData[s] || [],
      color: COMPARE_COLORS[i % COMPARE_COLORS.length],
    })),
    [compareSymbols, compareData],
  );
  const addCompare = useCallback((sym: string) => {
    const s = sym.toUpperCase();
    setCompareSymbols((prev) =>
      prev.includes(s) || s === symbol.toUpperCase() || prev.length >= 4 ? prev : [...prev, s],
    );
  }, [symbol]);
  const removeCompare = useCallback((sym: string) => {
    setCompareSymbols((prev) => prev.filter((x) => x !== sym));
  }, []);

  // Auto-refresh quote every 30s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await fetchQuote(symbol);
        setQuote(data);
      } catch {}
    }, 30000);
    return () => clearInterval(interval);
  }, [symbol]);

  // Fetch news count for badge
  useEffect(() => {
    fetchNews(symbol).then((items) => setNewsCount(items.length)).catch(() => {});
  }, [symbol]);

  // Animated tab indicator
  useLayoutEffect(() => {
    if (!tabsRef.current) return;
    const container = tabsRef.current;
    const idx = TAB_CONFIG.findIndex((t) => t.key === activeTab);
    const btn = container.children[idx] as HTMLElement | undefined;
    if (btn) {
      setIndicatorStyle({
        left: btn.offsetLeft,
        width: btn.offsetWidth,
      });
    }
  }, [activeTab]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      switch (e.key) {
        case 'f':
        case 'F':
          setFullscreen((prev) => !prev);
          break;
        case 'c':
        case 'C':
          setChartType('candlestick');
          break;
        case 'l':
        case 'L':
          setChartType('line');
          break;
        case 'a':
        case 'A':
          setChartType('area');
          break;
        case 'h':
        case 'H':
          setChartType('heikinashi');
          break;
        case '1':
          setRange('1d');
          break;
        case '2':
          setRange('5d');
          break;
        case '3':
          setRange('1mo');
          break;
        case '4':
          setRange('3mo');
          break;
        case '5':
          setRange('6mo');
          break;
        case '6':
          setRange('1y');
          break;
        case '7':
          setRange('2y');
          break;
        case '8':
          setRange('5y');
          break;
        case 'Escape':
          setFullscreen(false);
          cancelDrawing();
          break;
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Close indicator dropdown on outside click
  useEffect(() => {
    if (!indicatorDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (indicatorDropdownRef.current && !indicatorDropdownRef.current.contains(e.target as Node)) {
        setIndicatorDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [indicatorDropdownOpen]);

  useEffect(() => {
    if (!templateDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) {
        setTemplateDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [templateDropdownOpen]);

  function applyTemplate(tpl: { indicators: IndicatorType[]; chartType: ChartType }) {
    setIndicators([...tpl.indicators]);
    setChartType(tpl.chartType);
    setTemplateDropdownOpen(false);
  }

  function handleSaveTemplate() {
    const name = window.prompt(locale === 'de' ? 'Name der Vorlage:' : 'Template name:');
    if (name) saveTemplate(name, indicators, chartType);
  }

  function toggleIndicator(ind: IndicatorType) {
    setIndicators((prev) =>
      prev.includes(ind) ? prev.filter((i) => i !== ind) : [...prev, ind]
    );
  }

  function handleScreenshot() {
    const canvas = chartRef.current?.takeScreenshot();
    if (canvas) downloadScreenshotFromCanvas(canvas, symbol);
  }

  function handleCSVExport() {
    exportOHLCVtoCSV(chartData, symbol);
  }

  async function handlePDFReport() {
    if (!quote) return;
    const canvas = chartRef.current?.takeScreenshot() ?? undefined;
    await generateStockReport({
      symbol,
      name: quote.shortName || quote.longName || symbol,
      quote,
      fundamentals: fundamentals ?? undefined,
      chartCanvas: canvas,
      locale,
    });
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <AlertCircle className="w-12 h-12 text-danger mb-4" />
        <p className="text-txt-primary font-medium">{error}</p>
        <p className="text-sm text-txt-secondary mt-1">
          Prüfe, ob das Symbol "{symbol}" korrekt ist.
        </p>
      </div>
    );
  }

  if (loadingQuote) {
    return (
      <div className="space-y-4">
        <SkeletonStockOverview />
        <div className="flex flex-wrap items-center gap-4">
          <SkeletonBlock className="h-8 w-64 rounded-lg" />
          <SkeletonBlock className="h-8 w-40 rounded-lg" />
        </div>
        <SkeletonChart />
      </div>
    );
  }
  if (!quote) return null;

  const chartControls = (compact = false) => (
    <>
      <div className="flex gap-0.5 bg-dark-700/60 ring-1 ring-border/10 rounded-xl p-1">
        {TIME_RANGES.map((tr) => (
          <button
            key={tr.value}
            onClick={() => setRange(tr.value)}
            className={`${compact ? 'px-2.5' : 'px-3'} py-1 rounded-lg text-xs font-semibold transition-all duration-200 ${
              range === tr.value
                ? 'bg-accent text-white shadow-glow-sm'
                : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40'
            }`}
          >
            {tr.label}
          </button>
        ))}
      </div>
      <div className="flex gap-0.5 bg-dark-700/60 ring-1 ring-border/10 rounded-xl p-1">
        {CHART_TYPES.map((ct) => (
          <button
            key={ct.value}
            onClick={() => setChartType(ct.value)}
            className={`p-1.5 rounded-lg transition-all duration-200 ${
              chartType === ct.value
                ? 'bg-accent text-white shadow-glow-sm'
                : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40'
            }`}
            title={ct.label}
          >
            <ct.icon className="w-4 h-4" />
          </button>
        ))}
      </div>
      {/* Interval selector (valid options depend on the chosen range) */}
      <div className="flex gap-0.5 bg-dark-700/60 ring-1 ring-border/10 rounded-xl p-1" title={locale === 'de' ? 'Kerzen-Intervall' : 'Candle interval'}>
        {validIntervals(range).map((iv) => (
          <button
            key={iv}
            onClick={() => setChartInterval(iv)}
            className={`${compact ? 'px-2' : 'px-2.5'} py-1 rounded-lg text-xs font-semibold transition-all duration-200 ${
              chartInterval === iv
                ? 'bg-accent text-white shadow-glow-sm'
                : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40'
            }`}
          >
            {INTERVAL_LABELS[iv]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1 items-center">
        {/* Indicator dropdown */}
        <div className="relative" ref={indicatorDropdownRef}>
          <button
            onClick={() => setIndicatorDropdownOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ${
              indicatorDropdownOpen || indicators.length > 0
                ? 'bg-accent/10 text-accent ring-1 ring-accent/20'
                : 'text-txt-secondary hover:text-txt-primary bg-dark-700/60 ring-1 ring-border/10'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Indikatoren
            {indicators.length > 0 && (
              <span className="px-1 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-accent text-white text-[10px] font-bold leading-none">
                {indicators.length}
              </span>
            )}
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${indicatorDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {indicatorDropdownOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-52 card border border-border/20 rounded-xl shadow-depth-lg z-30 py-1.5 animate-scale-in">
              {(['Moving Avg.', 'Overlay', 'Volatility', 'Oszillator', 'S/R'] as const).map((group) => {
                const items = INDICATORS.filter((i) => i.group === group);
                if (!items.length) return null;
                return (
                  <div key={group}>
                    <div className="px-3 py-1 text-[10px] font-semibold text-txt-muted uppercase tracking-wider">{group}</div>
                    {items.map((ind) => (
                      <button
                        key={ind.value}
                        onClick={() => toggleIndicator(ind.value)}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-dark-600/40 transition-colors"
                      >
                        <span className={indicators.includes(ind.value) ? 'text-accent font-medium' : 'text-txt-primary'}>
                          {ind.label}
                        </span>
                        {indicators.includes(ind.value) && (
                          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                        )}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Template dropdown */}
        <div className="relative" ref={templateDropdownRef}>
          <button
            onClick={() => setTemplateDropdownOpen((prev) => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ${
              templateDropdownOpen
                ? 'bg-accent/10 text-accent ring-1 ring-accent/20'
                : 'text-txt-secondary hover:text-txt-primary bg-dark-700/60 ring-1 ring-border/10'
            }`}
            title={locale === 'de' ? 'Chart-Vorlagen' : 'Chart templates'}
          >
            <Bookmark className="w-3.5 h-3.5" />
            {locale === 'de' ? 'Vorlagen' : 'Templates'}
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${templateDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {templateDropdownOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-64 card border border-border/20 rounded-xl shadow-depth-lg z-30 py-1.5 animate-scale-in">
              {templates.map((tpl) => {
                const isUser = userTemplates.some((u) => u.id === tpl.id);
                return (
                  <div
                    key={tpl.id}
                    className="group w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-dark-600/40 transition-colors"
                  >
                    <button onClick={() => applyTemplate(tpl)} className="flex-1 text-left text-txt-primary truncate">
                      {tpl.name}
                      <span className="ml-1.5 text-[10px] text-txt-muted">{tpl.indicators.length} Ind.</span>
                    </button>
                    {isUser && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteTemplate(tpl.id); }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-txt-muted hover:text-danger transition-all"
                        title={locale === 'de' ? 'Löschen' : 'Delete'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="border-t border-border/20 mt-1 pt-1">
                <button
                  onClick={handleSaveTemplate}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-accent font-medium hover:bg-dark-600/40 transition-colors"
                >
                  <Save className="w-3.5 h-3.5" />
                  {locale === 'de' ? 'Aktuelles Setup speichern…' : 'Save current setup…'}
                </button>
              </div>
            </div>
          )}
        </div>

        <YoYToggleButton
          enabled={yoyEnabled}
          onToggle={() => setYoyEnabled((prev) => !prev)}
          loading={yoyLoading}
        />
        <button
          onClick={() => setLogScale((prev) => !prev)}
          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ${
            logScale
              ? 'bg-accent/10 text-accent ring-1 ring-accent/20'
              : 'text-txt-secondary hover:text-txt-primary bg-dark-700/60 ring-1 ring-border/10'
          }`}
          title="Logarithmische Skala"
        >
          Log
        </button>
        <button
          onClick={() => setShowVolProfile((prev) => !prev)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ${
            showVolProfile
              ? 'bg-accent/10 text-accent ring-1 ring-accent/20'
              : 'text-txt-secondary hover:text-txt-primary bg-dark-700/60 ring-1 ring-border/10'
          }`}
          title={locale === 'de' ? 'Volume Profile (VPVR)' : 'Volume Profile (VPVR)'}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          VP
        </button>
        <button
          onClick={() => (replayMode ? exitReplay() : enterReplay())}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-200 ${
            replayMode
              ? 'bg-accent/10 text-accent ring-1 ring-accent/20'
              : 'text-txt-secondary hover:text-txt-primary bg-dark-700/60 ring-1 ring-border/10'
          }`}
          title={locale === 'de' ? 'Bar-Replay (Historie abspielen)' : 'Bar replay'}
        >
          <Play className="w-3.5 h-3.5" />
          Replay
        </button>
      </div>
    </>
  );

  // ─── Replay control bar ───
  const replayBar = () => {
    if (!replayMode) return null;
    const bar = chartData[replayIndex];
    const barDate = bar
      ? (typeof bar.date === 'number'
          ? new Date(bar.date * 1000).toLocaleString(locale === 'de' ? 'de-DE' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
          : String(bar.date))
      : '';
    const atEnd = replayIndex >= chartData.length - 1;
    const SPEEDS = [
      { label: '0.5×', ms: 1000 },
      { label: '1×', ms: 500 },
      { label: '2×', ms: 250 },
      { label: '4×', ms: 100 },
    ];
    return (
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 rounded-xl bg-dark-700/60 ring-1 ring-border/10">
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => stepReplay(-10)}
            className="p-1.5 rounded-lg text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40 transition-all duration-200"
            title={locale === 'de' ? '10 Bars zurück' : 'Back 10 bars'}
          >
            <Rewind className="w-4 h-4" />
          </button>
          <button
            onClick={() => stepReplay(-1)}
            className="p-1.5 rounded-lg text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40 transition-all duration-200"
            title={locale === 'de' ? 'Ein Bar zurück' : 'Step back'}
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={() => setReplayPlaying((p) => !p)}
            disabled={atEnd}
            className="p-1.5 rounded-lg bg-accent text-white shadow-glow-sm hover:opacity-90 transition-all duration-200 disabled:opacity-40"
            title={replayPlaying ? (locale === 'de' ? 'Pause' : 'Pause') : (locale === 'de' ? 'Abspielen' : 'Play')}
          >
            {replayPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={() => stepReplay(1)}
            className="p-1.5 rounded-lg text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40 transition-all duration-200"
            title={locale === 'de' ? 'Ein Bar vor' : 'Step forward'}
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Scrubber */}
        <input
          type="range"
          min={1}
          max={Math.max(1, chartData.length - 1)}
          value={replayIndex}
          onChange={(e) => { setReplayPlaying(false); setReplayIndex(Number(e.target.value)); }}
          className="flex-1 min-w-[140px] accent-accent h-1.5 cursor-pointer"
        />

        <span className="text-xs font-mono text-txt-secondary tabular-nums whitespace-nowrap">
          {replayIndex + 1}/{chartData.length}
        </span>
        <span className="text-xs text-txt-muted whitespace-nowrap hidden sm:inline">{barDate}</span>

        {/* Speed */}
        <div className="flex gap-0.5 bg-dark-800/60 ring-1 ring-border/10 rounded-lg p-0.5">
          {SPEEDS.map((s) => (
            <button
              key={s.ms}
              onClick={() => setReplaySpeed(s.ms)}
              className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all duration-200 ${
                replaySpeed === s.ms ? 'bg-accent text-white' : 'text-txt-secondary hover:text-txt-primary'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <button
          onClick={exitReplay}
          className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-txt-secondary hover:text-danger hover:bg-danger/10 transition-all duration-200"
        >
          {locale === 'de' ? 'Beenden' : 'Exit'}
        </button>
      </div>
    );
  };

  // Fullscreen chart overlay
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-dark-900 flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 bg-dark-800 border-b border-border/30">
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold text-txt-primary">{symbol}</span>
            {chartControls(true)}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={handleScreenshot}
              className="p-2 hover:bg-dark-600/40 rounded-lg text-txt-secondary hover:text-txt-primary transition-all duration-200"
              title="Chart als Bild speichern"
            >
              <Camera className="w-4 h-4" />
            </button>
            <button
              onClick={() => setFullscreen(false)}
              className="p-2 hover:bg-dark-600/40 rounded-lg text-txt-secondary hover:text-txt-primary transition-all duration-200"
              title="Vollbild beenden (Esc)"
            >
              <Minimize2 className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1">
          {loadingChart ? (
            <div className="h-full flex items-center justify-center">
              <LoadingSpinner text="Lade Chart..." />
            </div>
          ) : compareMode ? (
            <ComparisonChart
              primarySymbol={symbol.toUpperCase()}
              primaryData={chartData}
              compares={compareEntries}
              height={window.innerHeight - 56}
            />
          ) : (
            <StockChart
              ref={chartRef}
              data={displayChartData}
              chartType={chartType}
              indicators={indicators}
              height={window.innerHeight - (replayMode ? 104 : 56)}
              currency={quote?.currency}
              alertLevels={symbolAlerts}
              logScale={logScale}
              showVolumeProfile={showVolProfile}
            />
          )}
        </div>
        {!compareMode && replayMode && <div className="px-4 py-2 bg-dark-800 border-t border-border/30">{replayBar()}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <StockOverview quote={quote} />

      {/* Chart controls */}
      <div className="flex flex-wrap items-center gap-4 py-2">
        {chartControls(false)}

        <CompareControl onAdd={addCompare} disabled={compareSymbols.length >= 4} locale={locale} />

        <div className="ml-auto flex items-center gap-0.5 bg-dark-700/60 ring-1 ring-border/10 rounded-xl p-1">
          <button
            onClick={handleScreenshot}
            className="p-1.5 hover:bg-dark-600/40 rounded-lg text-txt-secondary hover:text-txt-primary transition-all duration-200"
            title="Chart als Bild speichern"
          >
            <Camera className="w-4 h-4" />
          </button>
          <button
            onClick={handleCSVExport}
            className="p-1.5 hover:bg-dark-600/40 rounded-lg text-txt-secondary hover:text-txt-primary transition-all duration-200"
            title="Daten als CSV exportieren"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={handlePDFReport}
            className="p-1.5 hover:bg-dark-600/40 rounded-lg text-txt-secondary hover:text-txt-primary transition-all duration-200"
            title="PDF-Report erstellen"
          >
            <FileText className="w-4 h-4" />
          </button>
          <button
            onClick={() => setFullscreen(true)}
            className="p-1.5 hover:bg-dark-600/40 rounded-lg text-txt-secondary hover:text-txt-primary transition-all duration-200"
            title="Vollbild"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Comparison chips */}
      {compareMode && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider font-semibold text-txt-muted">
            {locale === 'de' ? 'Vergleich (% norm.)' : 'Compare (% norm.)'}
          </span>
          <span className="flex items-center gap-1.5 text-xs font-mono font-bold px-2 py-1 rounded-lg bg-dark-700/60 ring-1 ring-border/10">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--accent)' }} />
            {symbol.toUpperCase()}
          </span>
          {compareEntries.map((c) => (
            <span
              key={c.symbol}
              className="flex items-center gap-1.5 text-xs font-mono font-bold px-2 py-1 rounded-lg bg-dark-700/60 ring-1 ring-border/10"
            >
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.color }} />
              {c.symbol}
              <button
                onClick={() => removeCompare(c.symbol)}
                className="ml-0.5 text-txt-muted hover:text-danger transition-colors"
                title={locale === 'de' ? 'Entfernen' : 'Remove'}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Replay control bar */}
      {!compareMode && replayMode && replayBar()}

      {/* Chart with Drawing Toolbar */}
      <div className="flex gap-2">
        {!compareMode && (
          <DrawingToolbar
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            onClearAll={clearAll}
            drawingCount={drawings.length}
            pendingPointsCount={pendingPoints.length}
          />
        )}
        <div className="card overflow-hidden flex-1">
          {loadingChart ? (
            <SkeletonChart />
          ) : compareMode ? (
            <ComparisonChart
              primarySymbol={symbol.toUpperCase()}
              primaryData={chartData}
              compares={compareEntries}
              height={480}
            />
          ) : (
            <StockChart
              ref={chartRef}
              data={displayChartData}
              chartType={chartType}
              indicators={indicators}
              showVolumeProfile={showVolProfile}
              drawings={drawings}
              onChartClick={handleChartClick}
              onRemoveDrawing={removeDrawing}
              onUpdateDrawing={updateDrawing}
              drawingActive={activeTool !== 'none'}
              pendingTextPoint={pendingTextPoint}
              onConfirmText={confirmTextDrawing}
              onCancelText={cancelTextDrawing}
              markers={earningsMarkers}
              currency={quote?.currency}
              alertLevels={symbolAlerts}
              logScale={logScale}
            />
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="relative border-b border-border/30">
        <div ref={tabsRef} className="flex gap-0 overflow-x-auto scrollbar-hide">
          {TAB_CONFIG.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`tab-btn flex items-center gap-1.5 whitespace-nowrap ${isActive ? 'active' : ''}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t(tab.i18nKey)}
                {tab.key === 'news' && newsCount !== null && newsCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-accent/15 text-accent leading-none">
                    {newsCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* Animated sliding indicator */}
        <div
          className="absolute bottom-0 h-0.5 bg-accent rounded-full transition-all duration-300 ease-in-out"
          style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
        />
      </div>

      {/* Tab content */}
      <div className="pb-8">
        {activeTab === 'constituents' && isIndex && <IndexConstituents indexSymbol={symbol} />}
        {activeTab === 'fund' && isFund && <FundPanel symbol={symbol} currency={quote?.currency} />}
        {activeTab === 'fundamentals' && !isIndex && <FundamentalsPanel symbol={symbol} currency={quote?.currency} />}
        {activeTab === 'technical' && <TechnicalSummary data={chartData} />}
        {activeTab === 'news' && <NewsFeed symbol={symbol} />}
        {activeTab === 'earnings' && !isIndex && (
          <EarningsCalendar earnings={fundamentals?.earnings} currency={quote?.currency || 'USD'} />
        )}
        {activeTab === 'forecast' && <ForecastPanel symbol={symbol} />}
      </div>
    </div>
  );
}
