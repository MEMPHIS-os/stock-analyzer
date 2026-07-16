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

// Session times per exchange in local exchange time. Weekends and the exchange
// holiday calendars below are treated as closed. The timezone handling follows
// the Intl.DateTimeFormat/formatToParts pattern used by the (non-exported)
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

// Exchange holiday calendars (full-day closures) as exchange-local YYYY-MM-DD
// dates. Covers 2026–2027 and should be reviewed annually. Only high-confidence
// dates are listed: a missing entry merely degrades to "open" (the old
// behaviour), whereas a wrong entry would falsely show "closed" — so err toward
// omission. Half-day early closes are not modelled; some Asian lunar/variable
// holidays are only partially covered.
const HOLIDAYS: Record<string, Set<string>> = {
  nyse: new Set([
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
    '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
    '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
    '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
  ]),
  lse: new Set([
    '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25',
    '2026-08-31', '2026-12-25', '2026-12-28',
    '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31',
    '2027-08-30', '2027-12-27', '2027-12-28',
  ]),
  xetra: new Set([
    '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-12-24',
    '2026-12-25', '2026-12-31',
    '2027-01-01', '2027-03-26', '2027-03-29', '2027-12-24', '2027-12-31',
  ]),
  tokyo: new Set([
    '2026-01-01', '2026-01-02', '2026-01-12', '2026-02-11', '2026-02-23',
    '2026-03-20', '2026-04-29', '2026-05-04', '2026-05-05', '2026-05-06',
    '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-23', '2026-10-12',
    '2026-11-03', '2026-11-23', '2026-12-31',
    '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-22',
    '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19',
    '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11', '2027-11-03',
    '2027-11-23', '2027-12-31',
  ]),
  hongkong: new Set([
    '2026-01-01', '2026-02-17', '2026-02-18', '2026-02-19', '2026-04-03',
    '2026-04-06', '2026-05-01', '2026-05-25', '2026-06-19', '2026-07-01',
    '2026-10-01', '2026-10-19', '2026-12-25',
    '2027-01-01', '2027-02-06', '2027-02-08', '2027-02-09', '2027-03-26',
    '2027-05-01', '2027-07-01', '2027-10-01', '2027-12-25',
  ]),
  sydney: new Set([
    '2026-01-01', '2026-01-26', '2026-04-03', '2026-04-06', '2026-04-25',
    '2026-06-08', '2026-12-25', '2026-12-28',
    '2027-01-01', '2027-01-26', '2027-03-26', '2027-03-29', '2027-06-14',
    '2027-12-27', '2027-12-28',
  ]),
};

function getZonedNow(
  timezone: string,
  now: Date,
): { minutes: number; weekday: number; dateKey: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
    const hour = parseInt(get('hour'), 10) % 24;
    const minute = parseInt(get('minute'), 10);
    const weekday = WEEKDAYS.indexOf(get('weekday'));
    const dateKey = `${get('year')}-${get('month')}-${get('day')}`;
    return {
      minutes: (isNaN(hour) ? 0 : hour) * 60 + (isNaN(minute) ? 0 : minute),
      weekday,
      dateKey,
    };
  } catch {
    return { minutes: 0, weekday: -1, dateKey: '' };
  }
}

// Calendar-date math on a plain YYYY-MM-DD key (tz-independent once we already
// hold the exchange-local date). Used to walk forward to the next trading day.
function shiftDateKey(dateKey: string, days: number): { dateKey: string; weekday: number } {
  const [y, m, d] = dateKey.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(ms);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return { dateKey: `${dt.getUTCFullYear()}-${mm}-${dd}`, weekday: dt.getUTCDay() };
}

function isTradingDay(def: ExchangeDef, weekday: number, dateKey: string): boolean {
  if (weekday < 1 || weekday > 5) return false; // weekend / unknown (-1)
  return !(HOLIDAYS[def.id]?.has(dateKey) ?? false);
}

export interface ExchangeStatus {
  open: boolean;
  /** Minutes until the next state change (close if open, next open if closed);
   *  null when it can't be determined. */
  minutesUntilChange: number | null;
}

export function getExchangeStatus(def: ExchangeDef, now: Date): ExchangeStatus {
  const { minutes, weekday, dateKey } = getZonedNow(def.timezone, now);
  if (!dateKey) return { open: false, minutesUntilChange: null };
  const sessions = [...def.sessions].sort((a, b) => a.openMinutes - b.openMinutes);

  if (isTradingDay(def, weekday, dateKey)) {
    for (const s of sessions) {
      if (minutes >= s.openMinutes && minutes < s.closeMinutes) {
        return { open: true, minutesUntilChange: s.closeMinutes - minutes };
      }
    }
    // Not in a session yet — does one still open later today?
    for (const s of sessions) {
      if (minutes < s.openMinutes) {
        return { open: false, minutesUntilChange: s.openMinutes - minutes };
      }
    }
  }

  // Closed for the rest of the day: walk forward to the next trading day.
  const minutesLeftToday = 1440 - minutes;
  const firstOpen = sessions[0]?.openMinutes ?? 0;
  for (let k = 1; k <= 10; k++) {
    const { dateKey: dk, weekday: wd } = shiftDateKey(dateKey, k);
    if (isTradingDay(def, wd, dk)) {
      return { open: false, minutesUntilChange: minutesLeftToday + (k - 1) * 1440 + firstOpen };
    }
  }
  return { open: false, minutesUntilChange: null };
}

function formatCountdown(mins: number, de: boolean): string {
  if (mins < 60) return de ? `${mins} Min` : `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return de ? `${h} Std ${m} Min` : `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return de ? `${d} Tg ${hh} Std` : `${d}d ${hh}h`;
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
            const status = getExchangeStatus(exchange, now);
            const open = status.open;
            const countdown =
              status.minutesUntilChange != null
                ? `${open ? t('dashboard.marketStatus.closesIn') : t('dashboard.marketStatus.opensIn')} ${formatCountdown(status.minutesUntilChange, locale === 'de')}`
                : null;
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
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-txt-primary truncate">
                      {locale === 'de' ? exchange.nameDe : exchange.nameEn}
                    </div>
                    {countdown && (
                      <div className="text-[10px] text-txt-muted truncate">{countdown}</div>
                    )}
                  </div>
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
