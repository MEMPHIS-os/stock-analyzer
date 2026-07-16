import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Newspaper, ExternalLink, Clock, RefreshCw } from 'lucide-react';
import { fetchNews } from '../api';
import { formatTimeAgo } from '../formatters';
import { useApp } from '../context';
import type { NewsItem } from '../types';

interface TaggedNews extends NewsItem {
  symbol: string;
}

function newsTime(item: NewsItem): number {
  if (!item.publishedAt) return 0;
  const t = new Date(item.publishedAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export default function News() {
  const { watchlist, t, locale } = useApp();
  const [items, setItems] = useState<TaggedNews[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const symbols = useMemo(() => watchlist.map((w) => w.symbol), [watchlist]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (symbols.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    Promise.all(
      symbols.map((sym) =>
        fetchNews(sym)
          .then((res) => res.map((n) => ({ ...n, symbol: sym })))
          .catch(() => [] as TaggedNews[])
      )
    ).then((results) => {
      if (cancelled) return;
      // Flatten, dedupe by link (fall back to title), keep newest, sort desc.
      const seen = new Map<string, TaggedNews>();
      for (const item of results.flat()) {
        const key = (item.link || item.title || '').toLowerCase();
        if (!key) continue;
        const existing = seen.get(key);
        if (!existing || newsTime(item) > newsTime(existing)) seen.set(key, item);
      }
      const merged = [...seen.values()].sort((a, b) => newsTime(b) - newsTime(a));
      setItems(merged);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [symbols, refreshKey]);

  const filtered = useMemo(
    () => (activeSymbol ? items.filter((i) => i.symbol === activeSymbol) : items),
    [items, activeSymbol]
  );

  // Count per symbol for the filter chips
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of items) c[i.symbol] = (c[i.symbol] || 0) + 1;
    return c;
  }, [items]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="p-2 rounded-xl bg-accent/10">
          <Newspaper className="w-5 h-5 text-accent" />
        </div>
        <h2 className="section-title text-xl">{t('nav.news')}</h2>
        <span className="text-xs text-txt-muted ml-1">
          {items.length} {t('news.headlinesFrom')} {symbols.length} {t('news.symbols')}
        </span>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          className="ml-auto p-2 rounded-lg text-txt-secondary hover:text-txt-primary hover:bg-dark-600 transition-colors"
          title={t('news.refresh')}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Symbol filter chips */}
      {symbols.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveSymbol(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeSymbol === null
                ? 'bg-accent text-white'
                : 'bg-dark-700 text-txt-secondary hover:text-txt-primary hover:bg-dark-600'
            }`}
          >
            {t('news.all')} ({items.length})
          </button>
          {symbols.map((sym) => (
            <button
              key={sym}
              onClick={() => setActiveSymbol(sym === activeSymbol ? null : sym)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                activeSymbol === sym
                  ? 'bg-accent text-white'
                  : 'bg-dark-700 text-txt-secondary hover:text-txt-primary hover:bg-dark-600'
              }`}
            >
              {sym} {counts[sym] ? `(${counts[sym]})` : ''}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg skeleton-shimmer" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-txt-secondary">
          <Newspaper className="w-8 h-8 mb-2 opacity-50" />
          <span className="text-sm">{t('news.empty')}</span>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((item, i) => (
            <a
              key={`${item.link}-${i}`}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 py-2.5 px-3 rounded-lg bg-dark-700/30 border border-border/20 hover:bg-dark-600/40 hover:border-accent/30 transition-all duration-200 group"
            >
              {item.thumbnail && (
                <img
                  src={item.thumbnail}
                  alt=""
                  className="w-16 h-12 object-cover rounded-lg shrink-0 bg-dark-600"
                  loading="lazy"
                />
              )}
              <div className="flex-1 min-w-0">
                <h4 className="text-[13px] font-medium text-txt-primary line-clamp-2 leading-snug group-hover:text-accent transition-colors">
                  {item.title}
                </h4>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <Link
                    to={`/stock/${item.symbol}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                  >
                    {item.symbol}
                  </Link>
                  {item.publisher && (
                    <span className="text-[11px] font-medium text-txt-secondary">{item.publisher}</span>
                  )}
                  {item.publishedAt && (
                    <>
                      <span className="text-txt-muted text-[10px]">·</span>
                      <span className="text-[11px] text-txt-muted flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTimeAgo(item.publishedAt, locale)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-txt-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
