import { useEffect, useState, useRef, useCallback, useId, useMemo, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Settings,
  X,
  RotateCcw,
  GripVertical,
  LineChart,
  PieChart,
  LayoutDashboard,
  Wallet,
} from 'lucide-react';
import { useApp } from '../context';
import { fetchQuotes, fetchSparklines, fetchScreener } from '../api';
import type { ScreenerStock } from '../api';
import { formatPercent, formatChange } from '../formatters';
import { usePrice } from '../hooks/usePrice';
import { usePortfolio } from '../hooks/usePortfolio';
import LoadingSpinner from '../components/LoadingSpinner';
import StockContextMenu from '../components/ContextMenu';
import { SkeletonCard, SkeletonTableRow } from '../components/Skeleton';
import { useContextMenu } from '../hooks/useContextMenu';
import { useDashboardLayout, getWidgetLabel } from '../hooks/useDashboardLayout';
import type { DashboardWidget } from '../hooks/useDashboardLayout';
import type { QuoteData } from '../types';

// ─── Constants ───

const MARKET_OVERVIEW_INDICES = ['^GSPC', '^IXIC', '^DJI', '^GDAXI', '^FTSE'];
const INDEX_NAMES: Record<string, string> = {
  '^GSPC': 'S&P 500',
  '^IXIC': 'NASDAQ',
  '^DJI': 'Dow Jones',
  '^GDAXI': 'DAX',
  '^FTSE': 'FTSE 100',
  '^RUT': 'Russell 2000',
};

const MAJOR_INDICES = ['^DJI', '^GSPC', '^IXIC', '^RUT'];
const MAJOR_INDEX_NAMES: Record<string, string> = {
  '^DJI': 'Dow Jones',
  '^GSPC': 'S&P 500',
  '^IXIC': 'NASDAQ',
  '^RUT': 'Russell 2000',
};

const SECTOR_ETFS = ['XLK', 'XLF', 'XLV', 'XLE', 'XLY', 'XLP', 'XLI', 'XLB', 'XLRE', 'XLU', 'XLC'];
const SECTOR_NAMES: Record<string, string> = {
  XLK: 'Technology',
  XLF: 'Financials',
  XLV: 'Health Care',
  XLE: 'Energy',
  XLY: 'Cons. Discr.',
  XLP: 'Cons. Staples',
  XLI: 'Industrials',
  XLB: 'Materials',
  XLRE: 'Real Estate',
  XLU: 'Utilities',
  XLC: 'Comm. Services',
};

// ─── MiniSparkline ───

function MiniSparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const reactId = useId();
  if (!data.length || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 32;
  const w = 80;
  const id = `spark-${reactId}`;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const areaPoints = `0,${h} ${points} ${w},${h}`;
  const color = positive ? '#26a69a' : '#ef5350';

  return (
    <svg width={w} height={h} className="mt-1">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${id})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── BackdropSparkline (full-bleed, sits behind card content) ───

function BackdropSparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const reactId = useId();
  if (!data.length || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 100;
  const h = 40;
  const id = `bspark-${reactId}`;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 3) - 1.5;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = pts.join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  const color = positive ? '#26a69a' : '#ef5350';

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="absolute inset-x-0 bottom-0 w-full h-12 pointer-events-none opacity-90 transition-opacity duration-300 group-hover:opacity-100"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.20" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeOpacity="0.5"
        strokeWidth="1.25"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Config Panel ───

interface ConfigPanelProps {
  widgets: DashboardWidget[];
  onToggle: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onReset: () => void;
  onClose: () => void;
}

function ConfigPanel({ widgets, onToggle, onReorder, onReset, onClose }: ConfigPanelProps) {
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => (e: DragEvent<HTMLDivElement>) => {
    dragItem.current = index;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (index: number) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragOverItem.current = index;
    setDragOverIndex(index);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
      onReorder(dragItem.current, dragOverItem.current);
    }
    dragItem.current = null;
    dragOverItem.current = null;
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    dragItem.current = null;
    dragOverItem.current = null;
    setDragOverIndex(null);
  };

  return (
    <div className="card-glow p-5 mb-6 animate-scale-in">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-txt-primary">Dashboard konfigurieren</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 text-xs text-txt-secondary hover:text-txt-primary transition-all duration-200 px-2.5 py-1.5 rounded-lg hover:bg-dark-600/40"
            title="Zurücksetzen"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
          <button
            onClick={onClose}
            className="text-txt-secondary hover:text-txt-primary transition-all duration-200 p-1.5 rounded-lg hover:bg-dark-600/40"
            title="Schließen"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <p className="text-xs text-txt-muted mb-4">Widgets ein-/ausblenden und per Drag & Drop umsortieren.</p>
      <div className="space-y-1.5">
        {widgets.map((widget, index) => (
          <div
            key={widget.id}
            draggable
            onDragStart={handleDragStart(index)}
            onDragOver={handleDragOver(index)}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 select-none ${
              dragOverIndex === index ? 'bg-accent/15 border border-accent/30 shadow-glow-sm' : 'hover:bg-dark-600/30 border border-transparent'
            }`}
          >
            <GripVertical className="w-4 h-4 text-txt-muted cursor-grab flex-shrink-0" />
            <label className="flex items-center gap-2.5 flex-1 cursor-pointer">
              <input
                type="checkbox"
                checked={widget.visible}
                onChange={() => onToggle(widget.id)}
                className="accent-accent w-4 h-4 cursor-pointer rounded"
              />
              <span className="text-sm text-txt-primary">{getWidgetLabel(widget.type)}</span>
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Market Indices Widget ───

function MarketIndicesWidget({ quotes, navigate, locale }: { quotes: QuoteData[]; navigate: (path: string) => void; locale: 'de' | 'en' }) {
  const { fp } = usePrice();
  const filtered = quotes.filter((q) => MAJOR_INDICES.includes(q.symbol));
  if (filtered.length === 0) return null;

  return (
    <div className="animate-slide-up">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-1.5 rounded-lg bg-accent/10">
          <LineChart className="w-5 h-5 text-accent" />
        </div>
        <h2 className="section-title">Marktindizes</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger-children">
        {filtered.map((idx) => {
          const isPositive = idx.regularMarketChange >= 0;
          return (
            <div
              key={idx.symbol}
              className="card p-4 cursor-pointer group"
              onClick={() => navigate(`/stock/${idx.symbol}`)}
            >
              <div className="text-xs text-txt-secondary mb-1 font-medium">
                {MAJOR_INDEX_NAMES[idx.symbol] || idx.shortName || idx.symbol}
              </div>
              <div className="text-lg font-bold font-mono text-txt-primary">
                {fp(idx.regularMarketPrice, idx.currency)}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-lg ${isPositive ? 'bg-success/10' : 'bg-danger/10'}`}>
                  {isPositive ? (
                    <ArrowUpRight className="w-3.5 h-3.5 text-success" />
                  ) : (
                    <ArrowDownRight className="w-3.5 h-3.5 text-danger" />
                  )}
                  <span className={`text-sm font-mono font-semibold ${isPositive ? 'text-success' : 'text-danger'}`}>
                    {formatPercent(idx.regularMarketChangePercent)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sector Performance Widget ───

function SectorPerformanceWidget({ quotes }: { quotes: QuoteData[] }) {
  const sectorQuotes = SECTOR_ETFS.map((sym) => quotes.find((q) => q.symbol === sym)).filter(
    (q): q is QuoteData => q != null
  );

  if (sectorQuotes.length === 0) return null;

  const sorted = [...sectorQuotes].sort(
    (a, b) => (b.regularMarketChangePercent || 0) - (a.regularMarketChangePercent || 0)
  );

  const maxAbs = Math.max(...sorted.map((q) => Math.abs(q.regularMarketChangePercent || 0)), 0.01);

  return (
    <div className="animate-slide-up">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-1.5 rounded-lg bg-accent/10">
          <PieChart className="w-5 h-5 text-accent" />
        </div>
        <h2 className="section-title">Sektor-Performance</h2>
      </div>
      <div className="card p-5">
        <div className="space-y-2.5">
          {sorted.map((q) => {
            const pct = q.regularMarketChangePercent || 0;
            const isPositive = pct >= 0;
            const barWidth = Math.max((Math.abs(pct) / maxAbs) * 100, 2);
            return (
              <div key={q.symbol} className="flex items-center gap-3 group">
                <div className="w-28 flex-shrink-0 text-xs text-txt-secondary truncate font-medium group-hover:text-txt-primary transition-colors" title={SECTOR_NAMES[q.symbol]}>
                  {SECTOR_NAMES[q.symbol] || q.symbol}
                </div>
                <div className="flex-1 flex items-center">
                  {isPositive ? (
                    <div className="flex items-center w-full">
                      <div
                        className="h-6 rounded-md"
                        style={{
                          width: `${barWidth}%`,
                          minWidth: '4px',
                          transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                          background: `linear-gradient(90deg, rgba(38, 166, 154, 0.3) 0%, rgba(38, 166, 154, 0.7) 100%)`,
                        }}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-end w-full">
                      <div
                        className="h-6 rounded-md"
                        style={{
                          width: `${barWidth}%`,
                          minWidth: '4px',
                          transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                          background: `linear-gradient(90deg, rgba(239, 83, 80, 0.7) 0%, rgba(239, 83, 80, 0.3) 100%)`,
                        }}
                      />
                    </div>
                  )}
                </div>
                <div className={`w-16 text-right text-xs font-mono font-semibold flex-shrink-0 ${isPositive ? 'text-success' : 'text-danger'}`}>
                  {formatPercent(pct)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard Hero ───

interface PortfolioSnapshot {
  totalValue: number;
  dayChange: number;
  dayChangePercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  currency: string;
}

function DashboardHero({
  indices,
  snapshot,
  configOpen,
  onToggleConfig,
  navigate,
  locale,
  t,
}: {
  indices: QuoteData[];
  snapshot: PortfolioSnapshot | null;
  configOpen: boolean;
  onToggleConfig: () => void;
  navigate: (path: string) => void;
  locale: 'de' | 'en';
  t: (key: string) => string;
}) {
  const { fp } = usePrice();
  const hour = new Date().getHours();
  const greetKey =
    hour < 12 ? 'dashboard.greetingMorning' : hour < 18 ? 'dashboard.greetingAfternoon' : 'dashboard.greetingEvening';

  const dateStr = new Date().toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // Market breadth from the loaded overview indices
  const valid = indices.filter((i) => i.regularMarketChangePercent != null && !isNaN(i.regularMarketChangePercent));
  const up = valid.filter((i) => i.regularMarketChangePercent > 0).length;
  const down = valid.filter((i) => i.regularMarketChangePercent < 0).length;
  const avg = valid.length ? valid.reduce((s, i) => s + i.regularMarketChangePercent, 0) / valid.length : 0;

  const sentiment = avg > 0.1 ? 'bullish' : avg < -0.1 ? 'bearish' : 'mixed';
  const SentimentIcon = sentiment === 'bullish' ? TrendingUp : sentiment === 'bearish' ? TrendingDown : Activity;
  const sentimentLabel =
    sentiment === 'bullish'
      ? t('dashboard.sentimentBullish')
      : sentiment === 'bearish'
        ? t('dashboard.sentimentBearish')
        : t('dashboard.sentimentMixed');
  const tone =
    sentiment === 'bullish'
      ? { text: 'text-success', bg: 'bg-success/10', ring: 'ring-success/20' }
      : sentiment === 'bearish'
        ? { text: 'text-danger', bg: 'bg-danger/10', ring: 'ring-danger/20' }
        : { text: 'text-accent', bg: 'bg-accent/10', ring: 'ring-accent/20' };

  return (
    <div className="card-glow p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 animate-slide-up">
      {/* Greeting */}
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="hidden sm:flex p-2.5 rounded-2xl bg-accent/10 shrink-0">
          <LayoutDashboard className="w-6 h-6 text-accent" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gradient-warm leading-tight">
            {t(greetKey)}
          </h1>
          <p className="text-xs sm:text-sm text-txt-secondary capitalize truncate">{dateStr}</p>
        </div>
      </div>

      {/* Right side: portfolio snapshot + market pulse + config */}
      <div className="flex items-center gap-2.5 sm:ml-auto flex-wrap">
        {snapshot && (
          <button
            onClick={() => navigate('/portfolio')}
            className="flex items-center gap-3 px-3.5 py-2 rounded-xl bg-dark-700/40 ring-1 ring-border/10 hover:ring-accent/30 transition-all duration-200 active:scale-[0.98]"
            title={t('nav.portfolio')}
          >
            <div className="p-1.5 rounded-lg bg-accent/10 shrink-0">
              <Wallet className="w-4 h-4 text-accent" />
            </div>
            <div className="flex flex-col leading-none gap-0.5 text-left">
              <span className="text-sm font-bold font-mono text-txt-primary">
                {fp(snapshot.totalValue, snapshot.currency)}
              </span>
              <span
                className={`text-[11px] font-mono font-semibold ${
                  snapshot.dayChange >= 0 ? 'text-success' : 'text-danger'
                }`}
              >
                {snapshot.dayChange >= 0 ? '+' : ''}
                {fp(snapshot.dayChange, snapshot.currency)} ({formatPercent(snapshot.dayChangePercent)})
              </span>
            </div>
          </button>
        )}

        {valid.length > 0 && (
          <div className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl ${tone.bg} ring-1 ${tone.ring}`}>
            <SentimentIcon className={`w-4 h-4 ${tone.text}`} />
            <div className="flex flex-col leading-none gap-0.5">
              <span className={`text-xs font-semibold ${tone.text}`}>{sentimentLabel}</span>
              <span className="text-[11px] text-txt-secondary font-mono">
                <span className="text-success">▲ {up}</span>
                <span className="mx-1 text-txt-muted">·</span>
                <span className="text-danger">▼ {down}</span>
                <span className="mx-1.5 text-txt-muted">|</span>
                <span className={tone.text}>{formatPercent(avg)}</span>
              </span>
            </div>
            <span className="live-dot ml-0.5" title="Live" />
          </div>
        )}

        <button
          onClick={onToggleConfig}
          className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 ${
            configOpen
              ? 'bg-accent/15 text-accent shadow-glow-sm'
              : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40'
          }`}
          title={t('dashboard.configure')}
        >
          <Settings className={`w-4 h-4 transition-transform duration-300 ${configOpen ? 'rotate-90' : ''}`} />
          <span className="hidden sm:inline">{t('dashboard.configure')}</span>
        </button>
      </div>
    </div>
  );
}

// ─── Main Dashboard ───

export default function Dashboard() {
  const navigate = useNavigate();
  const { watchlist, locale, t, convertPrice } = useApp();
  const { widgets, toggleWidget, reorderWidgets, resetLayout } = useDashboardLayout();
  const { holdings, totalInvested } = usePortfolio();
  const [configOpen, setConfigOpen] = useState(false);
  const [holdingQuotes, setHoldingQuotes] = useState<Record<string, { price: number; change: number; currency: string }>>({});

  const [indices, setIndices] = useState<QuoteData[]>([]);
  const [watchlistQuotes, setWatchlistQuotes] = useState<QuoteData[]>([]);
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const [majorIndicesQuotes, setMajorIndicesQuotes] = useState<QuoteData[]>([]);
  const [sectorQuotes, setSectorQuotes] = useState<QuoteData[]>([]);
  const [screenerStocks, setScreenerStocks] = useState<ScreenerStock[]>([]);
  const [loading, setLoading] = useState(true);

  const needsMajorIndices = widgets.some((w) => w.type === 'marketIndices' && w.visible);
  const needsSectors = widgets.some((w) => w.type === 'sectorPerformance' && w.visible);
  const needsGainersLosers = widgets.some(
    (w) => (w.type === 'topGainers' || w.type === 'topLosers') && w.visible
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const extraSymbols: string[] = [];
        if (needsMajorIndices) {
          for (const sym of MAJOR_INDICES) {
            if (!MARKET_OVERVIEW_INDICES.includes(sym) && !extraSymbols.includes(sym)) {
              extraSymbols.push(sym);
            }
          }
        }
        if (needsSectors) {
          for (const sym of SECTOR_ETFS) {
            if (!extraSymbols.includes(sym)) {
              extraSymbols.push(sym);
            }
          }
        }

        const [idxData, wlData, sparks, ...extraResults] = await Promise.all([
          fetchQuotes(MARKET_OVERVIEW_INDICES),
          fetchQuotes(watchlist.map((w) => w.symbol)),
          fetchSparklines([...MARKET_OVERVIEW_INDICES, ...watchlist.map((w) => w.symbol)]),
          ...(extraSymbols.length > 0 ? [fetchQuotes(extraSymbols)] : []),
          ...(needsGainersLosers ? [fetchScreener()] : []),
        ]);

        if (!cancelled) {
          setIndices(idxData);
          setWatchlistQuotes(wlData);
          setSparklines(sparks);

          let resultIdx = 0;
          const extraQuotes: QuoteData[] = extraSymbols.length > 0 ? (extraResults[resultIdx++] as QuoteData[] || []) : [];
          const screenerData: ScreenerStock[] = needsGainersLosers ? (extraResults[resultIdx] as ScreenerStock[] || []) : [];

          if (needsMajorIndices) {
            const allQuotes = [...idxData, ...extraQuotes];
            setMajorIndicesQuotes(allQuotes.filter((q) => MAJOR_INDICES.includes(q.symbol)));
          }

          if (needsSectors) {
            setSectorQuotes(extraQuotes.filter((q) => SECTOR_ETFS.includes(q.symbol)));
          }

          if (needsGainersLosers) {
            setScreenerStocks(screenerData);
          }
        }
      } catch {
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [watchlist, needsMajorIndices, needsSectors, needsGainersLosers]);

  // ─── Portfolio snapshot (hero) ───

  const holdingSymbols = useMemo(() => holdings.map((h) => h.symbol), [holdings]);

  useEffect(() => {
    if (holdingSymbols.length === 0) {
      setHoldingQuotes({});
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchQuotes(holdingSymbols);
        if (!cancelled) {
          const map: Record<string, { price: number; change: number; currency: string }> = {};
          for (const q of data) {
            if (q?.symbol) map[q.symbol] = { price: q.regularMarketPrice, change: q.regularMarketChange ?? 0, currency: q.currency || 'USD' };
          }
          setHoldingQuotes(map);
        }
      } catch {
        /* keep stale data */
      }
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [holdingSymbols]);

  const portfolioSnapshot = useMemo<PortfolioSnapshot | null>(() => {
    if (holdings.length === 0) return null;
    let totalValue = 0;
    let investedValue = 0;
    let dayChange = 0;
    let ccy: string | null = null;
    let mixed = false;
    for (const h of holdings) {
      const q = holdingQuotes[h.symbol];
      const cur = q?.currency || 'USD';
      const price = q?.price ?? h.avgPrice;
      const mv = convertPrice(h.shares * price, cur);
      totalValue += mv.value;
      investedValue += convertPrice(h.shares * h.avgPrice, cur).value;
      dayChange += convertPrice(h.shares * (q?.change ?? 0), cur).value;
      if (ccy === null) ccy = mv.currency;
      else if (ccy !== mv.currency) mixed = true;
    }
    const totalPnl = totalValue - investedValue;
    const totalPnlPercent = investedValue > 0 ? (totalPnl / investedValue) * 100 : 0;
    const prevValue = totalValue - dayChange;
    const dayChangePercent = prevValue !== 0 ? (dayChange / prevValue) * 100 : 0;
    return { totalValue, dayChange, dayChangePercent, totalPnl, totalPnlPercent, currency: mixed ? 'USD' : (ccy ?? 'USD') };
  }, [holdings, holdingQuotes, convertPrice]);

  // ─── Render widget by type ───

  const renderWidget = useCallback(
    (widget: DashboardWidget) => {
      if (!widget.visible) return null;

      switch (widget.type) {
        case 'marketOverview':
          return <MarketOverviewSection key={widget.id} indices={indices} sparklines={sparklines} navigate={navigate} locale={locale} t={t} />;

        case 'topGainers':
          return <TopGainersSection key={widget.id} stocks={screenerStocks} navigate={navigate} locale={locale} t={t} />;

        case 'topLosers':
          return <TopLosersSection key={widget.id} stocks={screenerStocks} navigate={navigate} locale={locale} t={t} />;

        case 'watchlistTable':
          return (
            <WatchlistTableSection key={widget.id} watchlistQuotes={watchlistQuotes} sparklines={sparklines} navigate={navigate} locale={locale} t={t} />
          );

        case 'marketIndices':
          return <MarketIndicesWidget key={widget.id} quotes={majorIndicesQuotes} navigate={navigate} locale={locale} />;

        case 'sectorPerformance':
          return <SectorPerformanceWidget key={widget.id} quotes={sectorQuotes} />;

        default:
          return null;
      }
    },
    [indices, sparklines, watchlistQuotes, screenerStocks, majorIndicesQuotes, sectorQuotes, navigate, locale, t]
  );

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-20 rounded-2xl skeleton-shimmer" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="card overflow-hidden">
          <table className="w-full">
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonTableRow key={i} cols={5} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Hero header */}
      <DashboardHero
        indices={indices}
        snapshot={portfolioSnapshot}
        configOpen={configOpen}
        onToggleConfig={() => setConfigOpen((prev) => !prev)}
        navigate={navigate}
        locale={locale}
        t={t}
      />

      {/* Config Panel */}
      {configOpen && (
        <ConfigPanel
          widgets={widgets}
          onToggle={toggleWidget}
          onReorder={reorderWidgets}
          onReset={resetLayout}
          onClose={() => setConfigOpen(false)}
        />
      )}

      {/* Widgets in configured order */}
      {widgets.map((widget) => renderWidget(widget))}
    </div>
  );
}

// ─── Market Overview Section ───

function MarketOverviewSection({
  indices,
  sparklines,
  navigate,
  locale,
  t,
}: {
  indices: QuoteData[];
  sparklines: Record<string, number[]>;
  navigate: (path: string) => void;
  locale: 'de' | 'en';
  t: (key: string) => string;
}) {
  const { fp } = usePrice();
  return (
    <div className="animate-slide-up">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-1.5 rounded-lg bg-accent/10">
          <Activity className="w-5 h-5 text-accent" />
        </div>
        <h2 className="section-title">{t('dashboard.marketOverview')}</h2>
        <div className="ml-2 live-dot" title="Live" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 stagger-children">
        {indices.map((idx) => {
          const isPositive = idx.regularMarketChange >= 0;
          const sparkData = sparklines[idx.symbol] || [];
          return (
            <div
              key={idx.symbol}
              className="card relative overflow-hidden p-4 pb-9 cursor-pointer group"
              onClick={() => navigate(`/stock/${idx.symbol}`)}
            >
              <BackdropSparkline data={sparkData} positive={isPositive} />
              <div className="relative z-10">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase tracking-wider text-txt-secondary font-semibold truncate">
                    {INDEX_NAMES[idx.symbol] || idx.shortName || idx.symbol}
                  </div>
                  <div className={`flex items-center justify-center w-6 h-6 rounded-lg shrink-0 transition-colors duration-200 ${isPositive ? 'bg-success/10 group-hover:bg-success/20' : 'bg-danger/10 group-hover:bg-danger/20'}`}>
                    {isPositive ? (
                      <ArrowUpRight className="w-3.5 h-3.5 text-success" />
                    ) : (
                      <ArrowDownRight className="w-3.5 h-3.5 text-danger" />
                    )}
                  </div>
                </div>
                <div className="text-xl font-bold font-mono text-txt-primary mt-2 tracking-tight tabular-nums">
                  {fp(idx.regularMarketPrice, idx.currency)}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded-md ${isPositive ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                    {formatPercent(idx.regularMarketChangePercent)}
                  </span>
                  <span className={`text-[11px] font-mono ${isPositive ? 'text-success/75' : 'text-danger/75'}`}>
                    {formatChange(idx.regularMarketChange)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Top Gainers Section ───

function TopGainersSection({
  stocks,
  navigate,
  locale,
  t,
}: {
  stocks: ScreenerStock[];
  navigate: (path: string) => void;
  locale: 'de' | 'en';
  t: (key: string) => string;
}) {
  const { fp } = usePrice();
  const [page, setPage] = useState(0);
  const hoveredRef = useRef(false);

  const allGainers = [...stocks]
    .filter((s) => s.changePercent > 0)
    .sort((a, b) => b.changePercent - a.changePercent);

  const pageSize = 3;
  const totalPages = Math.max(1, Math.ceil(allGainers.length / pageSize));

  useEffect(() => {
    if (allGainers.length <= pageSize) return;
    const iv = setInterval(() => {
      if (!hoveredRef.current) {
        setPage((p) => (p + 1) % totalPages);
      }
    }, 8000);
    return () => clearInterval(iv);
  }, [totalPages, allGainers.length]);

  useEffect(() => {
    if (page >= totalPages) setPage(0);
  }, [totalPages, page]);

  if (allGainers.length === 0) return null;

  const visibleGainers = allGainers.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <div className="animate-slide-up">
      <div
        className="flex items-center gap-2.5 mb-3 cursor-pointer group select-none"
        onClick={() => navigate('/screener?preset=gainers')}
      >
        <div className="p-1.5 rounded-lg bg-success/10">
          <TrendingUp className="w-4 h-4 text-success" />
        </div>
        <h3 className="text-base font-bold text-txt-primary group-hover:text-accent transition-colors">
          {t('dashboard.topGainers')}
        </h3>
        <span className="text-xs text-txt-muted bg-dark-700/40 px-2 py-0.5 rounded-full font-mono">({allGainers.length})</span>
        <ArrowUpRight className="w-4 h-4 text-txt-secondary group-hover:text-accent ml-auto transition-colors" />
      </div>
      <div
        className="card overflow-hidden"
        onMouseEnter={() => { hoveredRef.current = true; }}
        onMouseLeave={() => { hoveredRef.current = false; }}
      >
        <div key={`page-${page}`} className="animate-slide-swap">
          {visibleGainers.map((s, i) => (
            <div
              key={s.symbol}
              className="flex items-center justify-between px-5 py-3 border-b border-border/5 last:border-0 hover:bg-dark-600/20 cursor-pointer transition-all duration-200"
              onClick={() => navigate(`/stock/${s.symbol}`)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-success/10 text-success text-[11px] font-mono font-bold shrink-0">
                  {page * pageSize + i + 1}
                </span>
                <div className="min-w-0">
                  <span className="font-mono font-bold text-sm text-accent">{s.symbol}</span>
                  <div className="text-[11px] text-txt-secondary truncate max-w-[140px]">{s.shortName}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-mono text-txt-primary font-medium">
                  {fp(s.price, s.currency)}
                </div>
                <div className="badge-success text-[11px]">{formatPercent(s.changePercent)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Top Losers Section ───

function TopLosersSection({
  stocks,
  navigate,
  locale,
  t,
}: {
  stocks: ScreenerStock[];
  navigate: (path: string) => void;
  locale: 'de' | 'en';
  t: (key: string) => string;
}) {
  const { fp } = usePrice();
  const [page, setPage] = useState(0);
  const hoveredRef = useRef(false);

  const allLosers = [...stocks]
    .filter((s) => s.changePercent < 0)
    .sort((a, b) => a.changePercent - b.changePercent);

  const pageSize = 3;
  const totalPages = Math.max(1, Math.ceil(allLosers.length / pageSize));

  useEffect(() => {
    if (allLosers.length <= pageSize) return;
    const iv = setInterval(() => {
      if (!hoveredRef.current) {
        setPage((p) => (p + 1) % totalPages);
      }
    }, 8000);
    return () => clearInterval(iv);
  }, [totalPages, allLosers.length]);

  useEffect(() => {
    if (page >= totalPages) setPage(0);
  }, [totalPages, page]);

  if (allLosers.length === 0) return null;

  const visibleLosers = allLosers.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <div className="animate-slide-up">
      <div
        className="flex items-center gap-2.5 mb-3 cursor-pointer group select-none"
        onClick={() => navigate('/screener?preset=losers')}
      >
        <div className="p-1.5 rounded-lg bg-danger/10">
          <TrendingDown className="w-4 h-4 text-danger" />
        </div>
        <h3 className="text-base font-bold text-txt-primary group-hover:text-accent transition-colors">
          {t('dashboard.topLosers')}
        </h3>
        <span className="text-xs text-txt-muted bg-dark-700/40 px-2 py-0.5 rounded-full font-mono">({allLosers.length})</span>
        <ArrowUpRight className="w-4 h-4 text-txt-secondary group-hover:text-accent ml-auto transition-colors" />
      </div>
      <div
        className="card overflow-hidden"
        onMouseEnter={() => { hoveredRef.current = true; }}
        onMouseLeave={() => { hoveredRef.current = false; }}
      >
        <div key={`page-${page}`} className="animate-slide-swap">
          {visibleLosers.map((s, i) => (
            <div
              key={s.symbol}
              className="flex items-center justify-between px-5 py-3 border-b border-border/5 last:border-0 hover:bg-dark-600/20 cursor-pointer transition-all duration-200"
              onClick={() => navigate(`/stock/${s.symbol}`)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-danger/10 text-danger text-[11px] font-mono font-bold shrink-0">
                  {page * pageSize + i + 1}
                </span>
                <div className="min-w-0">
                  <span className="font-mono font-bold text-sm text-accent">{s.symbol}</span>
                  <div className="text-[11px] text-txt-secondary truncate max-w-[140px]">{s.shortName}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-mono text-txt-primary font-medium">
                  {fp(s.price, s.currency)}
                </div>
                <div className="badge-danger text-[11px]">{formatPercent(s.changePercent)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Watchlist Table Section ───

function WatchlistTableSection({
  watchlistQuotes,
  sparklines,
  navigate,
  locale,
  t,
}: {
  watchlistQuotes: QuoteData[];
  sparklines: Record<string, number[]>;
  navigate: (path: string) => void;
  locale: 'de' | 'en';
  t: (key: string) => string;
}) {
  const { fp } = usePrice();
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();
  return (
    <div className="animate-slide-up">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-1.5 rounded-lg bg-accent/10">
          <BarChart3 className="w-5 h-5 text-accent" />
        </div>
        <h2 className="section-title">{t('dashboard.yourWatchlist')}</h2>
      </div>

      {watchlistQuotes.length === 0 ? (
        <div className="card p-10 text-center text-txt-secondary">
          <BarChart3 className="w-10 h-10 text-txt-muted/20 mx-auto mb-3" />
          <p className="font-medium">{t('dashboard.noWatchlist')}</p>
          <p className="text-sm text-txt-muted mt-1">{t('dashboard.searchHint')}</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/10">
                <th className="text-left px-5 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">{t('dashboard.symbol')}</th>
                <th className="text-left px-5 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">{t('dashboard.name')}</th>
                <th className="text-center px-5 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider hidden md:table-cell">
                  {t('dashboard.chart5d')}
                </th>
                <th className="text-right px-5 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">{t('dashboard.price')}</th>
                <th className="text-right px-5 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">{t('dashboard.change')}</th>
                <th className="text-right px-5 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider hidden md:table-cell">
                  {t('dashboard.volume')}
                </th>
                <th className="text-right px-5 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider hidden lg:table-cell">
                  {t('dashboard.marketCap')}
                </th>
              </tr>
            </thead>
            <tbody>
              {watchlistQuotes.map((q) => {
                const isPositive = q.regularMarketChange >= 0;
                const sparkData = sparklines[q.symbol] || [];
                return (
                  <tr
                    key={q.symbol}
                    className="border-b border-border/5 last:border-0 hover:bg-accent/[0.04] cursor-pointer transition-all duration-200 group"
                    onClick={() => navigate(`/stock/${q.symbol}`)}
                    onContextMenu={(e) => openContextMenu(e, q.symbol, q.shortName || q.longName)}
                  >
                    <td className="px-5 py-3.5">
                      <span className="font-mono font-bold text-sm text-accent group-hover:text-accent-light transition-colors">{q.symbol}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-txt-primary truncate max-w-[200px] inline-block">
                        {q.shortName || q.longName}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      <div className="flex justify-center">
                        <MiniSparkline data={sparkData} positive={isPositive} />
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-sm font-mono text-txt-primary font-medium">
                        {fp(q.regularMarketPrice, q.currency)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className={`text-sm font-mono font-semibold ${isPositive ? 'badge-success' : 'badge-danger'}`}>
                        {formatPercent(q.regularMarketChangePercent)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right hidden md:table-cell">
                      <span className="text-sm font-mono text-txt-secondary">
                        {q.regularMarketVolume ? (q.regularMarketVolume / 1e6).toFixed(1) + 'M' : '\u2014'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right hidden lg:table-cell">
                      <span className="text-sm font-mono text-txt-secondary">
                        {q.marketCap
                          ? q.marketCap >= 1e12
                            ? (q.marketCap / 1e12).toFixed(2) + 'T'
                            : (q.marketCap / 1e9).toFixed(1) + 'B'
                          : '\u2014'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {contextMenu && <StockContextMenu {...contextMenu} onClose={closeContextMenu} />}
    </div>
  );
}
