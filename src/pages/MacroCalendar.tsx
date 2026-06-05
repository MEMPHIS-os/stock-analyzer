import { useMemo, useState } from 'react';
import { CalendarRange, Circle } from 'lucide-react';
import { useApp } from '../context';

// ---------------------------------------------------------------------------
// Economic calendar generated from rule-based release schedules. These rules
// (NFP = first Friday, jobless claims = Thursdays, CPI/PPI/Retail Sales mid
// month, PCE late month, GDP quarterly) are accurate by construction, so no
// external data feed is required. Times are the *typical* release window in
// CET and may shift by a day around holidays.
// ---------------------------------------------------------------------------

type Impact = 'high' | 'medium' | 'low';
type Region = 'US' | 'EU' | 'DE';

interface MacroEvent {
  date: Date;
  time: string; // CET
  region: Region;
  title: string;
  titleEn: string;
  impact: Impact;
}

const WEEKS_AHEAD = 6;

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

function buildEvents(from: Date, to: Date): MacroEvent[] {
  const events: MacroEvent[] = [];
  const push = (d: Date, time: string, region: Region, title: string, titleEn: string, impact: Impact) => {
    if (d >= from && d <= to) events.push({ date: d, time, region, title, titleEn, impact });
  };

  // Weekly: US initial jobless claims — every Thursday.
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= to) {
    if (cursor.getDay() === 4) {
      push(new Date(cursor), '14:30', 'US', 'Erstanträge Arbeitslosenhilfe', 'Initial Jobless Claims', 'medium');
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // Month-anchored releases for every month touched by the window.
  const months: { y: number; m: number }[] = [];
  const mc = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (mc <= end) {
    months.push({ y: mc.getFullYear(), m: mc.getMonth() });
    mc.setMonth(mc.getMonth() + 1);
  }

  for (const { y, m } of months) {
    // NFP & unemployment — first Friday, 14:30 CET.
    push(nthWeekdayOfMonth(y, m, 5, 1), '14:30', 'US', 'Arbeitsmarktbericht (NFP)', 'Nonfarm Payrolls', 'high');
    // ISM Manufacturing PMI — 1st business day region (approx 1st).
    push(new Date(y, m, 1), '16:00', 'US', 'ISM Einkaufsmanagerindex', 'ISM Manufacturing PMI', 'medium');
    // CPI — around the 12th, 14:30 CET.
    push(new Date(y, m, 12), '14:30', 'US', 'Verbraucherpreise (CPI)', 'Consumer Price Index', 'high');
    // PPI — around the 13th.
    push(new Date(y, m, 13), '14:30', 'US', 'Erzeugerpreise (PPI)', 'Producer Price Index', 'medium');
    // Retail sales — around the 15th.
    push(new Date(y, m, 15), '14:30', 'US', 'Einzelhandelsumsätze', 'Retail Sales', 'high');
    // PCE (Fed's preferred inflation gauge) — around the 28th.
    push(new Date(y, m, 28), '14:30', 'US', 'PCE-Preisindex', 'PCE Price Index', 'high');
    // Euro-area flash CPI — around the 1st.
    push(new Date(y, m, 1), '11:00', 'EU', 'Verbraucherpreise (HVPI)', 'Euro-area HICP', 'high');
    // German ifo business climate — around the 25th.
    push(new Date(y, m, 25), '10:00', 'DE', 'ifo Geschäftsklima', 'ifo Business Climate', 'medium');
    // US GDP — quarterly (late Jan/Apr/Jul/Oct), around the 30th.
    if (m % 3 === 0) {
      push(new Date(y, m, 30), '14:30', 'US', 'BIP (Quartal)', 'GDP (quarterly)', 'high');
    }
  }

  return events.sort((a, b) => a.date.getTime() - b.date.getTime() || a.time.localeCompare(b.time));
}

const IMPACT_COLOR: Record<Impact, string> = {
  high: 'text-danger',
  medium: 'text-warning',
  low: 'text-txt-muted',
};

const REGION_FLAG: Record<Region, string> = { US: '🇺🇸', EU: '🇪🇺', DE: '🇩🇪' };

export default function MacroCalendar() {
  const { locale } = useApp();
  const de = locale === 'de';
  const [impactFilter, setImpactFilter] = useState<Impact | 'all'>('all');

  const events = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + WEEKS_AHEAD * 7);
    return buildEvents(from, to);
  }, []);

  const filtered = impactFilter === 'all' ? events : events.filter((e) => e.impact === impactFilter);

  // Group by day.
  const byDay = useMemo(() => {
    const map = new Map<string, MacroEvent[]>();
    for (const e of filtered) {
      const key = e.date.toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return [...map.entries()];
  }, [filtered]);

  const dayLabel = (d: Date) =>
    d.toLocaleDateString(de ? 'de-DE' : 'en-US', { weekday: 'long', day: '2-digit', month: 'long' });

  const todayStr = new Date().toDateString();
  const impacts: (Impact | 'all')[] = ['all', 'high', 'medium', 'low'];
  const impactLabel = (i: Impact | 'all') =>
    i === 'all' ? (de ? 'Alle' : 'All') : i === 'high' ? (de ? 'Hoch' : 'High') : i === 'medium' ? (de ? 'Mittel' : 'Medium') : (de ? 'Niedrig' : 'Low');

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="p-1.5 rounded-lg bg-accent/10">
          <CalendarRange className="w-5 h-5 text-accent" />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-txt-primary">{de ? 'Wirtschaftskalender' : 'Economic Calendar'}</h1>
          <p className="text-xs text-txt-muted">{de ? 'Kommende Makro-Termine (nächste 6 Wochen)' : 'Upcoming macro releases (next 6 weeks)'}</p>
        </div>
        <div className="flex gap-0.5 bg-dark-700/60 ring-1 ring-border/10 rounded-xl p-1">
          {impacts.map((i) => (
            <button
              key={i}
              onClick={() => setImpactFilter(i)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all duration-200 ${
                impactFilter === i ? 'bg-accent text-white shadow-glow-sm' : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40'
              }`}
            >
              {impactLabel(i)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {byDay.map(([key, dayEvents]) => {
          const d = dayEvents[0].date;
          const isToday = key === todayStr;
          return (
            <div key={key} className="card overflow-hidden">
              <div className={`px-4 py-2 text-xs font-semibold border-b border-border/20 flex items-center gap-2 ${isToday ? 'text-accent' : 'text-txt-secondary'}`}>
                {dayLabel(d)}
                {isToday && <span className="text-[10px] bg-accent/15 text-accent px-2 py-0.5 rounded-full">{de ? 'Heute' : 'Today'}</span>}
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {dayEvents.map((e, i) => (
                    <tr key={i} className="border-b border-border/5 last:border-0 hover:bg-dark-700/30 transition-colors">
                      <td className="px-4 py-2.5 w-16 font-mono text-txt-secondary tabular-nums">{e.time}</td>
                      <td className="px-2 py-2.5 w-8 text-base">{REGION_FLAG[e.region]}</td>
                      <td className="px-2 py-2.5 text-txt-primary">{de ? e.title : e.titleEn}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${IMPACT_COLOR[e.impact]}`}>
                          <Circle className="w-2 h-2 fill-current" />
                          {impactLabel(e.impact)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        {byDay.length === 0 && (
          <div className="card p-8 text-center text-sm text-txt-muted">{de ? 'Keine Termine.' : 'No events.'}</div>
        )}
      </div>

      <p className="text-[10px] text-txt-muted px-1 leading-snug">
        {de
          ? 'Termine basieren auf regelmäßigen Veröffentlichungsmustern (z. B. NFP am ersten Freitag). Uhrzeiten sind typische CET-Fenster und können sich um Feiertage verschieben.'
          : 'Events are derived from recurring release patterns (e.g. NFP on the first Friday). Times are typical CET windows and may shift around holidays.'}
      </p>
    </div>
  );
}
