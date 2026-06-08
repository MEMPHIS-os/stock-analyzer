import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, TrendingUp, Coins, RefreshCw } from 'lucide-react';
import { fetchCalendarEvents, type CalendarEvent } from '../api';
import { formatPercent } from '../formatters';
import { useApp } from '../context';

type EventType = 'earnings' | 'exDividend';

interface UpcomingItem {
  symbol: string;
  name: string;
  type: EventType;
  date: number; // unix seconds
  estimate: number | null;
  dividendRate: number | null;
  dividendYield: number | null;
}

function dayKey(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

export default function UpcomingEvents() {
  const { watchlist, locale, t } = useApp();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | EventType>('all');
  const [refreshKey, setRefreshKey] = useState(0);

  const symbols = useMemo(() => watchlist.map((w) => w.symbol), [watchlist]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (symbols.length === 0) {
      setEvents([]);
      setLoading(false);
      return;
    }
    fetchCalendarEvents(symbols)
      .then((res) => {
        if (!cancelled) setEvents(res);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbols, refreshKey]);

  // Flatten into individual upcoming items (from yesterday onward), sorted ascending.
  const items = useMemo<UpcomingItem[]>(() => {
    const cutoff = Math.floor(Date.now() / 1000) - 86400;
    const out: UpcomingItem[] = [];
    for (const ev of events) {
      if (ev.earningsDate && ev.earningsDate >= cutoff) {
        out.push({
          symbol: ev.symbol,
          name: ev.name,
          type: 'earnings',
          date: ev.earningsDate,
          estimate: ev.earningsEstimate,
          dividendRate: null,
          dividendYield: null,
        });
      }
      if (ev.exDividendDate && ev.exDividendDate >= cutoff) {
        out.push({
          symbol: ev.symbol,
          name: ev.name,
          type: 'exDividend',
          date: ev.exDividendDate,
          estimate: null,
          dividendRate: ev.dividendRate,
          dividendYield: ev.dividendYield,
        });
      }
    }
    return out.sort((a, b) => a.date - b.date);
  }, [events]);

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.type === filter)),
    [items, filter]
  );

  // Group by day for a calendar-style layout.
  const grouped = useMemo(() => {
    const map = new Map<string, UpcomingItem[]>();
    for (const item of filtered) {
      const key = dayKey(item.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [filtered]);

  const todayKey = new Date().toISOString().slice(0, 10);
  const fmtDay = (key: string) =>
    new Date(key + 'T00:00:00').toLocaleDateString(locale === 'de' ? 'de-DE' : 'en-US', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    });

  const earningsCount = items.filter((i) => i.type === 'earnings').length;
  const divCount = items.filter((i) => i.type === 'exDividend').length;

  const FILTERS: { key: 'all' | EventType; label: string; count: number }[] = [
    { key: 'all', label: t('upcoming.all'), count: items.length },
    { key: 'earnings', label: t('upcoming.earnings'), count: earningsCount },
    { key: 'exDividend', label: t('upcoming.dividends'), count: divCount },
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="p-2 rounded-xl bg-accent/10">
          <CalendarClock className="w-5 h-5 text-accent" />
        </div>
        <h2 className="section-title text-xl">{t('nav.upcoming')}</h2>
        <span className="text-xs text-txt-muted ml-1">{t('upcoming.subtitle')}</span>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="ml-auto p-2 rounded-lg text-txt-secondary hover:text-txt-primary hover:bg-dark-600 transition-colors"
          title={t('news.refresh')}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Type filter */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f.key
                ? 'bg-accent text-white'
                : 'bg-dark-700 text-txt-secondary hover:text-txt-primary hover:bg-dark-600'
            }`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg skeleton-shimmer" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-txt-secondary">
          <CalendarClock className="w-8 h-8 mb-2 opacity-50" />
          <span className="text-sm">{t('upcoming.empty')}</span>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([key, dayItems]) => (
            <div key={key}>
              <div className="flex items-center gap-2 mb-1.5">
                <h3 className="text-xs font-bold text-txt-secondary uppercase tracking-wider">
                  {fmtDay(key)}
                </h3>
                {key === todayKey && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent text-white">
                    {t('upcoming.today')}
                  </span>
                )}
              </div>
              <div className="space-y-1">
                {dayItems.map((item, i) => (
                  <Link
                    key={`${item.symbol}-${item.type}-${i}`}
                    to={`/stock/${item.symbol}`}
                    className="flex items-center gap-3 py-2.5 px-3 rounded-lg bg-dark-700/30 border border-border/20 hover:bg-dark-600/40 hover:border-accent/30 transition-all duration-200 group"
                  >
                    <div
                      className={`p-1.5 rounded-lg ${
                        item.type === 'earnings' ? 'bg-accent/10' : 'bg-success/10'
                      }`}
                    >
                      {item.type === 'earnings' ? (
                        <TrendingUp className="w-4 h-4 text-accent" />
                      ) : (
                        <Coins className="w-4 h-4 text-success" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-bold text-sm text-txt-primary group-hover:text-accent transition-colors">
                        {item.symbol}
                      </span>
                      <span className="text-xs text-txt-muted truncate hidden sm:inline">{item.name}</span>
                    </div>
                    <div className="ml-auto text-right">
                      {item.type === 'earnings' ? (
                        <span className="text-xs text-txt-secondary">
                          {t('upcoming.earningsReport')}
                          {item.estimate != null && (
                            <span className="ml-2 font-mono text-txt-primary">
                              {t('upcoming.est')} {item.estimate.toFixed(2)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-txt-secondary">
                          {t('upcoming.exDividend')}
                          {item.dividendRate != null && (
                            <span className="ml-2 font-mono text-success">
                              {item.dividendRate.toFixed(2)}
                              {item.dividendYield != null && ` · ${formatPercent(item.dividendYield * 100)}`}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-txt-muted">{t('upcoming.disclaimer')}</p>
    </div>
  );
}
