import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Flame,
  TrendingUp,
  TrendingDown,
  Activity,
  ArrowUpCircle,
  ArrowDownCircle,
  RefreshCw,
} from 'lucide-react';
import { fetchScreener, type ScreenerStock } from '../api';
import { useApp } from '../context';
import { usePrice } from '../hooks/usePrice';
import { formatPercent, formatVolume, formatLargeNumber } from '../formatters';
import LoadingSpinner from '../components/LoadingSpinner';

type ListKey = 'gainers' | 'losers' | 'active' | 'high52' | 'low52';

interface ListDef {
  key: ListKey;
  title: string;
  icon: typeof Flame;
  tone: 'pos' | 'neg' | 'neutral';
  /** extra metric column header + value */
  metric: string;
  value: (s: ScreenerStock) => string;
}

const TOP_N = 15;

export default function Hotlists() {
  const navigate = useNavigate();
  const { locale } = useApp();
  const { fp } = usePrice();
  const [data, setData] = useState<ScreenerStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState<ListKey>('gainers');
  const [refreshing, setRefreshing] = useState(false);

  const load = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      const rows = await fetchScreener();
      setData(rows.filter((r) => r.price != null && r.changePercent != null));
      setError('');
    } catch {
      setError(locale === 'de' ? 'Daten konnten nicht geladen werden.' : 'Failed to load data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const de = locale === 'de';

  const lists: ListDef[] = useMemo(
    () => [
      {
        key: 'gainers',
        title: de ? 'Top-Gewinner' : 'Top Gainers',
        icon: TrendingUp,
        tone: 'pos',
        metric: de ? 'Änderung' : 'Change',
        value: (s) => formatPercent(s.changePercent),
      },
      {
        key: 'losers',
        title: de ? 'Top-Verlierer' : 'Top Losers',
        icon: TrendingDown,
        tone: 'neg',
        metric: de ? 'Änderung' : 'Change',
        value: (s) => formatPercent(s.changePercent),
      },
      {
        key: 'active',
        title: de ? 'Meistgehandelt' : 'Most Active',
        icon: Activity,
        tone: 'neutral',
        metric: de ? 'Volumen' : 'Volume',
        value: (s) => formatVolume(s.volume),
      },
      {
        key: 'high52',
        title: de ? 'Nahe 52-W-Hoch' : 'Near 52W High',
        icon: ArrowUpCircle,
        tone: 'pos',
        metric: de ? 'vom Hoch' : 'from high',
        value: (s) => formatPercent(((s.price - s.fiftyTwoWeekHigh) / s.fiftyTwoWeekHigh) * 100),
      },
      {
        key: 'low52',
        title: de ? 'Nahe 52-W-Tief' : 'Near 52W Low',
        icon: ArrowDownCircle,
        tone: 'neg',
        metric: de ? 'vom Tief' : 'from low',
        value: (s) => '+' + formatPercent(((s.price - s.fiftyTwoWeekLow) / s.fiftyTwoWeekLow) * 100).replace('+', ''),
      },
    ],
    [de]
  );

  const ranked = useMemo(() => {
    const valid = data.filter((s) => isFinite(s.price) && s.price > 0);
    switch (active) {
      case 'gainers':
        return [...valid].sort((a, b) => b.changePercent - a.changePercent).slice(0, TOP_N);
      case 'losers':
        return [...valid].sort((a, b) => a.changePercent - b.changePercent).slice(0, TOP_N);
      case 'active':
        return [...valid].sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, TOP_N);
      case 'high52':
        return [...valid]
          .filter((s) => s.fiftyTwoWeekHigh > 0)
          .sort((a, b) => (a.fiftyTwoWeekHigh - a.price) / a.fiftyTwoWeekHigh - (b.fiftyTwoWeekHigh - b.price) / b.fiftyTwoWeekHigh)
          .slice(0, TOP_N);
      case 'low52':
        return [...valid]
          .filter((s) => s.fiftyTwoWeekLow > 0)
          .sort((a, b) => (a.price - a.fiftyTwoWeekLow) / a.fiftyTwoWeekLow - (b.price - b.fiftyTwoWeekLow) / b.fiftyTwoWeekLow)
          .slice(0, TOP_N);
    }
  }, [data, active]);

  const activeDef = lists.find((l) => l.key === active)!;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner text={de ? 'Lade Hotlists...' : 'Loading hotlists...'} />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="p-1.5 rounded-lg bg-accent/10">
          <Flame className="w-5 h-5 text-accent" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-txt-primary">Hotlists</h1>
          <p className="text-xs text-txt-muted">
            {de ? 'Marktbewegungen aus dem Screener-Universum' : 'Market movers from the screener universe'}
          </p>
        </div>
        <button
          onClick={() => load(true)}
          className="p-2 rounded-lg text-txt-secondary hover:text-txt-primary bg-dark-700/60 ring-1 ring-border/10 transition-all duration-200"
          title={de ? 'Aktualisieren' : 'Refresh'}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <div className="text-sm text-danger">{error}</div>}

      {/* List selector */}
      <div className="flex flex-wrap gap-0.5 bg-dark-700/60 ring-1 ring-border/10 rounded-xl p-1 w-fit">
        {lists.map((l) => {
          const Icon = l.icon;
          return (
            <button
              key={l.key}
              onClick={() => setActive(l.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                active === l.key
                  ? 'bg-accent text-white shadow-glow-sm'
                  : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {l.title}
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-txt-muted border-b border-border/20">
              <th className="text-left font-semibold px-4 py-2.5 w-8">#</th>
              <th className="text-left font-semibold px-4 py-2.5">{de ? 'Symbol' : 'Symbol'}</th>
              <th className="text-right font-semibold px-4 py-2.5">{de ? 'Kurs' : 'Price'}</th>
              <th className="text-right font-semibold px-4 py-2.5">{activeDef.metric}</th>
              <th className="text-right font-semibold px-4 py-2.5 hidden sm:table-cell">{de ? 'Tag' : 'Day'}</th>
              <th className="text-right font-semibold px-4 py-2.5 hidden md:table-cell">{de ? 'MarktKap.' : 'Mkt Cap'}</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((s, i) => {
              const pos = s.changePercent >= 0;
              return (
                <tr
                  key={s.symbol}
                  onClick={() => navigate(`/stock/${s.symbol}`)}
                  className="border-b border-border/5 hover:bg-dark-700/40 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2.5 text-txt-muted font-mono tabular-nums">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-mono font-semibold text-txt-primary">{s.symbol}</div>
                    <div className="text-[11px] text-txt-secondary truncate max-w-[200px]">{s.shortName}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-txt-primary tabular-nums">
                    {fp(s.price, s.currency)}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono font-semibold tabular-nums ${
                    activeDef.tone === 'pos' ? 'text-success' : activeDef.tone === 'neg' ? 'text-danger' : 'text-txt-primary'
                  }`}>
                    {activeDef.value(s)}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono font-semibold tabular-nums hidden sm:table-cell ${
                    pos ? 'text-success' : 'text-danger'
                  }`}>
                    {formatPercent(s.changePercent)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-txt-secondary tabular-nums hidden md:table-cell">
                    {formatLargeNumber(s.marketCap)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {ranked.length === 0 && (
          <div className="p-8 text-center text-sm text-txt-muted">
            {de ? 'Keine Daten verfügbar.' : 'No data available.'}
          </div>
        )}
      </div>
    </div>
  );
}
