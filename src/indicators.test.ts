import { describe, it, expect } from 'vitest';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateHeikinAshi,
  calculateStochastic,
  calculateATR,
  calculateVWAP,
  calculateWilliamsR,
  calculatePivotPoints,
} from './indicators';
import type { OHLCVData } from './types';

// ─── Helpers ───

/** Build a synthetic OHLCV series from a list of closes (high/low padded around close). */
function bars(closes: number[]): OHLCVData[] {
  return closes.map((c, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: c - 0.5,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 1000 + i,
  }));
}

describe('calculateSMA', () => {
  it('averages over the window and has length n - period + 1', () => {
    const data = [1, 2, 3, 4, 5];
    const sma = calculateSMA(data, 3);
    expect(sma).toHaveLength(3);
    expect(sma).toEqual([2, 3, 4]); // (1+2+3)/3, (2+3+4)/3, (3+4+5)/3
  });

  it('returns an empty array when data is shorter than the period', () => {
    expect(calculateSMA([1, 2], 5)).toEqual([]);
  });
});

describe('calculateEMA', () => {
  it('seeds with the SMA of the first period and has length n - period + 1', () => {
    const data = [1, 2, 3, 4, 5];
    const ema = calculateEMA(data, 3);
    expect(ema).toHaveLength(3);
    // First value is the SMA seed = (1+2+3)/3 = 2
    expect(ema[0]).toBeCloseTo(2, 10);
    // multiplier = 2/(3+1) = 0.5 -> next = 4*0.5 + 2*0.5 = 3
    expect(ema[1]).toBeCloseTo(3, 10);
    expect(ema[2]).toBeCloseTo(4, 10);
  });

  it('returns an empty array when data is shorter than the period', () => {
    expect(calculateEMA([1, 2], 5)).toEqual([]);
  });
});

describe('calculateRSI', () => {
  it('returns 100 for a strictly rising series (no losses)', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const rsi = calculateRSI(data, 14);
    expect(rsi.length).toBeGreaterThan(0);
    for (const v of rsi) expect(v).toBeCloseTo(100, 5);
  });

  it('stays within [0, 100] and has length n - period', () => {
    const data = [44, 44.3, 44.1, 43.6, 44.3, 44.8, 45.1, 45.4, 45.4, 45.9, 46.1, 45.9, 46.2, 46.3, 46.8, 46.5];
    const rsi = calculateRSI(data, 14);
    expect(rsi).toHaveLength(data.length - 14);
    for (const v of rsi) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('returns an empty array when there is not enough data', () => {
    expect(calculateRSI([1, 2, 3], 14)).toEqual([]);
  });
});

describe('calculateMACD', () => {
  it('produces aligned macd/signal/histogram of equal length', () => {
    const data = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const { macd, signal, histogram, startIndex } = calculateMACD(data, 12, 26, 9);
    expect(macd.length).toBe(signal.length);
    expect(histogram.length).toBe(signal.length);
    expect(macd.length).toBeGreaterThan(0);
    // histogram = macd - signal, element-wise
    for (let i = 0; i < histogram.length; i++) {
      expect(histogram[i]).toBeCloseTo(macd[i] - signal[i], 8);
    }
    // startIndex documented as slowPeriod + signalPeriod - 2
    expect(startIndex).toBe(26 + 9 - 2);
  });

  it('returns empty structure when data is too short', () => {
    const r = calculateMACD([1, 2, 3], 12, 26, 9);
    expect(r.macd).toEqual([]);
    expect(r.signal).toEqual([]);
  });
});

describe('calculateBollingerBands', () => {
  it('keeps lower <= middle <= upper and middle equals the SMA', () => {
    const data = [10, 12, 11, 13, 14, 12, 15, 16, 14, 13, 12, 11, 15, 17, 16, 14, 13, 12, 11, 18, 19, 20];
    const period = 20;
    const { upper, middle, lower } = calculateBollingerBands(data, period, 2);
    expect(middle).toHaveLength(data.length - period + 1);
    expect(middle).toEqual(calculateSMA(data, period));
    for (let i = 0; i < middle.length; i++) {
      expect(lower[i]).toBeLessThanOrEqual(middle[i]);
      expect(upper[i]).toBeGreaterThanOrEqual(middle[i]);
      // Symmetric around the mean
      expect(upper[i] - middle[i]).toBeCloseTo(middle[i] - lower[i], 8);
    }
  });
});

describe('calculateATR', () => {
  it('is non-negative and starts after `period` bars', () => {
    const data = bars([10, 11, 12, 11, 13, 14, 12, 15, 16, 14, 13, 12, 15, 17, 16, 18]);
    const { values, startIndex } = calculateATR(data, 14);
    expect(startIndex).toBe(14);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('returns empty when there are not enough bars', () => {
    expect(calculateATR(bars([1, 2, 3]), 14).values).toEqual([]);
  });
});

describe('calculateStochastic', () => {
  it('keeps %K within [0, 100]', () => {
    const data = bars([10, 11, 12, 11, 13, 14, 12, 15, 16, 14, 13, 12, 15, 17, 16, 18, 19, 20]);
    const { k, d } = calculateStochastic(data, 14, 3);
    expect(k.length).toBeGreaterThan(0);
    expect(d.length).toBeGreaterThan(0);
    for (const v of k) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('calculateWilliamsR', () => {
  it('stays within [-100, 0]', () => {
    const data = bars([10, 11, 12, 11, 13, 14, 12, 15, 16, 14, 13, 12, 15, 17, 16, 18]);
    const { values } = calculateWilliamsR(data, 14);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(-100);
      expect(v).toBeLessThanOrEqual(0);
    }
  });
});

describe('calculateVWAP', () => {
  it('returns one value per bar and equals the typical price on the first bar', () => {
    const data = bars([10, 12, 11, 13]);
    const vwap = calculateVWAP(data);
    expect(vwap).toHaveLength(data.length);
    const tp0 = (data[0].high + data[0].low + data[0].close) / 3;
    expect(vwap[0]).toBeCloseTo(tp0, 8);
  });
});

describe('calculateHeikinAshi', () => {
  it('computes the first HA candle from the seed formula', () => {
    const data = bars([10, 11, 12]);
    const ha = calculateHeikinAshi(data);
    expect(ha).toHaveLength(3);
    const f = data[0];
    const haClose0 = (f.open + f.high + f.low + f.close) / 4;
    const haOpen0 = (f.open + f.close) / 2;
    expect(ha[0].close).toBeCloseTo(haClose0, 8);
    expect(ha[0].open).toBeCloseTo(haOpen0, 8);
    // HA high/low must envelope the HA open & close
    expect(ha[0].high).toBeGreaterThanOrEqual(Math.max(ha[0].open, ha[0].close));
    expect(ha[0].low).toBeLessThanOrEqual(Math.min(ha[0].open, ha[0].close));
  });

  it('returns an empty array for empty input', () => {
    expect(calculateHeikinAshi([])).toEqual([]);
  });
});

describe('calculatePivotPoints', () => {
  it('computes classic pivot levels from the second-to-last bar', () => {
    // last completed bar = index data.length - 2
    const data = bars([10, 20, 999]); // second-to-last close = 20 (h=21, l=19)
    const p = calculatePivotPoints(data)!;
    const h = 21, l = 19, c = 20;
    const pp = (h + l + c) / 3;
    expect(p.pp).toBeCloseTo(pp, 8);
    expect(p.r1).toBeCloseTo(2 * pp - l, 8);
    expect(p.s1).toBeCloseTo(2 * pp - h, 8);
    // Resistances above pivot, supports below
    expect(p.r1).toBeGreaterThan(p.pp);
    expect(p.s1).toBeLessThan(p.pp);
    expect(p.r2).toBeGreaterThan(p.r1 - 1e-9);
    expect(p.s2).toBeLessThan(p.s1 + 1e-9);
  });

  it('returns null with fewer than 2 bars', () => {
    expect(calculatePivotPoints(bars([1]))).toBeNull();
  });
});
