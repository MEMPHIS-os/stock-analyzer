import { useEffect, useState } from 'react';
import { Newspaper, ExternalLink, AlertCircle, Clock } from 'lucide-react';
import { fetchNews } from '../api';
import { formatTimeAgo } from '../formatters';
import LoadingSpinner from './LoadingSpinner';
import type { NewsItem } from '../types';

interface NewsFeedProps {
  symbol: string;
}

export default function NewsFeed({ symbol }: NewsFeedProps) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchNews(symbol)
      .then((result) => {
        if (!cancelled) setNews(result);
      })
      .catch(() => {
        if (!cancelled) setError('News konnten nicht geladen werden.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (loading) return <LoadingSpinner text="Lade News..." />;

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-danger p-4">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  if (!news.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-txt-secondary">
        <Newspaper className="w-8 h-8 mb-2 opacity-50" />
        <span className="text-sm">Keine aktuellen News verfügbar</span>
      </div>
    );
  }

  // Split into featured (first item with thumbnail) and rest
  const featured = news.find((n) => n.thumbnail);
  const rest = featured ? news.filter((n) => n !== featured) : news;

  return (
    <div className="animate-slide-up space-y-3">
      {/* Featured article (if has thumbnail) */}
      {featured && (
        <a
          href={featured.link}
          target="_blank"
          rel="noopener noreferrer"
          className="card block overflow-hidden group hover:border-accent/30 transition-colors"
        >
          {featured.thumbnail && (
            <div className="relative h-40 overflow-hidden">
              <img
                src={featured.thumbnail}
                alt=""
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <h3 className="text-sm font-semibold text-white line-clamp-2 leading-snug">
                  {featured.title}
                </h3>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-txt-muted">
              {featured.publisher && (
                <span className="font-medium text-txt-secondary">{featured.publisher}</span>
              )}
              {featured.publishedAt && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTimeAgo(featured.publishedAt)}
                  </span>
                </>
              )}
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-txt-muted opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </a>
      )}

      {/* News list */}
      <div className="space-y-1">
        {rest.map((item, i) => {
          const freshness = Math.max(0.1, 1 - i / rest.length);
          return (
            <a
              key={i}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 py-2.5 px-3 rounded-r-lg rounded-l-none bg-dark-700/30 border border-border/20 border-l-[3px] hover:bg-dark-600/40 hover:border-accent/30 hover:border-l-accent hover:scale-[1.02] hover:shadow-lg hover:shadow-black/10 transition-all duration-200 group"
              style={{ borderLeftColor: `rgba(41, 98, 255, ${freshness})` }}
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
                <div className="flex items-center gap-1.5 mt-1">
                  {item.publisher && (
                    <span className="text-[11px] font-medium text-txt-secondary">{item.publisher}</span>
                  )}
                  {item.publishedAt && (
                    <>
                      <span className="text-txt-muted text-[10px]">·</span>
                      <span className="text-[11px] text-txt-muted">{formatTimeAgo(item.publishedAt)}</span>
                    </>
                  )}
                </div>
              </div>
              <ExternalLink className="w-3.5 h-3.5 text-txt-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
            </a>
          );
        })}
      </div>
    </div>
  );
}
