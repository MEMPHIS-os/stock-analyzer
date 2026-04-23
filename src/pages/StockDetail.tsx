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
} from 'lucide-react';
import { fetchQuote, fetchChart, fetchFundamentals, fetchNews, getIntervalForRange } from '../api';
import { useApp } from '../context';
import StockChart from '../components/StockChart';
import type { StockChartRef } from '../components/StockChart';
import StockOverview from '../components/StockOverview';
import FundamentalsPanel from '../components/FundamentalsPanel';
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
import { downloadScreenshotFromCanvas, exportOHLCVtoCSV } from '../exportUtils';
import { buildEarningsMarkers } from '../utils/earningsMarkers';
import { generateStockReport } from '../utils/pdfReport';
import type { QuoteData, OHLCVData, FundamentalsData, TimeRange, ChartType, IndicatorType } from '../types';

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: '1d', label: '1T' },
  { value: '5d', label: '5T' },
  { value: '1mo', label: '1M' },
  { value: '3mo', label: '3M' },
  { value: '6mo', label: '6M' },
  { value: '1y', label: '1J' },
  { value: '2y', label: '2J' },
  { value: '5y', label: '5J' },
];

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

type TabType = 'fundamentals' | 'constituents' | 'technical' | 'news' | 'earnings' | 'forecast';

const TAB_CONFIG_STOCK: { key: TabType; i18nKey: string; icon: typeof Building2 }[] = [
  { key: 'fundamentals', i18nKey: 'detail.tab.fundamentals', icon: Building2 },
  { key: 'technical', i18nKey: 'detail.tab.technical', icon: Activity },
  { key: 'news', i18nKey: 'detail.tab.news', icon: Newspaper },
  { key: 'earnings', i18nKey: 'detail.tab.earnings', icon: CalendarDays },
  { key: 'forecast', i18nKey: 'detail.tab.forecast', icon: Target },
];

const TAB_CONFIG_INDEX: { key: TabType; i18nKey: string; icon: typeof Building2 }[] = [
  { key: 'constituents', i18nKey: 'detail.tab.constituents', icon: ListOrdered },
  { key: 'technical', i18nKey: 'detail.tab.technical', icon: Activity },
  { key: 'news', i18nKey: 'detail.tab.news', icon: Newspaper },
  { key: 'forecast', i18nKey: 'detail.tab.forecast', icon: Target },
];

export default function StockDetail() {
  const { symbol = 'AAPL' } = useParams<{ symbol: string }>();
  const { locale, activeAlerts, t } = useApp();
  const isIndex = symbol.startsWith('^');
  const TAB_CONFIG = isIndex ? TAB_CONFIG_INDEX : TAB_CONFIG_STOCK;
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [chartData, setChartData] = useState<OHLCVData[]>([]);
  const [range, setRange] = useState<TimeRange>('1y');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [indicators, setIndicators] = useState<IndicatorType[]>(['sma20']);
  const [activeTab, setActiveTab] = useState<TabType>(isIndex ? 'constituents' : 'fundamentals');
  const [loadingQuote, setLoadingQuote] = useState(true);
  const [loadingChart, setLoadingChart] = useState(true);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [yoyEnabled, setYoyEnabled] = useState(false);
  const [logScale, setLogScale] = useState(false);
  const [chartApi, setChartApi] = useState<import('lightweight-charts').IChartApi | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsData | null>(null);
  const [showEarnings, setShowEarnings] = useState(true);
  const [newsCount, setNewsCount] = useState<number | null>(null);
  const [indicatorDropdownOpen, setIndicatorDropdownOpen] = useState(false);
  const indicatorDropdownRef = useRef<HTMLDivElement>(null);
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

  // Load chart data
  const loadChart = useCallback(async () => {
    setLoadingChart(true);
    try {
      const interval = getIntervalForRange(range);
      const result = await fetchChart(symbol, range, interval);
      setChartData(result.quotes);
    } catch {
      setChartData([]);
    } finally {
      setLoadingChart(false);
    }
  }, [symbol, range]);

  useEffect(() => {
    loadChart();
  }, [loadChart]);

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
      <div className="flex gap-0.5 bg-dark-700 rounded-lg p-0.5">
        {TIME_RANGES.map((tr) => (
          <button
            key={tr.value}
            onClick={() => setRange(tr.value)}
            className={`px-${compact ? '2.5' : '3'} py-1 rounded-md text-xs font-medium transition-colors ${
              range === tr.value
                ? 'bg-accent text-white'
                : 'text-txt-secondary hover:text-txt-primary'
            }`}
          >
            {tr.label}
          </button>
        ))}
      </div>
      <div className="flex gap-0.5 bg-dark-700 rounded-lg p-0.5">
        {CHART_TYPES.map((ct) => (
          <button
            key={ct.value}
            onClick={() => setChartType(ct.value)}
            className={`p-1.5 rounded-md transition-colors ${
              chartType === ct.value
                ? 'bg-accent text-white'
                : 'text-txt-secondary hover:text-txt-primary'
            }`}
            title={ct.label}
          >
            <ct.icon className="w-4 h-4" />
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1 items-center">
        {/* Indicator dropdown */}
        <div className="relative" ref={indicatorDropdownRef}>
          <button
            onClick={() => setIndicatorDropdownOpen((prev) => !prev)}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-txt-secondary hover:text-txt-primary bg-dark-700 border border-border/20 transition-colors"
          >
            <Layers className="w-3 h-3" />
            Indikatoren
            {indicators.length > 0 && (
              <span className="px-1 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-accent text-white text-[10px] font-bold leading-none">
                {indicators.length}
              </span>
            )}
            <ChevronDown className={`w-3 h-3 transition-transform ${indicatorDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          {indicatorDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-52 bg-dark-800 border border-border/30 rounded-lg shadow-xl z-30 py-1 animate-fade-in">
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
                        className="w-full flex items-center justify-between px-3 py-1.5 text-xs hover:bg-dark-600 transition-colors"
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

        <YoYToggleButton
          enabled={yoyEnabled}
          onToggle={() => setYoyEnabled((prev) => !prev)}
          loading={yoyLoading}
        />
        <button
          onClick={() => setLogScale((prev) => !prev)}
          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
            logScale
              ? 'bg-accent/20 text-accent border border-accent/30'
              : 'text-txt-secondary hover:text-txt-primary bg-dark-700 border border-border/20'
          }`}
          title="Logarithmische Skala"
        >
          Log
        </button>
      </div>
    </>
  );

  // Fullscreen chart overlay
  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-dark-900 flex flex-col">
        <div className="flex items-center justify-between px-4 py-2 bg-dark-800 border-b border-border/30">
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold text-txt-primary">{symbol}</span>
            {chartControls(true)}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleScreenshot}
              className="p-2 hover:bg-dark-600 rounded-lg text-txt-secondary hover:text-txt-primary transition-colors"
              title="Chart als Bild speichern"
            >
              <Camera className="w-4 h-4" />
            </button>
            <button
              onClick={() => setFullscreen(false)}
              className="p-2 hover:bg-dark-600 rounded-lg text-txt-secondary hover:text-txt-primary transition-colors"
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
          ) : (
            <StockChart
              ref={chartRef}
              data={chartData}
              chartType={chartType}
              indicators={indicators}
              height={window.innerHeight - 56}
              currency={quote?.currency}
              alertLevels={symbolAlerts}
              logScale={logScale}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <StockOverview quote={quote} />

      {/* Chart controls */}
      <div className="flex flex-wrap items-center gap-4 py-2">
        {chartControls(false)}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleScreenshot}
            className="p-2 hover:bg-dark-600 rounded-lg text-txt-secondary hover:text-txt-primary transition-colors"
            title="Chart als Bild speichern"
          >
            <Camera className="w-4 h-4" />
          </button>
          <button
            onClick={handleCSVExport}
            className="p-2 hover:bg-dark-600 rounded-lg text-txt-secondary hover:text-txt-primary transition-colors"
            title="Daten als CSV exportieren"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={handlePDFReport}
            className="p-2 hover:bg-dark-600 rounded-lg text-txt-secondary hover:text-txt-primary transition-colors"
            title="PDF-Report erstellen"
          >
            <FileText className="w-4 h-4" />
          </button>
          <button
            onClick={() => setFullscreen(true)}
            className="p-2 hover:bg-dark-600 rounded-lg text-txt-secondary hover:text-txt-primary transition-colors"
            title="Vollbild"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Chart with Drawing Toolbar */}
      <div className="flex gap-2">
        <DrawingToolbar
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          onClearAll={clearAll}
          drawingCount={drawings.length}
          pendingPointsCount={pendingPoints.length}
        />
        <div className="card overflow-hidden flex-1">
          {loadingChart ? (
            <SkeletonChart />
          ) : (
            <StockChart
              ref={chartRef}
              data={chartData}
              chartType={chartType}
              indicators={indicators}
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
