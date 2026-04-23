import type { SeriesMarker, Time } from 'lightweight-charts';
import { formatPrice } from '../formatters';

/**
 * Represents a single quarter from the Yahoo Finance earnings data.
 * The `date` field uses the format "NQ YYYY" (e.g. "4Q2023", "1Q2024").
 */
export interface EarningsQuarter {
  date: string;
  actual: number;
  estimate: number;
}

/**
 * Quarter-number to approximate end-of-quarter month/day mapping.
 * Q1 -> March 31, Q2 -> June 30, Q3 -> September 30, Q4 -> December 31.
 */
const QUARTER_END: Record<number, string> = {
  1: '03-31',
  2: '06-30',
  3: '09-30',
  4: '12-31',
};

/**
 * Parses a Yahoo Finance quarterly date string like "1Q2024" or "4Q2023"
 * into an approximate ISO date string "YYYY-MM-DD" representing the end
 * of that fiscal quarter.
 *
 * Returns `null` if the string cannot be parsed.
 */
function parseQuarterDate(dateStr: string): string | null {
  const match = dateStr.match(/^(\d)Q(\d{4})$/);
  if (!match) return null;

  const quarter = parseInt(match[1], 10);
  const year = match[2];

  const monthDay = QUARTER_END[quarter];
  if (!monthDay) return null;

  return `${year}-${monthDay}`;
}

/**
 * Builds an array of lightweight-charts `SeriesMarker` objects from
 * Yahoo Finance quarterly earnings data.
 *
 * Marker appearance indicates the earnings outcome:
 * - Beat (actual > estimate): green arrow-up below the bar
 * - Miss (actual < estimate): red arrow-down above the bar
 * - Match (actual === estimate): yellow circle on the bar
 *
 * The returned array is sorted ascending by time, as required by
 * `ISeriesApi.setMarkers()`.
 */
export function buildEarningsMarkers(
  quarters: EarningsQuarter[],
  locale: 'de' | 'en' = 'en',
  currency: string = 'USD'
): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];

  for (const q of quarters) {
    const dateStr = parseQuarterDate(q.date);
    if (!dateStr) continue;

    const text = `E: ${formatPrice(q.actual, currency, locale)} vs ${formatPrice(q.estimate, currency, locale)}`;

    let marker: SeriesMarker<Time>;

    if (q.actual > q.estimate) {
      // Earnings beat
      marker = {
        time: dateStr as Time,
        position: 'belowBar',
        shape: 'arrowUp',
        color: '#22c55e',
        text,
      };
    } else if (q.actual < q.estimate) {
      // Earnings miss
      marker = {
        time: dateStr as Time,
        position: 'aboveBar',
        shape: 'arrowDown',
        color: '#ef4444',
        text,
      };
    } else {
      // Earnings match
      marker = {
        time: dateStr as Time,
        position: 'inBar',
        shape: 'circle',
        color: '#eab308',
        text,
      };
    }

    markers.push(marker);
  }

  // lightweight-charts requires markers to be sorted by time ascending
  markers.sort((a, b) => {
    if (a.time < b.time) return -1;
    if (a.time > b.time) return 1;
    return 0;
  });

  return markers;
}
