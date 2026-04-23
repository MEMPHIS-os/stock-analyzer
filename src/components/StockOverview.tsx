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
import { formatChange, formatPercent, formatLargeNumber, formatVolume } from '../formatters';
import { useApp } from '../context';
import { usePrice } from '../hooks/usePrice';
import { useContextMenu } from '../hooks/useContextMenu';
import StockContextMenu from './ContextMenu';
import { useNavigate } from 'react-router-dom';
import type { QuoteData } from '../types';

interface StockOverviewProps {
  quote: QuoteData;
}

export default function StockOverview({ quote }: StockOverviewProps) {
  const { isInWatchlist, addToWatchlist, removeFromWatchlist, addCompareSymbol, showToast, t } =
    useApp();
  const { fp } = usePrice();
  const navigate = useNavigate();
  const { contextMenu, openContextMenu, closeContextMenu } = useContextMenu();
  const inWatchlist = isInWatchlist(quote.symbol);
  const isPositive = quote.regularMarketChange >= 0;
  const cur = quote.currency || 'USD';

  const stats: { label: string; value: string; icon: typeof TrendingUp }[] = [
    { label: 'Eröffnung', value: fp(quote.regularMarketOpen, cur), icon: Activity },
    { label: 'Tageshoch', value: fp(quote.regularMarketDayHigh, cur), icon: ArrowUp },
    { label: 'Tagestief', value: fp(quote.regularMarketDayLow, cur), icon: ArrowDown },
    { label: 'Volumen', value: formatVolume(quote.regularMarketVolume), icon: BarChart3 },
    { label: 'Vortag', value: fp(quote.regularMarketPreviousClose, cur), icon: Clock },
    { label: '52W Hoch', value: fp(quote.fiftyTwoWeekHigh, cur), icon: TrendingUp },
    { label: '52W Tief', value: fp(quote.fiftyTwoWeekLow, cur), icon: TrendingDown },
    { label: 'Marktkapit.', value: formatLargeNumber(quote.marketCap), icon: Building2 },
  ];

  return (
    <div className="animate-fade-in" onContextMenu={(e) => openContextMenu(e, quote.symbol, quote.shortName || quote.longName)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-txt-primary">{quote.symbol}</h1>
            <span className="text-sm text-txt-secondary">
              {quote.shortName || quote.longName}
            </span>
            {quote.exchange && (
              <span className="text-xs bg-dark-600 text-txt-muted px-2 py-0.5 rounded">
                {quote.exchange}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold font-mono text-txt-primary">
              {fp(quote.regularMarketPrice, cur)}
            </span>
            <div className="flex items-center gap-2">
              {isPositive ? (
                <TrendingUp className="w-5 h-5 text-success" />
              ) : (
                <TrendingDown className="w-5 h-5 text-danger" />
              )}
              <span
                className={`text-lg font-mono font-semibold ${
                  isPositive ? 'text-success' : 'text-danger'
                }`}
              >
                {formatChange(quote.regularMarketChange)}
              </span>
              <span
                className={`text-lg font-mono ${
                  isPositive ? 'badge-success' : 'badge-danger'
                }`}
              >
                {formatPercent(quote.regularMarketChangePercent)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
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
            className={`btn-ghost flex items-center gap-1.5 ${
              inWatchlist ? 'text-warning' : ''
            }`}
            title={inWatchlist ? 'Von Watchlist entfernen' : 'Zur Watchlist hinzufügen'}
          >
            {inWatchlist ? <StarOff className="w-4 h-4" /> : <Star className="w-4 h-4" />}
            <span className="text-sm hidden sm:inline">
              {inWatchlist ? 'Entfernen' : 'Watchlist'}
            </span>
          </button>
          <button
            onClick={() => {
              addCompareSymbol(quote.symbol);
              navigate('/compare');
            }}
            className="btn-ghost flex items-center gap-1.5"
            title="Zum Vergleich hinzufügen"
          >
            <GitCompareArrows className="w-4 h-4" />
            <span className="text-sm hidden sm:inline">Vergleich</span>
          </button>
        </div>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-dark-700/50 rounded-lg px-2.5 py-1.5 flex items-center gap-2">
              <Icon className="w-3.5 h-3.5 text-txt-muted shrink-0" />
              <div className="min-w-0">
                <div className="stat-label truncate">{stat.label}</div>
                <div className="stat-value">{stat.value}</div>
              </div>
            </div>
          );
        })}
      </div>
      {contextMenu && <StockContextMenu {...contextMenu} onClose={closeContextMenu} />}
    </div>
  );
}
