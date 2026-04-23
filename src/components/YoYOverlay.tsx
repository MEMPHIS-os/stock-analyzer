import { useEffect, useRef, useCallback, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { fetchChart, getIntervalForRange } from '../api';
import type { OHLCVData, TimeRange } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Shift a "YYYY-MM-DD" date string forward by 1 year.
 * Handles leap-year edge case: Feb 29 becomes Feb 28 the next year.
 */
function shiftDateForward1Year(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const shifted = new Date(y + 1, m - 1, d);
  // If the day overflowed (e.g. Feb 29 -> Mar 1), clamp to last day of month
  if (shifted.getMonth() !== (m - 1) % 12) {
    shifted.setDate(0); // last day of the previous month
  }
  const sy = shifted.getFullYear().toString();
  const sm = (shifted.getMonth() + 1).toString().padStart(2, '0');
  const sd = shifted.getDate().toString().padStart(2, '0');
  return `${sy}-${sm}-${sd}`;
}

/**
 * Shift a unix timestamp (seconds) forward by 1 year.
 */
function shiftTimestampForward1Year(ts: number): number {
  const d = new Date(ts * 1000);
  d.setFullYear(d.getFullYear() + 1);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Determine the appropriate range for fetching data from 1 year ago.
 * For example, if the current range is '1y' we need '2y' to capture the
 * prior year's slice. For '6mo' we need '2y' as well (to reach back 1.5y).
 * We always fetch '2y' of data and filter the correct prior-year window.
 */
function getPriorYearFetchRange(currentRange: TimeRange): TimeRange {
  // For short ranges (intraday, 5-day) the YoY overlay doesn't make much sense
  // because intraday data from a year ago is usually unavailable.
  // We still try with '2y' daily data.
  switch (currentRange) {
    case '1d':
    case '5d':
    case '1mo':
    case '3mo':
    case '6mo':
    case '1y':
      return '2y';
    case '2y':
      return '5y';
    case '5y':
      return '5y'; // max available
    default:
      return '2y';
  }
}

// ─── YoY Overlay Hook ────────────────────────────────────────────────────────

interface UseYoYOverlayOptions {
  symbol: string;
  currentData: OHLCVData[];
  range: TimeRange;
  chartApi: IChartApi | null;
  enabled: boolean;
}

/**
 * Custom hook that manages the YoY overlay line series.
 * When enabled, fetches historical data from 1 year prior, date-shifts it
 * forward by 1 year, and adds a semi-transparent purple dashed line to the
 * chart. When disabled (or on cleanup), removes the series.
 */
export function useYoYOverlay({
  symbol,
  currentData,
  range,
  chartApi,
  enabled,
}: UseYoYOverlayOptions) {
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cleanup helper: remove the line series from the chart
  const removeSeries = useCallback(() => {
    if (lineSeriesRef.current && chartApi) {
      try {
        chartApi.removeSeries(lineSeriesRef.current);
      } catch {
        // series may already have been removed if chart was recreated
      }
      lineSeriesRef.current = null;
    }
  }, [chartApi]);

  useEffect(() => {
    // If not enabled or no chart, clean up and bail
    if (!enabled || !chartApi || !currentData.length) {
      removeSeries();
      return;
    }

    let cancelled = false;

    async function loadPriorYearData() {
      setLoading(true);
      setError(null);

      try {
        const fetchRange = getPriorYearFetchRange(range);
        const interval = getIntervalForRange(fetchRange);
        const result = await fetchChart(symbol, fetchRange, interval);

        if (cancelled) return;

        const allQuotes = result.quotes;
        if (!allQuotes.length) {
          setError('Keine Vorjahresdaten verfuegbar');
          setLoading(false);
          return;
        }

        // Determine the date window of the current chart data
        const currentDates = currentData.map((d) => d.date);
        const firstCurrentDate = currentDates[0];
        const lastCurrentDate = currentDates[currentDates.length - 1];

        // Filter historical data to the corresponding prior-year window
        let priorYearQuotes: OHLCVData[];

        if (typeof firstCurrentDate === 'string') {
          // Daily data: dates are "YYYY-MM-DD"
          // Shift the current window back 1 year to find the prior-year slice
          const shiftBack = (ds: string) => {
            const [y, m, d] = ds.split('-').map(Number);
            return `${y - 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          };
          const priorStart = shiftBack(firstCurrentDate as string);
          const priorEnd = shiftBack(lastCurrentDate as string);

          priorYearQuotes = allQuotes.filter((q) => {
            const qDate = q.date as string;
            return qDate >= priorStart && qDate <= priorEnd;
          });
        } else {
          // Intraday: dates are unix timestamps
          const oneYearSeconds = 365.25 * 24 * 3600;
          const priorStart = (firstCurrentDate as number) - oneYearSeconds;
          const priorEnd = (lastCurrentDate as number) - oneYearSeconds;

          priorYearQuotes = allQuotes.filter((q) => {
            const qTs = q.date as number;
            return qTs >= priorStart && qTs <= priorEnd;
          });
        }

        if (cancelled) return;

        if (!priorYearQuotes.length) {
          setError('Keine Vorjahresdaten im Zeitfenster');
          setLoading(false);
          return;
        }

        // Date-shift the prior year's data forward by 1 year so it aligns
        const shiftedData = priorYearQuotes.map((q) => {
          const shiftedDate =
            typeof q.date === 'string'
              ? shiftDateForward1Year(q.date)
              : shiftTimestampForward1Year(q.date);
          return {
            time: shiftedDate as any,
            value: q.close,
          };
        });

        if (cancelled) return;

        // Remove any existing series before adding a new one
        removeSeries();

        if (!chartApi) return;

        // Add the YoY line series
        const lineSeries = chartApi.addLineSeries({
          color: 'rgba(139, 92, 246, 0.5)',
          lineWidth: 1,
          lineStyle: 2, // Dashed
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: 'VJ',
        });

        lineSeries.setData(shiftedData);
        lineSeriesRef.current = lineSeries;
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError('Vorjahresdaten konnten nicht geladen werden');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPriorYearData();

    return () => {
      cancelled = true;
      removeSeries();
    };
  }, [enabled, symbol, range, chartApi, currentData, removeSeries]);

  // Also clean up when the chart API changes (chart gets recreated)
  useEffect(() => {
    return () => {
      // On chart recreation the old series is already gone; just null out our ref
      lineSeriesRef.current = null;
    };
  }, [chartApi]);

  return { loading, error };
}

// ─── Toggle Button Component ─────────────────────────────────────────────────

interface YoYToggleButtonProps {
  enabled: boolean;
  onToggle: () => void;
  loading?: boolean;
}

/**
 * Small toggle button for enabling/disabling the Year-over-Year overlay.
 * Uses the CalendarRange icon from lucide-react.
 * Shows an accent color highlight when active.
 */
export function YoYToggleButton({ enabled, onToggle, loading = false }: YoYToggleButtonProps) {
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      className={`
        flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium
        transition-colors
        ${
          enabled
            ? 'bg-accent/20 text-accent border border-accent/30'
            : 'text-txt-secondary hover:text-txt-primary bg-dark-700 border border-border/20'
        }
        ${loading ? 'opacity-50 cursor-wait' : ''}
      `}
      title="Vorjahresvergleich (YoY)"
    >
      <CalendarRange className="w-3.5 h-3.5" />
      <span>YoY</span>
    </button>
  );
}

export default YoYToggleButton;
