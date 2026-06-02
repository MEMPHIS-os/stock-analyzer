import { useMemo } from 'react';
import { Calendar, CheckCircle2, XCircle, TrendingUp } from 'lucide-react';
import { formatLargeNumber } from '../formatters';
import type { FundamentalsData } from '../types';

interface EarningsCalendarProps {
  earnings: FundamentalsData['earnings'];
  currency: string;
}

interface QuarterResult {
  date: string;
  actual: number;
  estimate: number;
  surprise: number;
  surprisePercent: number;
  beat: boolean;
}

export default function EarningsCalendar({ earnings, currency }: EarningsCalendarProps) {
  const quarterly = earnings?.earningsChart?.quarterly;
  const yearly = earnings?.financialsChart?.yearly;

  // Compute quarterly results with surprise calculations
  const quarterResults = useMemo<QuarterResult[]>(() => {
    if (!quarterly || quarterly.length === 0) return [];
    return quarterly.map((q) => {
      const surprise = q.actual - q.estimate;
      const surprisePercent = q.estimate !== 0 ? (surprise / Math.abs(q.estimate)) * 100 : 0;
      return {
        date: q.date,
        actual: q.actual,
        estimate: q.estimate,
        surprise,
        surprisePercent,
        beat: q.actual >= q.estimate,
      };
    });
  }, [quarterly]);

  // Summary stats
  const summaryStats = useMemo(() => {
    if (quarterResults.length === 0) return null;

    const beats = quarterResults.filter((q) => q.beat).length;
    const beatRate = (beats / quarterResults.length) * 100;
    const avgSurprise =
      quarterResults.reduce((sum, q) => sum + q.surprisePercent, 0) / quarterResults.length;

    // Streak: consecutive beats or misses from most recent
    let streakType: 'beat' | 'miss' = quarterResults[quarterResults.length - 1]?.beat ? 'beat' : 'miss';
    let streakCount = 0;
    for (let i = quarterResults.length - 1; i >= 0; i--) {
      if ((streakType === 'beat' && quarterResults[i].beat) ||
          (streakType === 'miss' && !quarterResults[i].beat)) {
        streakCount++;
      } else {
        break;
      }
    }

    return { beatRate, avgSurprise, streakCount, streakType };
  }, [quarterResults]);

  // Yearly with YoY growth
  const yearlyWithGrowth = useMemo(() => {
    if (!yearly || yearly.length === 0) return [];
    return yearly.map((y, i) => {
      const prevRevenue = i > 0 ? yearly[i - 1].revenue : null;
      const revenueGrowth = prevRevenue && prevRevenue !== 0
        ? ((y.revenue - prevRevenue) / Math.abs(prevRevenue)) * 100
        : null;
      return { ...y, revenueGrowth };
    });
  }, [yearly]);

  // SVG surprise chart dimensions
  const svgWidth = 400;
  const svgHeight = 120;
  const svgPadding = { top: 10, bottom: 25, left: 10, right: 10 };

  if (!quarterly?.length && !yearly?.length) {
    return (
      <div className="card p-6 text-center text-txt-secondary text-sm">
        Keine Earnings-Daten verfügbar.
      </div>
    );
  }

  const maxAbsSurprise = quarterResults.length > 0
    ? Math.max(...quarterResults.map((q) => Math.abs(q.surprisePercent)), 0.01)
    : 1;

  const chartAreaWidth = svgWidth - svgPadding.left - svgPadding.right;
  const chartAreaHeight = svgHeight - svgPadding.top - svgPadding.bottom;
  const barWidth = quarterResults.length > 0
    ? Math.min(40, (chartAreaWidth / quarterResults.length) * 0.6)
    : 40;
  const barGap = quarterResults.length > 0
    ? chartAreaWidth / quarterResults.length
    : chartAreaWidth;
  const zeroY = svgPadding.top + chartAreaHeight / 2;

  const currencySymbol = currency === 'EUR' ? '\u20AC' : currency === 'GBP' ? '\u00A3' : '$';

  return (
    <div className="animate-slide-up space-y-4">
      {/* Header */}
      <div className="card p-4">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="p-1.5 rounded-lg bg-accent/10">
            <Calendar className="w-4 h-4 text-accent" />
          </div>
          <h3 className="text-sm font-bold text-txt-primary">Earnings-Kalender</h3>
        </div>

        {/* Summary Stats */}
        {summaryStats && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-dark-700/40 rounded-xl p-3 text-center ring-1 ring-border/5">
              <div className="text-[10px] text-txt-muted uppercase tracking-wide mb-1">Beat-Rate</div>
              <div className={`text-lg font-bold font-mono tabular-nums ${summaryStats.beatRate >= 50 ? 'text-success' : 'text-danger'}`}>
                {summaryStats.beatRate.toFixed(0)}%
              </div>
            </div>
            <div className="bg-dark-700/40 rounded-xl p-3 text-center ring-1 ring-border/5">
              <div className="text-[10px] text-txt-muted uppercase tracking-wide mb-1">{'\u00D8'} {'\u00DC'}berraschung</div>
              <div className={`text-lg font-bold font-mono tabular-nums ${summaryStats.avgSurprise >= 0 ? 'text-success' : 'text-danger'}`}>
                {summaryStats.avgSurprise >= 0 ? '+' : ''}{summaryStats.avgSurprise.toFixed(1)}%
              </div>
            </div>
            <div className="bg-dark-700/40 rounded-xl p-3 text-center ring-1 ring-border/5">
              <div className="text-[10px] text-txt-muted uppercase tracking-wide mb-1">Serie</div>
              <div className={`text-lg font-bold font-mono tabular-nums ${summaryStats.streakType === 'beat' ? 'text-success' : 'text-danger'}`}>
                {summaryStats.streakCount}x {summaryStats.streakType === 'beat' ? 'Beat' : 'Miss'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quarterly Earnings Table */}
      {quarterResults.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <TrendingUp className="w-4 h-4 text-accent" />
            </div>
            <h3 className="text-sm font-bold text-txt-primary">Quartals-Ergebnisse</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/10">
                  <th className="text-left py-2 text-txt-muted font-semibold uppercase tracking-wider">Quartal</th>
                  <th className="text-right py-2 text-txt-muted font-semibold uppercase tracking-wider">Tats. EPS</th>
                  <th className="text-right py-2 text-txt-muted font-semibold uppercase tracking-wider">Sch{'\u00E4'}tz. EPS</th>
                  <th className="text-right py-2 text-txt-muted font-semibold uppercase tracking-wider">{'\u00DC'}berraschung</th>
                  <th className="text-right py-2 text-txt-muted font-semibold uppercase tracking-wider">%</th>
                  <th className="text-center py-2 text-txt-muted font-semibold uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody>
                {[...quarterResults].reverse().map((q) => (
                  <tr key={q.date} className="border-b border-border/5 last:border-0 hover:bg-accent/[0.04] transition-colors">
                    <td className="py-2 font-mono text-txt-primary">{q.date}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-txt-primary">
                      {currencySymbol}{q.actual.toFixed(2)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-txt-secondary">
                      {currencySymbol}{q.estimate.toFixed(2)}
                    </td>
                    <td className={`py-2 text-right font-mono tabular-nums ${q.beat ? 'text-success' : 'text-danger'}`}>
                      {q.surprise >= 0 ? '+' : ''}{currencySymbol}{q.surprise.toFixed(2)}
                    </td>
                    <td className={`py-2 text-right font-mono tabular-nums ${q.beat ? 'text-success' : 'text-danger'}`}>
                      {q.surprisePercent >= 0 ? '+' : ''}{q.surprisePercent.toFixed(1)}%
                    </td>
                    <td className="py-2 text-center">
                      {q.beat ? (
                        <CheckCircle2 className="w-4 h-4 text-success inline-block" />
                      ) : (
                        <XCircle className="w-4 h-4 text-danger inline-block" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Surprise Bar Chart */}
      {quarterResults.length > 0 && (
        <div className="card p-4">
          <h4 className="text-xs font-semibold text-txt-secondary mb-3">{'\u00DC'}berraschungs-Chart</h4>
          <div className="flex justify-center">
            <svg
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              className="w-full max-w-md"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Zero line */}
              <line
                x1={svgPadding.left}
                y1={zeroY}
                x2={svgWidth - svgPadding.right}
                y2={zeroY}
                stroke="currentColor"
                className="text-border"
                strokeWidth="1"
                strokeDasharray="4 2"
              />

              {/* Bars */}
              {quarterResults.map((q, i) => {
                const barHeight = (Math.abs(q.surprisePercent) / maxAbsSurprise) * (chartAreaHeight / 2);
                const x = svgPadding.left + i * barGap + (barGap - barWidth) / 2;
                const y = q.beat ? zeroY - barHeight : zeroY;

                return (
                  <g key={q.date}>
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={Math.max(barHeight, 1)}
                      rx={3}
                      className={q.beat ? 'fill-success/70' : 'fill-danger/70'}
                    />
                    {/* Value label */}
                    <text
                      x={x + barWidth / 2}
                      y={q.beat ? y - 4 : y + barHeight + 12}
                      textAnchor="middle"
                      className={`text-[9px] font-mono ${q.beat ? 'fill-success' : 'fill-danger'}`}
                    >
                      {q.surprisePercent >= 0 ? '+' : ''}{q.surprisePercent.toFixed(1)}%
                    </text>
                    {/* Quarter label */}
                    <text
                      x={x + barWidth / 2}
                      y={svgHeight - 4}
                      textAnchor="middle"
                      className="text-[9px] fill-current text-txt-muted"
                    >
                      {q.date}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* Annual Revenue & Earnings */}
      {yearlyWithGrowth.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <TrendingUp className="w-4 h-4 text-accent" />
            </div>
            <h3 className="text-sm font-bold text-txt-primary">J{'\u00E4'}hrliche Finanzen</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/10">
                  <th className="text-left py-2 text-txt-muted font-semibold uppercase tracking-wider">Jahr</th>
                  <th className="text-right py-2 text-txt-muted font-semibold uppercase tracking-wider">Umsatz</th>
                  <th className="text-right py-2 text-txt-muted font-semibold uppercase tracking-wider">Gewinn</th>
                  <th className="text-right py-2 text-txt-muted font-semibold uppercase tracking-wider">YoY Wachstum</th>
                </tr>
              </thead>
              <tbody>
                {[...yearlyWithGrowth].reverse().map((y) => (
                  <tr key={y.date} className="border-b border-border/5 last:border-0 hover:bg-accent/[0.04] transition-colors">
                    <td className="py-2 font-mono text-txt-primary">{y.date}</td>
                    <td className="py-2 text-right font-mono tabular-nums text-accent">
                      {formatLargeNumber(y.revenue)}
                    </td>
                    <td className={`py-2 text-right font-mono tabular-nums ${y.earnings >= 0 ? 'text-success' : 'text-danger'}`}>
                      {formatLargeNumber(y.earnings)}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      {y.revenueGrowth !== null ? (
                        <span className={y.revenueGrowth >= 0 ? 'text-success' : 'text-danger'}>
                          {y.revenueGrowth >= 0 ? '+' : ''}{y.revenueGrowth.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-txt-muted">{'\u2014'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
