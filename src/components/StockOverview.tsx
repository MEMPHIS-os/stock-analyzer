import {
  TrendingUp,
  TrendingDown,
  Star,
  StarOff,
  GitCompareArrows,
  ArrowUp,
  ArrowDown,
  BarChart3,
  Clock,
  Building2,
  Activity,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { formatChange, formatPercent, formatLargeNumber, formatVolume } from '../formatters';
import { useApp } from '../context';
import { useContextMenu } from '../hooks/useContextMenu';
import StockContextMenu from './ContextMenu';
import { Price } from './Price';
import { useNavigate } from 'react-router-dom';
import type { QuoteData } from '../types';

interface StockOverviewProps {
  quote: QuoteData;
}

export default function StockOverview({ quote }: StockOverviewProps) {
  const { isInWatchlist, addToWatchlist, removeFromWatchlist, addCompareSymbol, showToast, t } =
    useApp();
  const navigate = useNavigate();
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();
  const inWatchlist = isInWatchlist(quote.symbol);
  const isPositive = quote.regularMarketChange >= 0;
  const cur = quote.currency || 'USD';

  const sf = (v: number | undefined | null): ReactNode => (
    <Price value={v} currency={cur} size={13} />
  );
  const stats: { label: string; value: ReactNode; icon: typeof TrendingUp }[] = [
    { label: 'Eröffnung', value: sf(quote.regularMarketOpen), icon: Activity },
    { label: 'Tageshoch', value: sf(quote.regularMarketDayHigh), icon: ArrowUp },
    { label: 'Tagestief', value: sf(quote.regularMarketDayLow), icon: ArrowDown },
    { label: 'Volumen', value: formatVolume(quote.regularMarketVolume), icon: BarChart3 },
    { label: 'Vortag', value: sf(quote.regularMarketPreviousClose), icon: Clock },
    { label: '52W Hoch', value: sf(quote.fiftyTwoWeekHigh), icon: TrendingUp },
    { label: '52W Tief', value: sf(quote.fiftyTwoWeekLow), icon: TrendingDown },
    { label: 'Marktkapit.', value: formatLargeNumber(quote.marketCap), icon: Building2 },
  ];

  return (
    <div className="card-glow p-5 sm:p-6 animate-fade-in" onContextMenu={(e) => openContextMenu(e, quote.symbol, quote.shortName || quote.longName)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-txt-primary">{quote.symbol}</h1>
            {quote.exchange && (
              <span className="text-[10px] uppercase tracking-wider font-semibold bg-dark-600/60 text-txt-secondary px-2 py-0.5 rounded-md">
                {quote.exchange}
              </span>
            )}
          </div>
          <p className="text-sm text-txt-secondary truncate mb-3.5">
            {quote.shortName || quote.longName}
          </p>
          <div className="flex items-baseline gap-3 flex-wrap">
            <Price
              value={quote.regularMarketPrice}
              currency={cur}
              size={30}
              className="text-3xl sm:text-4xl font-bold font-mono text-txt-primary tabular-nums tracking-tight"
            />
            <div
              className={`flex items-center gap-2 px-2.5 py-1 rounded-xl ${
                isPositive ? 'bg-success/10 ring-1 ring-success/15' : 'bg-danger/10 ring-1 ring-danger/15'
              }`}
            >
              {isPositive ? (
                <TrendingUp className="w-4 h-4 text-success" />
              ) : (
                <TrendingDown className="w-4 h-4 text-danger" />
              )}
              <span className={`text-sm font-mono font-semibold tabular-nums ${isPositive ? 'text-success' : 'text-danger'}`}>
                {formatChange(quote.regularMarketChange)}
              </span>
              <span className={`text-sm font-mono font-bold tabular-nums ${isPositive ? 'text-success' : 'text-danger'}`}>
                {formatPercent(quote.regularMarketChangePercent)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => {
              if (inWatchlist) {
                removeFromWatchlist(quote.symbol);
                showToast(`${quote.symbol} ${t('toast.removedFromWatchlist')}`, 'info');
              } else {
                addToWatchlist(quote.symbol, quote.shortName || quote.longName || quote.symbol);
                showToast(`${quote.symbol} ${t('toast.addedToWatchlist')}`, 'success');
              }
            }}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 active:scale-[0.97] ${
              inWatchlist
                ? 'bg-warning/10 text-warning ring-1 ring-warning/20'
                : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40'
            }`}
            title={inWatchlist ? 'Von Watchlist entfernen' : 'Zur Watchlist hinzufügen'}
          >
            {inWatchlist ? <StarOff className="w-4 h-4" /> : <Star className="w-4 h-4" />}
            <span className="hidden sm:inline">
              {inWatchlist ? 'Entfernen' : 'Watchlist'}
            </span>
          </button>
          <button
            onClick={() => {
              addCompareSymbol(quote.symbol);
              navigate('/compare');
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40 transition-all duration-200 active:scale-[0.97]"
            title="Zum Vergleich hinzufügen"
          >
            <GitCompareArrows className="w-4 h-4" />
            <span className="hidden sm:inline">Vergleich</span>
          </button>
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5 pt-5 border-t border-border/10 stagger-children">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-dark-700/40 rounded-xl px-3 py-2 flex items-center gap-2.5 ring-1 ring-border/5 hover:bg-dark-700/60 transition-colors duration-200"
            >
              <div className="p-1.5 rounded-lg bg-accent/[0.07] shrink-0">
                <Icon className="w-3.5 h-3.5 text-accent/70" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-txt-muted font-semibold truncate">{stat.label}</div>
                <div className="text-sm font-semibold text-txt-primary font-mono tabular-nums truncate">{stat.value}</div>
              </div>
            </div>
          );
        })}
      </div>
      {contextMenu && <StockContextMenu {...contextMenu} onClose={closeContextMenu} />}
    </div>
  );
}
