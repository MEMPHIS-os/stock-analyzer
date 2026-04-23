import type { OHLCVData } from './types';

export function calculateSMA(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j];
    }
    result.push(sum / period);
  }
  return result;
}

export function calculateEMA(data: number[], period: number): number[] {
  if (data.length < period) return [];

  const multiplier = 2 / (period + 1);
  const result: number[] = [];

  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result.push(sum / period);

  for (let i = period; i < data.length; i++) {
    const ema = data[i] * multiplier + result[result.length - 1] * (1 - multiplier);
    result.push(ema);
  }

  return result;
  // Length: data.length - period + 1
  // result[i] corresponds to data[period - 1 + i]
}

export function calculateRSI(data: number[], period: number = 14): number[] {
  if (data.length < period + 1) return [];

  const result: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  let rs = avgGain / (avgLoss || 1e-10);
  result.push(100 - 100 / (1 + rs));

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    rs = avgGain / (avgLoss || 1e-10);
    result.push(100 - 100 / (1 + rs));
  }

  return result;
  // Length: data.length - period
  // result[i] corresponds to data[period + i]
}

export function calculateMACD(
  data: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number[]; signal: number[]; histogram: number[]; startIndex: number } {
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);

  if (!fastEMA.length || !slowEMA.length) {
    return { macd: [], signal: [], histogram: [], startIndex: 0 };
  }

  const offset = slowPeriod - fastPeriod;
  const macdLine: number[] = [];

  for (let i = 0; i < slowEMA.length; i++) {
    macdLine.push(fastEMA[i + offset] - slowEMA[i]);
  }

  const signalLine = calculateEMA(macdLine, signalPeriod);
  const signalOffset = signalPeriod - 1;

  const macdAligned = macdLine.slice(signalOffset);
  const histogram: number[] = [];
  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(macdAligned[i] - signalLine[i]);
  }

  const startIndex = slowPeriod + signalPeriod - 2;

  return { macd: macdAligned, signal: signalLine, histogram, startIndex };
}

export function calculateBollingerBands(
  data: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calculateSMA(data, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < middle.length; i++) {
    const slice = data.slice(i, i + period);
    const mean = middle[i];
    let variance = 0;
    for (let j = 0; j < slice.length; j++) {
      variance += (slice[j] - mean) ** 2;
    }
    variance /= period;
    const sd = Math.sqrt(variance);
    upper.push(mean + stdDevMultiplier * sd);
    lower.push(mean - stdDevMultiplier * sd);
  }

  return { upper, middle, lower };
  // Length: data.length - period + 1
  // result[i] corresponds to data[period - 1 + i]
}

// ─── Heikin Ashi ───

export function calculateHeikinAshi(data: OHLCVData[]): OHLCVData[] {
  if (!data.length) return [];
  const result: OHLCVData[] = [];

  const first = data[0];
  const haClose0 = (first.open + first.high + first.low + first.close) / 4;
  const haOpen0 = (first.open + first.close) / 2;
  result.push({
    date: first.date,
    open: haOpen0,
    high: Math.max(first.high, haOpen0, haClose0),
    low: Math.min(first.low, haOpen0, haClose0),
    close: haClose0,
    volume: first.volume,
  });

  for (let i = 1; i < data.length; i++) {
    const d = data[i];
    const prev = result[i - 1];
    const haClose = (d.open + d.high + d.low + d.close) / 4;
    const haOpen = (prev.open + prev.close) / 2;
    result.push({
      date: d.date,
      open: haOpen,
      high: Math.max(d.high, haOpen, haClose),
      low: Math.min(d.low, haOpen, haClose),
      close: haClose,
      volume: d.volume,
    });
  }
  return result;
}

// ─── Stochastic Oscillator ───

export function calculateStochastic(
  data: OHLCVData[],
  kPeriod: number = 14,
  dPeriod: number = 3
): { k: number[]; d: number[]; startIndex: number } {
  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < data.length; i++) {
    let highMax = -Infinity;
    let lowMin = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      highMax = Math.max(highMax, data[j].high);
      lowMin = Math.min(lowMin, data[j].low);
    }
    const range = highMax - lowMin || 1e-10;
    kValues.push(((data[i].close - lowMin) / range) * 100);
  }

  const d = calculateSMA(kValues, dPeriod);
  const kAligned = kValues.slice(dPeriod - 1);
  return { k: kAligned, d, startIndex: kPeriod + dPeriod - 2 };
}

// ─── ATR (Average True Range) ───

export function calculateATR(data: OHLCVData[], period: number = 14): { values: number[]; startIndex: number } {
  if (data.length < period + 1) return { values: [], startIndex: 0 };

  const trValues: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close)
    );
    trValues.push(tr);
  }

  let atr = 0;
  for (let i = 0; i < period; i++) atr += trValues[i];
  atr /= period;

  const result = [atr];
  for (let i = period; i < trValues.length; i++) {
    atr = (atr * (period - 1) + trValues[i]) / period;
    result.push(atr);
  }

  return { values: result, startIndex: period };
  // result[i] corresponds to data[period + i]
}

// ─── VWAP (Volume Weighted Average Price) ───

export function calculateVWAP(data: OHLCVData[]): number[] {
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  return data.map((d) => {
    const typicalPrice = (d.high + d.low + d.close) / 3;
    cumulativeTPV += typicalPrice * d.volume;
    cumulativeVolume += d.volume;
    return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : typicalPrice;
  });
}

// ─── Williams %R ───

export function calculateWilliamsR(
  data: OHLCVData[],
  period: number = 14
): { values: number[]; startIndex: number } {
  const result: number[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let highMax = -Infinity;
    let lowMin = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      highMax = Math.max(highMax, data[j].high);
      lowMin = Math.min(lowMin, data[j].low);
    }
    const range = highMax - lowMin || 1e-10;
    result.push(((highMax - data[i].close) / range) * -100);
  }
  return { values: result, startIndex: period - 1 };
  // result[i] corresponds to data[period - 1 + i]
}

// ─── Ichimoku Cloud ───

export interface IchimokuResult {
  tenkan: number[];     // Conversion Line (9-period)
  kijun: number[];      // Base Line (26-period)
  senkouA: number[];    // Leading Span A
  senkouB: number[];    // Leading Span B
  chikou: number[];     // Lagging Span
  tenkanStart: number;
  kijunStart: number;
  senkouStart: number;  // offset into data array for senkou lines
  chikouStart: number;
}

export function calculateIchimoku(
  data: OHLCVData[],
  tenkanPeriod: number = 9,
  kijunPeriod: number = 26,
  senkouBPeriod: number = 52,
  displacement: number = 26
): IchimokuResult {
  // Helper: highest high and lowest low over period ending at index i
  function midpoint(endIndex: number, period: number): number | null {
    if (endIndex < period - 1) return null;
    let hh = -Infinity, ll = Infinity;
    for (let j = endIndex - period + 1; j <= endIndex; j++) {
      hh = Math.max(hh, data[j].high);
      ll = Math.min(ll, data[j].low);
    }
    return (hh + ll) / 2;
  }

  const tenkan: number[] = [];
  const kijun: number[] = [];
  const senkouA: number[] = [];
  const senkouB: number[] = [];
  const chikou: number[] = [];

  // Tenkan-sen (Conversion Line): (9-period high + 9-period low) / 2
  for (let i = tenkanPeriod - 1; i < data.length; i++) {
    tenkan.push(midpoint(i, tenkanPeriod)!);
  }

  // Kijun-sen (Base Line): (26-period high + 26-period low) / 2
  for (let i = kijunPeriod - 1; i < data.length; i++) {
    kijun.push(midpoint(i, kijunPeriod)!);
  }

  // Senkou Span A: (Tenkan + Kijun) / 2, plotted 26 periods ahead
  // Both tenkan and kijun must be available
  const senkouAOffset = kijunPeriod - tenkanPeriod; // tenkan starts earlier
  for (let i = 0; i < kijun.length; i++) {
    const t = tenkan[i + senkouAOffset];
    const k = kijun[i];
    if (t != null && k != null) {
      senkouA.push((t + k) / 2);
    }
  }

  // Senkou Span B: (52-period high + 52-period low) / 2, plotted 26 periods ahead
  for (let i = senkouBPeriod - 1; i < data.length; i++) {
    senkouB.push(midpoint(i, senkouBPeriod)!);
  }

  // Chikou Span: Current close plotted 26 periods back (just the close values)
  for (let i = 0; i < data.length; i++) {
    chikou.push(data[i].close);
  }

  return {
    tenkan,
    kijun,
    senkouA,
    senkouB,
    chikou,
    tenkanStart: tenkanPeriod - 1,
    kijunStart: kijunPeriod - 1,
    senkouStart: kijunPeriod - 1, // senkou A starts where kijun starts
    chikouStart: 0,
  };
}

/**
 * Calculate classic Pivot Points from the most recent completed period.
 * Uses the last bar's High, Low, Close to compute PP, S1-S3, R1-R3.
 */
export function calculatePivotPoints(data: OHLCVData[]): {
  pp: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number;
} | null {
  if (data.length < 2) return null;
  // Use the second-to-last bar (most recent completed period)
  const bar = data[data.length - 2];
  const h = bar.high;
  const l = bar.low;
  const c = bar.close;
  const pp = (h + l + c) / 3;
  return {
    pp,
    r1: 2 * pp - l,
    r2: pp + (h - l),
    r3: h + 2 * (pp - l),
    s1: 2 * pp - h,
    s2: pp - (h - l),
    s3: l - 2 * (h - pp),
  };
}
