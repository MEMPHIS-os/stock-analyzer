import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  Clock,
} from 'lucide-react';
import { useApp } from '../context';
import { fetchGlobalMarkets, fetchSparklines } from '../api';
import type { GlobalMarketIndex } from '../api';
import { formatPercent } from '../formatters';
import { usePrice } from '../hooks/usePrice';
import { Price } from '../components/Price';

// ─── Market Hours per Index Symbol ───

interface MarketHours {
  timezone: string;
  openHour: number;
  openMinute: number;
  closeHour: number;
  closeMinute: number;
}

const MARKET_HOURS: Record<string, MarketHours> = {
  // Americas
  '^DJI':    { timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0 },
  '^GSPC':   { timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0 },
  '^IXIC':   { timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0 },
  '^RUT':    { timezone: 'America/New_York', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0 },
  '^GSPTSE': { timezone: 'America/Toronto', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0 },
  // Europe
  '^GDAXI':    { timezone: 'Europe/Berlin', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 30 },
  '^FTSE':     { timezone: 'Europe/London', openHour: 8, openMinute: 0, closeHour: 16, closeMinute: 30 },
  '^FCHI':     { timezone: 'Europe/Paris', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 30 },
  '^STOXX50E': { timezone: 'Europe/Berlin', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 30 },
  '^AEX':      { timezone: 'Europe/Amsterdam', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 30 },
  '^IBEX':     { timezone: 'Europe/Madrid', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 30 },
  '^SSMI':     { timezone: 'Europe/Zurich', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 30 },
  // Asia-Pacific
  '^N225':     { timezone: 'Asia/Tokyo', openHour: 9, openMinute: 0, closeHour: 15, closeMinute: 0 },
  '^HSI':      { timezone: 'Asia/Hong_Kong', openHour: 9, openMinute: 30, closeHour: 16, closeMinute: 0 },
  '000001.SS': { timezone: 'Asia/Shanghai', openHour: 9, openMinute: 30, closeHour: 15, closeMinute: 0 },
  '^AORD':     { timezone: 'Australia/Sydney', openHour: 10, openMinute: 0, closeHour: 16, closeMinute: 0 },
  '^KS11':     { timezone: 'Asia/Seoul', openHour: 9, openMinute: 0, closeHour: 15, closeMinute: 30 },
  '^BSESN':    { timezone: 'Asia/Kolkata', openHour: 9, openMinute: 15, closeHour: 15, closeMinute: 30 },
  '^STI':      { timezone: 'Asia/Singapore', openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 0 },
  // Latin America
  '^BVSP': { timezone: 'America/Sao_Paulo', openHour: 10, openMinute: 0, closeHour: 17, closeMinute: 0 },
  '^MXX':  { timezone: 'America/Mexico_City', openHour: 8, openMinute: 30, closeHour: 15, closeMinute: 0 },
};

function formatTime(hour: number, minute: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hour)}:${pad(minute)}`;
}

function convertTimeTo(hour: number, minute: number, fromTZ: string, toTZ: string): string {
  if (fromTZ === toTZ) return formatTime(hour, minute);

  const ref = new Date();
  const mins = (tz: string) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(ref);
    return parseInt(p.find((x) => x.type === 'hour')?.value || '0') * 60
      + parseInt(p.find((x) => x.type === 'minute')?.value || '0');
  };

  const offset = mins(toTZ) - mins(fromTZ);
  const target = (((hour * 60 + minute + offset) % 1440) + 1440) % 1440;
  return formatTime(Math.floor(target / 60), target % 60);
}

function getTimezoneAbbr(timezone: string, locale: 'de' | 'en' = 'en'): string {
  try {
    const loc = locale === 'de' ? 'de-DE' : 'en-US';
    const parts = new Intl.DateTimeFormat(loc, {
      timeZone: timezone,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value || '';
  } catch {
    return '';
  }
}

const DE_TIMEZONE = 'Europe/Berlin';

function getMarketTimeLabel(
  symbol: string,
  isOpen: boolean,
  locale: 'de' | 'en'
): string | null {
  const hours = MARKET_HOURS[symbol];
  if (!hours) return null;

  const isDe = locale === 'de';
  const displayTZ = isDe ? DE_TIMEZONE : hours.timezone;
  const tzLabel = getTimezoneAbbr(displayTZ, locale);

  const h = isOpen ? hours.closeHour : hours.openHour;
  const m = isOpen ? hours.closeMinute : hours.openMinute;
  const time = isDe
    ? convertTimeTo(h, m, hours.timezone, DE_TIMEZONE)
    : formatTime(h, m);

  const label = isOpen
    ? (isDe ? 'Schließt' : 'Closes')
    : (isDe ? 'Öffnet' : 'Opens');

  return `${label} ${time} ${tzLabel}`;
}

// ─── Region config ───

const REGIONS = [
  { key: 'americas', emoji: '\u{1F1FA}\u{1F1F8}', i18nKey: 'globalMarkets.americas' },
  { key: 'europe', emoji: '\u{1F1EA}\u{1F1FA}', i18nKey: 'globalMarkets.europe' },
  { key: 'asiaPacific', emoji: '\u{1F1EF}\u{1F1F5}', i18nKey: 'globalMarkets.asiaPacific' },
  { key: 'latinAmerica', emoji: '\u{1F30E}', i18nKey: 'globalMarkets.latinAmerica' },
];

// ─── MiniSparkline ───

function MiniSparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data.length || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 32;
  const w = 80;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={w} height={h} className="mt-1">
      <polyline
        points={points}
        fill="none"
        stroke={positive ? '#26a69a' : '#ef5350'}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── GlobalMarkets Page ───

export default function GlobalMarkets() {
  const navigate = useNavigate();
  const { locale, t } = useApp();
  const { fp } = usePrice();

  const [data, setData] = useState<Record<string, GlobalMarketIndex[]>>({});
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const marketsData = await fetchGlobalMarkets();
        if (cancelled) return;
        setData(marketsData);

        // Collect all symbols for sparklines
        const allSymbols = Object.values(marketsData).flat().map((idx) => idx.symbol);
        if (allSymbols.length > 0) {
          const sparks = await fetchSparklines(allSymbols);
          if (!cancelled) {
            setSparklines(sparks);
          }
        }

        if (!cancelled) {
          setLastUpdated(new Date());
        }
      } catch {
        // silently fail, keep existing data
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const iv = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="h-8 w-48 rounded-lg skeleton-shimmer" />
        {Array.from({ length: 2 }).map((_, r) => (
          <div key={r} className="space-y-3">
            <div className="h-6 w-40 rounded-lg skeleton-shimmer" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-28 rounded-2xl skeleton-shimmer" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-accent/10">
            <Globe className="w-5 h-5 text-accent" />
          </div>
          <h1 className="section-title text-xl">{t('globalMarkets.title')}</h1>
        </div>
        {lastUpdated && (
          <div className="flex items-center gap-1.5 text-xs text-txt-muted bg-dark-700/40 px-2.5 py-1 rounded-full">
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="font-mono tabular-nums">
              {lastUpdated.toLocaleTimeString(locale === 'de' ? 'de-DE' : 'en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          </div>
        )}
      </div>

      {/* Region sections */}
      {REGIONS.map((region) => {
        const indices = data[region.key];
        if (!indices || indices.length === 0) return null;

        return (
          <div key={region.key}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">{region.emoji}</span>
              <h2 className="section-title text-lg">{t(region.i18nKey)}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 stagger-children">
              {indices.map((idx) => {
                const isPositive = idx.change >= 0;
                const sparkData = sparklines[idx.symbol] || [];
                const isOpen =
                  idx.marketState === 'REGULAR' ||
                  idx.marketState === 'PRE' ||
                  idx.marketState === 'POST';

                return (
                  <div
                    key={idx.symbol}
                    className="card p-4 cursor-pointer group"
                    onClick={() => navigate(`/stock/${idx.symbol}`)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-semibold text-txt-primary truncate">
                          {idx.shortName}
                        </span>
                        {idx.marketState && (
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isOpen ? 'bg-success animate-pulse' : 'bg-txt-muted'
                            }`}
                            title={
                              isOpen
                                ? t('globalMarkets.open')
                                : t('globalMarkets.closed')
                            }
                          />
                        )}
                      </div>
                      <div className={`flex items-center justify-center w-6 h-6 rounded-lg shrink-0 transition-colors duration-200 ${isPositive ? 'bg-success/10 group-hover:bg-success/20' : 'bg-danger/10 group-hover:bg-danger/20'}`}>
                        {isPositive ? (
                          <ArrowUpRight className="w-3.5 h-3.5 text-success" />
                        ) : (
                          <ArrowDownRight className="w-3.5 h-3.5 text-danger" />
                        )}
                      </div>
                    </div>

                    <div className="text-lg font-bold font-mono tabular-nums text-txt-primary tracking-tight">
                      <Price value={idx.price} currency={idx.currency} size={16} />
                    </div>

                    <div className="flex items-center justify-between mt-1">
                      <div className="flex items-center gap-2">
                        {isPositive ? (
                          <TrendingUp className="w-3.5 h-3.5 text-success" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5 text-danger" />
                        )}
                        <span
                          className={`text-sm font-mono tabular-nums font-medium ${
                            isPositive ? 'text-success' : 'text-danger'
                          }`}
                        >
                          {isPositive ? '+' : ''}
                          {idx.change.toFixed(2)} ({formatPercent(idx.changePercent)})
                        </span>
                      </div>
                      <MiniSparkline data={sparkData} positive={isPositive} />
                    </div>

                    <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border/15">
                      {idx.exchange && (
                        <span className="text-[11px] text-txt-muted">{idx.exchange}</span>
                      )}
                      {(() => {
                        const timeLabel = getMarketTimeLabel(idx.symbol, isOpen, locale);
                        if (!timeLabel) return null;
                        return (
                          <span className={`text-[11px] flex items-center gap-1 ${
                            isOpen ? 'text-success/80' : 'text-txt-muted'
                          }`}>
                            <Clock className="w-3 h-3" />
                            {timeLabel}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
