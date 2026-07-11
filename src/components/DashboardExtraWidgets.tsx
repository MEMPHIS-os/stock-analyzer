import { useEffect, useState } from 'react';
import {
  CalendarRange,
  Clock,
  FlaskConical,
  GitCompareArrows,
  Globe,
  Grid3x3,
  LayoutGrid,
  PiggyBank,
  SlidersHorizontal,
  Zap,
  type LucideIcon,
} from 'lucide-react';

type TFn = (key: string) => string;

// ─── QuickActionsWidget ───

interface QuickAction {
  path: string;
  labelKey: string;
  icon: LucideIcon;
}

// Routes and icons mirror the main navigation (see Header.tsx).
const QUICK_ACTIONS: QuickAction[] = [
  { path: '/screener', labelKey: 'nav.screener', icon: SlidersHorizontal },
  { path: '/heatmap', labelKey: 'nav.heatmap', icon: Grid3x3 },
  { path: '/multi', labelKey: 'nav.multiChart', icon: LayoutGrid },
  { path: '/compare', labelKey: 'nav.compare', icon: GitCompareArrows },
  { path: '/backtesting', labelKey: 'nav.backtesting', icon: FlaskConical },
  { path: '/global', labelKey: 'nav.globalMarkets', icon: Globe },
  { path: '/funds', labelKey: 'nav.funds', icon: PiggyBank },
  { path: '/calendar', labelKey: 'nav.calendar', icon: CalendarRange },
];

interface QuickActionsWidgetProps {
  navigate: (path: string) => void;
  t: TFn;
}

export function QuickActionsWidget({ navigate, t }: QuickActionsWidgetProps) {
  return (
    <div className="animate-slide-up">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-1.5 rounded-lg bg-accent/10">
          <Zap className="w-5 h-5 text-accent" />
        </div>
        <h2 className="section-title">{t('dashboard.widget.quickActions')}</h2>
      </div>
      <div className="card p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 stagger-children">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.path}
                onClick={() => navigate(action.path)}
                className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl bg-dark-700/40 ring-1 ring-border/10 hover:ring-accent/30 hover:bg-accent/5 transition-all duration-200 active:scale-[0.98] group"
                title={t(action.labelKey)}
              >
                <div className="p-1.5 rounded-lg bg-accent/10 group-hover:bg-accent/20 transition-colors">
                  <Icon className="w-4 h-4 text-accent" />
                </div>
                <span className="text-[11px] font-medium text-txt-secondary group-hover:text-txt-primary transition-colors text-center leading-tight truncate w-full">
                  {t(action.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── MarketStatusWidget ───

// Session times per exchange in local exchange time. Weekends are closed;
// public holidays are deliberately ignored. The timezone handling follows the
// Intl.DateTimeFormat/formatToParts pattern used by the (non-exported)
// helpers in src/pages/GlobalMarkets.tsx (v1.5.7).

interface ExchangeSession {
  openMinutes: number;
  closeMinutes: number;
}

interface ExchangeDef {
  id: string;
  nameDe: string;
  nameEn: string;
  timezone: string;
  sessions: ExchangeSession[];
}

const mins = (h: number, m: number) => h * 60 + m;

const EXCHANGES: ExchangeDef[] = [
  {
    id: 'nyse',
    nameDe: 'NYSE',
    nameEn: 'NYSE',
    timezone: 'America/New_York',
    sessions: [{ openMinutes: mins(9, 30), closeMinutes: mins(16, 0) }],
  },
  {
    id: 'lse',
    nameDe: 'LSE',
    nameEn: 'LSE',
    timezone: 'Europe/London',
    sessions: [{ openMinutes: mins(8, 0), closeMinutes: mins(16, 30) }],
  },
  {
    id: 'xetra',
    nameDe: 'XETRA',
    nameEn: 'XETRA',
    timezone: 'Europe/Berlin',
    sessions: [{ openMinutes: mins(9, 0), closeMinutes: mins(17, 30) }],
  },
  {
    id: 'tokyo',
    nameDe: 'Tokio',
    nameEn: 'Tokyo',
    timezone: 'Asia/Tokyo',
    sessions: [
      { openMinutes: mins(9, 0), closeMinutes: mins(11, 30) },
      { openMinutes: mins(12, 30), closeMinutes: mins(15, 0) },
    ],
  },
  {
    id: 'hongkong',
    nameDe: 'Hongkong',
    nameEn: 'Hong Kong',
    timezone: 'Asia/Hong_Kong',
    sessions: [
      { openMinutes: mins(9, 30), closeMinutes: mins(12, 0) },
      { openMinutes: mins(13, 0), closeMinutes: mins(16, 0) },
    ],
  },
  {
    id: 'sydney',
    nameDe: 'Sydney',
    nameEn: 'Sydney',
    timezone: 'Australia/Sydney',
    sessions: [{ openMinutes: mins(10, 0), closeMinutes: mins(16, 0) }],
  },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getZonedNow(timezone: string, now: Date): { minutes: number; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
    const hour = parseInt(get('hour'), 10) % 24;
    const minute = parseInt(get('minute'), 10);
    const weekday = WEEKDAYS.indexOf(get('weekday'));
    return { minutes: (isNaN(hour) ? 0 : hour) * 60 + (isNaN(minute) ? 0 : minute), weekday };
  } catch {
    return { minutes: 0, weekday: -1 };
  }
}

function isExchangeOpen(def: ExchangeDef, now: Date): boolean {
  const { minutes, weekday } = getZonedNow(def.timezone, now);
  // Mon (1) – Fri (5) only; unknown weekday (-1) counts as closed.
  if (weekday < 1 || weekday > 5) return false;
  return def.sessions.some((s) => minutes >= s.openMinutes && minutes < s.closeMinutes);
}

function localTimeLabel(timezone: string, now: Date, locale: 'de' | 'en'): string {
  try {
    return now.toLocaleTimeString(locale === 'de' ? 'de-DE' : 'en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '--:--';
  }
}

interface MarketStatusWidgetProps {
  t: TFn;
  locale: 'de' | 'en';
}

export function MarketStatusWidget({ t, locale }: MarketStatusWidgetProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="animate-slide-up">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="p-1.5 rounded-lg bg-accent/10">
          <Clock className="w-5 h-5 text-accent" />
        </div>
        <h2 className="section-title">{t('dashboard.widget.marketStatus')}</h2>
      </div>
      <div className="card p-4">
        <div className="space-y-0.5">
          {EXCHANGES.map((exchange) => {
            const open = isExchangeOpen(exchange, now);
            return (
              <div
                key={exchange.id}
                className="flex items-center justify-between gap-3 px-2 py-2 rounded-lg border-b border-border/5 last:border-0 hover:bg-dark-600/20 transition-colors duration-200"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      open ? 'bg-success animate-pulse' : 'bg-danger'
                    }`}
                  />
                  <span className="text-sm font-medium text-txt-primary truncate">
                    {locale === 'de' ? exchange.nameDe : exchange.nameEn}
                  </span>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="text-xs font-mono tabular-nums text-txt-secondary">
                    {localTimeLabel(exchange.timezone, now, locale)}
                  </span>
                  <span
                    className={`text-[11px] font-semibold w-14 text-right ${
                      open ? 'text-success' : 'text-danger/80'
                    }`}
                  >
                    {open ? t('dashboard.marketStatus.open') : t('dashboard.marketStatus.closed')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
