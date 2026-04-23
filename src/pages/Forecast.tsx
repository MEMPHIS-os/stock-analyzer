import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  Activity,
  BarChart3,
  Shield,
  Gauge,
  Search,
  ChevronDown,
  ChevronUp,
  Info,
  GitBranchPlus,
  Layers,
} from 'lucide-react';
import { fetchChart, fetchQuote, fetchFundamentals, searchSymbols } from '../api';
import { useApp } from '../context';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateStochastic,
  calculateWilliamsR,
  calculateIchimoku,
} from '../indicators';
import { formatPercent } from '../formatters';
import { usePrice } from '../hooks/usePrice';
import LoadingSpinner from '../components/LoadingSpinner';
import type { OHLCVData, QuoteData, FundamentalsData } from '../types';

// ─── Forecast calculation utilities ───

interface ForecastResult {
  currentPrice: number;
  // Linear regression
  trendDirection: 'up' | 'down' | 'sideways';
  trendStrength: number; // 0-100
  regressionSlope: number;
  projected7d: number;
  projected30d: number;
  projected90d: number;
  // Volatility
  dailyVolatility: number;
  annualizedVolatility: number;
  // Support & Resistance
  supportLevels: number[];
  resistanceLevels: number[];
  // Monte Carlo
  monteCarlo: {
    median7d: number;
    median30d: number;
    median90d: number;
    upper7d: number;   // 90th percentile
    upper30d: number;
    upper90d: number;
    lower7d: number;   // 10th percentile
    lower30d: number;
    lower90d: number;
  };
  // Technical score
  technicalScore: number; // -100 to +100
  signals: SignalDetail[];
  // Analyst targets
  analystHigh?: number;
  analystLow?: number;
  analystMean?: number;
  analystCount?: number;
  recommendation?: string;
  // Divergences & Patterns
  divergences: DivergenceResult[];
  patterns: PatternResult[];
}

interface SignalDetail {
  name: string;
  value: string;
  signal: 'bullish' | 'bearish' | 'neutral';
  weight: number;
}

function linearRegression(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
    sumYY += values[i] * values[i];
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const ssRes = values.reduce((sum, y, i) => sum + (y - (intercept + slope * i)) ** 2, 0);
  const ssTot = values.reduce((sum, y) => sum + (y - sumY / n) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { slope, intercept, r2 };
}

function calculateHistoricalVolatility(closes: number[]): number {
  if (closes.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

function findSupportResistance(data: OHLCVData[]): { supports: number[]; resistances: number[] } {
  if (data.length < 20) return { supports: [], resistances: [] };

  const pivots: { price: number; type: 'high' | 'low' }[] = [];
  const window = 5;

  for (let i = window; i < data.length - window; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (data[j].high >= data[i].high) isHigh = false;
      if (data[j].low <= data[i].low) isLow = false;
    }
    if (isHigh) pivots.push({ price: data[i].high, type: 'high' });
    if (isLow) pivots.push({ price: data[i].low, type: 'low' });
  }

  const currentPrice = data[data.length - 1].close;

  // Cluster nearby levels (within 1.5%)
  function clusterLevels(prices: number[]): number[] {
    if (!prices.length) return [];
    prices.sort((a, b) => a - b);
    const clusters: number[][] = [[prices[0]]];
    for (let i = 1; i < prices.length; i++) {
      const last = clusters[clusters.length - 1];
      const avg = last.reduce((s, v) => s + v, 0) / last.length;
      if (Math.abs(prices[i] - avg) / avg < 0.015) {
        last.push(prices[i]);
      } else {
        clusters.push([prices[i]]);
      }
    }
    return clusters
      .filter(c => c.length >= 2) // Only levels touched multiple times
      .map(c => c.reduce((s, v) => s + v, 0) / c.length);
  }

  const supports = clusterLevels(
    pivots.filter(p => p.type === 'low' && p.price < currentPrice).map(p => p.price)
  ).slice(-3);

  const resistances = clusterLevels(
    pivots.filter(p => p.type === 'high' && p.price > currentPrice).map(p => p.price)
  ).slice(0, 3);

  return { supports, resistances };
}

function runMonteCarlo(
  currentPrice: number,
  dailyVol: number,
  dailyDrift: number,
  days: number,
  simulations: number = 1000
): { median: number; upper: number; lower: number } {
  const results: number[] = [];

  for (let sim = 0; sim < simulations; sim++) {
    let price = currentPrice;
    for (let d = 0; d < days; d++) {
      // Box-Muller transform for normal distribution
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      price *= Math.exp(dailyDrift + dailyVol * z);
    }
    results.push(price);
  }

  results.sort((a, b) => a - b);
  const p10 = results[Math.floor(simulations * 0.1)];
  const p50 = results[Math.floor(simulations * 0.5)];
  const p90 = results[Math.floor(simulations * 0.9)];

  return { median: p50, upper: p90, lower: p10 };
}

interface DivergenceResult {
  type: 'bullish' | 'bearish';
  indicator: 'RSI' | 'MACD';
  description: string;
}

function detectDivergences(closes: number[], data: OHLCVData[]): DivergenceResult[] {
  const results: DivergenceResult[] = [];
  const window = 5; // local min/max detection window

  // Find local pivots in price
  function findPivots(values: number[], minDist: number = 10) {
    const highs: { index: number; value: number }[] = [];
    const lows: { index: number; value: number }[] = [];

    for (let i = window; i < values.length - window; i++) {
      let isHigh = true, isLow = true;
      for (let j = i - window; j <= i + window; j++) {
        if (j === i) continue;
        if (values[j] >= values[i]) isHigh = false;
        if (values[j] <= values[i]) isLow = false;
      }
      if (isHigh) highs.push({ index: i, value: values[i] });
      if (isLow) lows.push({ index: i, value: values[i] });
    }
    return { highs, lows };
  }

  // RSI Divergence
  const rsiValues = calculateRSI(closes, 14);
  if (rsiValues.length > 30) {
    const rsiOffset = 14; // RSI starts at index 14
    const recentCloses = closes.slice(-60);
    const recentRSI = rsiValues.slice(-60);

    const pricePivots = findPivots(recentCloses);
    const rsiPivots = findPivots(recentRSI);

    // Bullish divergence: price makes lower low, RSI makes higher low
    if (pricePivots.lows.length >= 2 && rsiPivots.lows.length >= 2) {
      const pLow1 = pricePivots.lows[pricePivots.lows.length - 2];
      const pLow2 = pricePivots.lows[pricePivots.lows.length - 1];
      const rLow1 = rsiPivots.lows[rsiPivots.lows.length - 2];
      const rLow2 = rsiPivots.lows[rsiPivots.lows.length - 1];

      if (pLow2.value < pLow1.value && rLow2.value > rLow1.value) {
        results.push({
          type: 'bullish',
          indicator: 'RSI',
          description: 'Preis bildet tieferes Tief, RSI bildet h\u00f6heres Tief \u2192 Bullische Divergenz',
        });
      }
    }

    // Bearish divergence: price makes higher high, RSI makes lower high
    if (pricePivots.highs.length >= 2 && rsiPivots.highs.length >= 2) {
      const pH1 = pricePivots.highs[pricePivots.highs.length - 2];
      const pH2 = pricePivots.highs[pricePivots.highs.length - 1];
      const rH1 = rsiPivots.highs[rsiPivots.highs.length - 2];
      const rH2 = rsiPivots.highs[rsiPivots.highs.length - 1];

      if (pH2.value > pH1.value && rH2.value < rH1.value) {
        results.push({
          type: 'bearish',
          indicator: 'RSI',
          description: 'Preis bildet h\u00f6heres Hoch, RSI bildet tieferes Hoch \u2192 B\u00e4rische Divergenz',
        });
      }
    }
  }

  // MACD Divergence
  const { histogram } = calculateMACD(closes);
  if (histogram.length > 30) {
    const recentCloses = closes.slice(-60);
    const recentHist = histogram.slice(-60);

    const pricePivots = findPivots(recentCloses);
    const macdPivots = findPivots(recentHist);

    // Bullish: price lower low + MACD histogram higher low
    if (pricePivots.lows.length >= 2 && macdPivots.lows.length >= 2) {
      const pL1 = pricePivots.lows[pricePivots.lows.length - 2];
      const pL2 = pricePivots.lows[pricePivots.lows.length - 1];
      const mL1 = macdPivots.lows[macdPivots.lows.length - 2];
      const mL2 = macdPivots.lows[macdPivots.lows.length - 1];

      if (pL2.value < pL1.value && mL2.value > mL1.value) {
        results.push({
          type: 'bullish',
          indicator: 'MACD',
          description: 'Preis bildet tieferes Tief, MACD-Histogramm bildet h\u00f6heres Tief \u2192 Bullische Divergenz',
        });
      }
    }

    // Bearish: price higher high + MACD histogram lower high
    if (pricePivots.highs.length >= 2 && macdPivots.highs.length >= 2) {
      const pH1 = pricePivots.highs[pricePivots.highs.length - 2];
      const pH2 = pricePivots.highs[pricePivots.highs.length - 1];
      const mH1 = macdPivots.highs[macdPivots.highs.length - 2];
      const mH2 = macdPivots.highs[macdPivots.highs.length - 1];

      if (pH2.value > pH1.value && mH2.value < mH1.value) {
        results.push({
          type: 'bearish',
          indicator: 'MACD',
          description: 'Preis bildet h\u00f6heres Hoch, MACD-Histogramm bildet tieferes Hoch \u2192 B\u00e4rische Divergenz',
        });
      }
    }
  }

  return results;
}

interface PatternResult {
  name: string;
  type: 'bullish' | 'bearish' | 'neutral';
  confidence: number; // 0-100
  description: string;
}

function detectChartPatterns(data: OHLCVData[]): PatternResult[] {
  const patterns: PatternResult[] = [];
  if (data.length < 30) return patterns;

  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  const recent = data.slice(-60);
  const recentCloses = closes.slice(-60);
  const recentHighs = highs.slice(-60);
  const recentLows = lows.slice(-60);

  // Helper: find local pivots
  function findPeaks(values: number[], w: number = 5): { index: number; value: number }[] {
    const peaks: { index: number; value: number }[] = [];
    for (let i = w; i < values.length - w; i++) {
      let isPeak = true;
      for (let j = i - w; j <= i + w; j++) {
        if (j !== i && values[j] >= values[i]) { isPeak = false; break; }
      }
      if (isPeak) peaks.push({ index: i, value: values[i] });
    }
    return peaks;
  }

  function findTroughs(values: number[], w: number = 5): { index: number; value: number }[] {
    const troughs: { index: number; value: number }[] = [];
    for (let i = w; i < values.length - w; i++) {
      let isTrough = true;
      for (let j = i - w; j <= i + w; j++) {
        if (j !== i && values[j] <= values[i]) { isTrough = false; break; }
      }
      if (isTrough) troughs.push({ index: i, value: values[i] });
    }
    return troughs;
  }

  const peaks = findPeaks(recentHighs);
  const troughs = findTroughs(recentLows);

  // Double Top: two peaks at similar level with a trough between
  if (peaks.length >= 2) {
    const p1 = peaks[peaks.length - 2];
    const p2 = peaks[peaks.length - 1];
    const tolerance = Math.abs(p1.value) * 0.02; // 2% tolerance

    if (Math.abs(p1.value - p2.value) < tolerance && p2.index - p1.index >= 8) {
      // Find trough between peaks
      const midTroughs = troughs.filter(t => t.index > p1.index && t.index < p2.index);
      if (midTroughs.length > 0) {
        const neckline = Math.min(...midTroughs.map(t => t.value));
        const lastClose = recentCloses[recentCloses.length - 1];
        const conf = lastClose < neckline ? 85 : 60;
        patterns.push({
          name: 'Double Top',
          type: 'bearish',
          confidence: conf,
          description: `Doppeltop bei ${p1.value.toFixed(2)} erkannt. Nackenlinie bei ${neckline.toFixed(2)}.`,
        });
      }
    }
  }

  // Double Bottom: two troughs at similar level with a peak between
  if (troughs.length >= 2) {
    const t1 = troughs[troughs.length - 2];
    const t2 = troughs[troughs.length - 1];
    const tolerance = Math.abs(t1.value) * 0.02;

    if (Math.abs(t1.value - t2.value) < tolerance && t2.index - t1.index >= 8) {
      const midPeaks = peaks.filter(p => p.index > t1.index && p.index < t2.index);
      if (midPeaks.length > 0) {
        const neckline = Math.max(...midPeaks.map(p => p.value));
        const lastClose = recentCloses[recentCloses.length - 1];
        const conf = lastClose > neckline ? 85 : 60;
        patterns.push({
          name: 'Double Bottom',
          type: 'bullish',
          confidence: conf,
          description: `Doppelboden bei ${t1.value.toFixed(2)} erkannt. Nackenlinie bei ${neckline.toFixed(2)}.`,
        });
      }
    }
  }

  // Head and Shoulders
  if (peaks.length >= 3 && troughs.length >= 2) {
    const p1 = peaks[peaks.length - 3]; // left shoulder
    const p2 = peaks[peaks.length - 2]; // head
    const p3 = peaks[peaks.length - 1]; // right shoulder

    // Head must be highest
    if (p2.value > p1.value && p2.value > p3.value) {
      // Shoulders should be at similar level (within 5%)
      const shoulderTolerance = p2.value * 0.05;
      if (Math.abs(p1.value - p3.value) < shoulderTolerance) {
        patterns.push({
          name: 'Head & Shoulders',
          type: 'bearish',
          confidence: 70,
          description: `Kopf-Schulter-Formation erkannt. Kopf bei ${p2.value.toFixed(2)}, Schultern bei ~${((p1.value + p3.value) / 2).toFixed(2)}.`,
        });
      }
    }
  }

  // Inverse Head and Shoulders
  if (troughs.length >= 3 && peaks.length >= 2) {
    const t1 = troughs[troughs.length - 3];
    const t2 = troughs[troughs.length - 2]; // head (lowest)
    const t3 = troughs[troughs.length - 1];

    if (t2.value < t1.value && t2.value < t3.value) {
      const shoulderTolerance = Math.abs(t2.value) * 0.05;
      if (Math.abs(t1.value - t3.value) < shoulderTolerance) {
        patterns.push({
          name: 'Inv. Head & Shoulders',
          type: 'bullish',
          confidence: 70,
          description: `Inverse Kopf-Schulter-Formation erkannt. Kopf bei ${t2.value.toFixed(2)}, Schultern bei ~${((t1.value + t3.value) / 2).toFixed(2)}.`,
        });
      }
    }
  }

  // Ascending Triangle: flat top (resistance) + rising lows
  if (peaks.length >= 2 && troughs.length >= 2) {
    const recentPeaks = peaks.slice(-3);
    const recentTroughs = troughs.slice(-3);

    const peakValues = recentPeaks.map(p => p.value);
    const troughValues = recentTroughs.map(t => t.value);

    const peakRange = Math.max(...peakValues) - Math.min(...peakValues);
    const avgPeak = peakValues.reduce((s, v) => s + v, 0) / peakValues.length;

    // Flat resistance (peaks within 1.5% of each other) + rising lows
    if (peakRange / avgPeak < 0.015 && troughValues.length >= 2) {
      let risingLows = true;
      for (let i = 1; i < troughValues.length; i++) {
        if (troughValues[i] <= troughValues[i - 1]) { risingLows = false; break; }
      }
      if (risingLows) {
        patterns.push({
          name: 'Ascending Triangle',
          type: 'bullish',
          confidence: 65,
          description: `Aufsteigendes Dreieck: Widerstand bei ~${avgPeak.toFixed(2)} mit steigenden Tiefs.`,
        });
      }
    }

    // Descending Triangle: flat bottom + falling highs
    const troughRange = Math.max(...troughValues) - Math.min(...troughValues);
    const avgTrough = troughValues.reduce((s, v) => s + v, 0) / troughValues.length;

    if (troughRange / avgTrough < 0.015 && peakValues.length >= 2) {
      let fallingHighs = true;
      for (let i = 1; i < peakValues.length; i++) {
        if (peakValues[i] >= peakValues[i - 1]) { fallingHighs = false; break; }
      }
      if (fallingHighs) {
        patterns.push({
          name: 'Descending Triangle',
          type: 'bearish',
          confidence: 65,
          description: `Absteigendes Dreieck: Unterst\u00fctzung bei ~${avgTrough.toFixed(2)} mit fallenden Hochs.`,
        });
      }
    }
  }

  return patterns;
}

function computeForecast(
  data: OHLCVData[],
  quote: QuoteData,
  fundamentals: FundamentalsData | null
): ForecastResult {
  const closes = data.map(d => d.close);
  const currentPrice = closes[closes.length - 1];

  // 1. Linear Regression (last 60 days)
  const regWindow = Math.min(60, closes.length);
  const recentCloses = closes.slice(-regWindow);
  const { slope, r2 } = linearRegression(recentCloses);

  const trendDirection: 'up' | 'down' | 'sideways' =
    slope > 0.001 * currentPrice ? 'up' : slope < -0.001 * currentPrice ? 'down' : 'sideways';

  const trendStrength = Math.min(100, Math.round(r2 * 100));

  // Project forward (days from end of data)
  const projected7d = currentPrice + slope * 7;
  const projected30d = currentPrice + slope * 30;
  const projected90d = currentPrice + slope * 90;

  // 2. Volatility
  const dailyVol = calculateHistoricalVolatility(closes);
  const annualVol = dailyVol * Math.sqrt(252);

  // 3. Support & Resistance
  const { supports, resistances } = findSupportResistance(data);

  // 4. Monte Carlo
  const dailyReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    dailyReturns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const dailyDrift = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;

  const mc7 = runMonteCarlo(currentPrice, dailyVol, dailyDrift, 7);
  const mc30 = runMonteCarlo(currentPrice, dailyVol, dailyDrift, 30);
  const mc90 = runMonteCarlo(currentPrice, dailyVol, dailyDrift, 90);

  // 5. Technical Signals
  const signals: SignalDetail[] = [];

  // SMA signals
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  if (sma20.length) {
    const lastSma20 = sma20[sma20.length - 1];
    signals.push({
      name: 'SMA 20',
      value: lastSma20.toFixed(2),
      signal: currentPrice > lastSma20 ? 'bullish' : 'bearish',
      weight: 1,
    });
  }
  if (sma50.length) {
    const lastSma50 = sma50[sma50.length - 1];
    signals.push({
      name: 'SMA 50',
      value: lastSma50.toFixed(2),
      signal: currentPrice > lastSma50 ? 'bullish' : 'bearish',
      weight: 1.5,
    });
  }
  if (closes.length >= 200) {
    const sma200 = calculateSMA(closes, 200);
    const lastSma200 = sma200[sma200.length - 1];
    signals.push({
      name: 'SMA 200',
      value: lastSma200.toFixed(2),
      signal: currentPrice > lastSma200 ? 'bullish' : 'bearish',
      weight: 2,
    });
  }

  // EMA crossover
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  if (ema12.length && ema26.length) {
    const lastEma12 = ema12[ema12.length - 1];
    const lastEma26 = ema26[ema26.length - 1];
    signals.push({
      name: 'EMA 12/26',
      value: lastEma12 > lastEma26 ? 'Bullish' : 'Bearish',
      signal: lastEma12 > lastEma26 ? 'bullish' : 'bearish',
      weight: 1.5,
    });
  }

  // RSI
  const rsi = calculateRSI(closes, 14);
  if (rsi.length) {
    const lastRsi = rsi[rsi.length - 1];
    signals.push({
      name: 'RSI (14)',
      value: lastRsi.toFixed(1),
      signal: lastRsi < 30 ? 'bullish' : lastRsi > 70 ? 'bearish' : 'neutral',
      weight: 2,
    });
  }

  // MACD
  const { histogram } = calculateMACD(closes);
  if (histogram.length > 1) {
    const lastHist = histogram[histogram.length - 1];
    const prevHist = histogram[histogram.length - 2];
    signals.push({
      name: 'MACD',
      value: lastHist > 0 ? 'Bullish' : 'Bearish',
      signal: lastHist > 0 && lastHist > prevHist ? 'bullish'
        : lastHist < 0 && lastHist < prevHist ? 'bearish'
        : 'neutral',
      weight: 2,
    });
  }

  // Bollinger Bands
  const bb = calculateBollingerBands(closes, 20, 2);
  if (bb.upper.length) {
    const lastUpper = bb.upper[bb.upper.length - 1];
    const lastLower = bb.lower[bb.lower.length - 1];
    const bbPos = (currentPrice - lastLower) / (lastUpper - lastLower);
    signals.push({
      name: 'Bollinger',
      value: `${(bbPos * 100).toFixed(0)}%`,
      signal: bbPos < 0.2 ? 'bullish' : bbPos > 0.8 ? 'bearish' : 'neutral',
      weight: 1.5,
    });
  }

  // Stochastic
  if (data.length >= 17) {
    const { k } = calculateStochastic(data);
    if (k.length) {
      const lastK = k[k.length - 1];
      signals.push({
        name: 'Stochastik',
        value: lastK.toFixed(1),
        signal: lastK < 20 ? 'bullish' : lastK > 80 ? 'bearish' : 'neutral',
        weight: 1,
      });
    }
  }

  // Williams %R
  if (data.length >= 14) {
    const { values: willR } = calculateWilliamsR(data);
    if (willR.length) {
      const lastWR = willR[willR.length - 1];
      signals.push({
        name: 'Williams %R',
        value: lastWR.toFixed(1),
        signal: lastWR < -80 ? 'bullish' : lastWR > -20 ? 'bearish' : 'neutral',
        weight: 1,
      });
    }
  }

  // ATR-based volatility signal
  const atr = calculateATR(data, 14);
  if (atr.values.length) {
    const lastATR = atr.values[atr.values.length - 1];
    const atrPercent = (lastATR / currentPrice) * 100;
    signals.push({
      name: 'ATR %',
      value: `${atrPercent.toFixed(2)}%`,
      signal: atrPercent < 1.5 ? 'neutral' : atrPercent > 3 ? 'bearish' : 'neutral',
      weight: 0.5,
    });
  }

  // Ichimoku Cloud signal
  if (data.length >= 52) {
    const ichimoku = calculateIchimoku(data);
    const lastTenkan = ichimoku.tenkan[ichimoku.tenkan.length - 1];
    const lastKijun = ichimoku.kijun[ichimoku.kijun.length - 1];
    // Price above cloud = bullish, below = bearish
    const lastSenkouA = ichimoku.senkouA[ichimoku.senkouA.length - 1];
    const lastSenkouB = ichimoku.senkouB[ichimoku.senkouB.length - 1];
    const cloudTop = Math.max(lastSenkouA || 0, lastSenkouB || 0);
    const cloudBottom = Math.min(lastSenkouA || 0, lastSenkouB || 0);

    let ichimokuSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (currentPrice > cloudTop && lastTenkan > lastKijun) {
      ichimokuSignal = 'bullish';
    } else if (currentPrice < cloudBottom && lastTenkan < lastKijun) {
      ichimokuSignal = 'bearish';
    }

    signals.push({
      name: 'Ichimoku',
      value: ichimokuSignal === 'bullish' ? 'Über Wolke' : ichimokuSignal === 'bearish' ? 'Unter Wolke' : 'In Wolke',
      signal: ichimokuSignal,
      weight: 2,
    });
  }

  // Calculate weighted technical score
  let bullishWeight = 0, bearishWeight = 0, totalWeight = 0;
  signals.forEach(s => {
    totalWeight += s.weight;
    if (s.signal === 'bullish') bullishWeight += s.weight;
    else if (s.signal === 'bearish') bearishWeight += s.weight;
  });
  const technicalScore = totalWeight > 0
    ? Math.round(((bullishWeight - bearishWeight) / totalWeight) * 100)
    : 0;

  // 6. Analyst data
  const fd = fundamentals?.financialData;

  // 7. Divergences
  const divergences = detectDivergences(closes, data);

  // 8. Chart Patterns
  const patterns = detectChartPatterns(data);

  return {
    currentPrice,
    trendDirection,
    trendStrength,
    regressionSlope: slope,
    projected7d,
    projected30d,
    projected90d,
    dailyVolatility: dailyVol,
    annualizedVolatility: annualVol,
    supportLevels: supports,
    resistanceLevels: resistances,
    monteCarlo: {
      median7d: mc7.median,
      median30d: mc30.median,
      median90d: mc90.median,
      upper7d: mc7.upper,
      upper30d: mc30.upper,
      upper90d: mc90.upper,
      lower7d: mc7.lower,
      lower30d: mc30.lower,
      lower90d: mc90.lower,
    },
    technicalScore,
    signals,
    analystHigh: fd?.targetHighPrice,
    analystLow: fd?.targetLowPrice,
    analystMean: fd?.targetMeanPrice,
    analystCount: fd?.numberOfAnalystOpinions,
    recommendation: fd?.recommendationKey,
    divergences,
    patterns,
  };
}

// ─── Gauge component ───

function ScoreGauge({ score, label }: { score: number; label: string }) {
  // score: -100 to +100
  const normalizedAngle = ((score + 100) / 200) * 180 - 90; // -90 to 90 degrees
  const color = score > 30 ? 'text-success' : score < -30 ? 'text-danger' : 'text-warning';
  const bgColor = score > 30 ? 'bg-success' : score < -30 ? 'bg-danger' : 'bg-warning';
  const labelText = score > 30 ? 'Bullish' : score < -30 ? 'Bearish' : 'Neutral';

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-32 h-16 overflow-hidden">
        {/* Gauge background */}
        <div className="absolute bottom-0 left-0 right-0 h-32 w-32 rounded-full border-8 border-dark-600"
          style={{ clipPath: 'inset(0 0 50% 0)' }}
        />
        {/* Colored arc segments */}
        <svg viewBox="0 0 120 60" className="w-full h-full">
          <path d="M 10 55 A 50 50 0 0 1 43 10" fill="none" stroke="rgb(var(--danger))" strokeWidth="6" strokeLinecap="round" opacity="0.3" />
          <path d="M 43 10 A 50 50 0 0 1 77 10" fill="none" stroke="rgb(var(--warning))" strokeWidth="6" strokeLinecap="round" opacity="0.3" />
          <path d="M 77 10 A 50 50 0 0 1 110 55" fill="none" stroke="rgb(var(--success))" strokeWidth="6" strokeLinecap="round" opacity="0.3" />
          {/* Needle */}
          <line
            x1="60" y1="55"
            x2={60 + 40 * Math.cos((normalizedAngle * Math.PI) / 180)}
            y2={55 - 40 * Math.sin((normalizedAngle * Math.PI) / 180)}
            stroke="rgb(var(--accent))" strokeWidth="2.5" strokeLinecap="round"
          />
          <circle cx="60" cy="55" r="4" fill="rgb(var(--accent))" />
        </svg>
      </div>
      <div className={`text-lg font-bold ${color} mt-1`}>{labelText}</div>
      <div className="text-xs text-txt-secondary">{label}: {score > 0 ? '+' : ''}{score}</div>
    </div>
  );
}

// ─── Price Target Bar ───

function PriceTargetBar({
  current, low, high, mean, label, currency, locale,
}: {
  current: number; low: number; high: number; mean?: number;
  label: string; currency: string; locale: 'de' | 'en';
}) {
  const { fp } = usePrice();
  const range = high - low;
  if (range <= 0) return null;
  const currentPos = Math.max(0, Math.min(100, ((current - low) / range) * 100));
  const meanPos = mean ? Math.max(0, Math.min(100, ((mean - low) / range) * 100)) : null;

  return (
    <div className="space-y-1.5">
      <div className="text-xs text-txt-secondary font-medium">{label}</div>
      <div className="relative h-2 bg-dark-600 rounded-full overflow-visible">
        {/* Gradient fill */}
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-danger via-warning to-success" style={{ width: '100%', opacity: 0.3 }} />
        {/* Mean marker */}
        {meanPos !== null && (
          <div className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-accent rounded-full"
            style={{ left: `${meanPos}%` }}
          />
        )}
        {/* Current price marker */}
        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full border-2 border-accent shadow-lg"
          style={{ left: `${currentPos}%`, transform: `translate(-50%, -50%)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-txt-secondary">
        <span>{fp(low, currency)}</span>
        {mean && <span className="text-accent font-medium">{fp(mean, currency)}</span>}
        <span>{fp(high, currency)}</span>
      </div>
    </div>
  );
}

// ─── Embeddable Forecast Panel (for StockDetail tabs) ───

export function ForecastPanel({ symbol }: { symbol: string }) {
  const { locale } = useApp();
  const { fp } = usePrice();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OHLCVData[]>([]);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsData | null>(null);

  const currency = quote?.currency || 'USD';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [chartResult, quoteResult, fundResult] = await Promise.allSettled([
        fetchChart(symbol, '1y', '1d'),
        fetchQuote(symbol),
        fetchFundamentals(symbol),
      ]);
      if (chartResult.status === 'fulfilled') setData(chartResult.value.quotes);
      if (quoteResult.status === 'fulfilled') setQuote(quoteResult.value);
      if (fundResult.status === 'fulfilled') setFundamentals(fundResult.value);
    } catch {}
    setLoading(false);
  }, [symbol]);

  useEffect(() => { loadData(); }, [loadData]);

  const forecast = useMemo(() => {
    if (data.length < 50 || !quote) return null;
    return computeForecast(data, quote, fundamentals);
  }, [data, quote, fundamentals]);

  const de = locale === 'de';

  if (loading) return <LoadingSpinner text={`${de ? 'Analysiere' : 'Analyzing'} ${symbol}...`} />;

  if (!forecast) return (
    <div className="card p-8 text-center">
      <Activity className="w-12 h-12 text-txt-muted mx-auto mb-3" />
      <p className="text-txt-secondary">
        {de ? 'Nicht genug Daten für eine Prognose.' : 'Not enough data for a forecast.'}
      </p>
    </div>
  );

  return (
    <ForecastContent
      forecast={forecast}
      currency={currency}
      locale={locale}
      fp={fp}
    />
  );
}

// ─── Shared Forecast Content ───

function ForecastContent({
  forecast,
  currency,
  locale,
  fp,
}: {
  forecast: ForecastResult;
  currency: string;
  locale: 'de' | 'en';
  fp: (value: number, currency: string) => string;
}) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    overview: true,
    targets: true,
    montecarlo: true,
    levels: true,
    signals: true,
    divergences: true,
    patterns: true,
  });

  const de = locale === 'de';

  function toggleSection(key: string) {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="space-y-4">
      {/* Disclaimer */}
      <div className="flex items-start gap-2 px-3 py-2 bg-warning/10 border border-warning/20 rounded-lg">
        <Info className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <p className="text-[11px] text-warning/80">
          {de
            ? 'Diese Prognose basiert auf historischen Daten und technischen Indikatoren. Sie stellt keine Anlageberatung dar. Vergangene Performance ist kein Indikator für zukünftige Ergebnisse.'
            : 'This forecast is based on historical data and technical indicators. It does not constitute investment advice. Past performance is not indicative of future results.'}
        </p>
      </div>

      {/* Overview Cards */}
      <SectionHeader
        title={de ? 'Gesamtbewertung' : 'Overall Assessment'}
        icon={<Gauge className="w-4 h-4" />}
        expanded={expandedSections.overview}
        onToggle={() => toggleSection('overview')}
      />
      {expandedSections.overview && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-4 flex flex-col items-center justify-center">
            <ScoreGauge score={forecast.technicalScore} label={de ? 'Technischer Score' : 'Technical Score'} />
          </div>
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2">
              {forecast.trendDirection === 'up' && <TrendingUp className="w-5 h-5 text-success" />}
              {forecast.trendDirection === 'down' && <TrendingDown className="w-5 h-5 text-danger" />}
              {forecast.trendDirection === 'sideways' && <Minus className="w-5 h-5 text-warning" />}
              <span className="text-sm font-semibold text-txt-primary">
                {de ? 'Trend' : 'Trend'}: {
                  forecast.trendDirection === 'up' ? (de ? 'Aufwärts' : 'Upward')
                  : forecast.trendDirection === 'down' ? (de ? 'Abwärts' : 'Downward')
                  : (de ? 'Seitwärts' : 'Sideways')
                }
              </span>
            </div>
            <div className="space-y-2">
              <MetricRow label={de ? 'Trendstärke' : 'Trend Strength'} value={`${forecast.trendStrength}%`} />
              <MetricRow label={de ? 'Tages-Volatilität' : 'Daily Volatility'} value={`${(forecast.dailyVolatility * 100).toFixed(2)}%`} />
              <MetricRow label={de ? 'Jahres-Volatilität' : 'Annual Volatility'} value={`${(forecast.annualizedVolatility * 100).toFixed(1)}%`} />
            </div>
          </div>
          <div className="card p-4 space-y-3">
            <div className="text-sm font-semibold text-txt-primary flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-accent" />
              {de ? 'Lineare Projektion' : 'Linear Projection'}
            </div>
            <div className="space-y-2">
              <ProjectionRow label="7 Tage" value={forecast.projected7d} current={forecast.currentPrice} currency={currency} locale={locale} />
              <ProjectionRow label="30 Tage" value={forecast.projected30d} current={forecast.currentPrice} currency={currency} locale={locale} />
              <ProjectionRow label="90 Tage" value={forecast.projected90d} current={forecast.currentPrice} currency={currency} locale={locale} />
            </div>
          </div>
        </div>
      )}

      {/* Price Targets */}
      <SectionHeader
        title={de ? 'Kursziele' : 'Price Targets'}
        icon={<Target className="w-4 h-4" />}
        expanded={expandedSections.targets}
        onToggle={() => toggleSection('targets')}
      />
      {expandedSections.targets && (
        <div className="card p-4 space-y-4">
          {forecast.analystMean && forecast.analystHigh && forecast.analystLow && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-txt-primary">{de ? 'Analysten-Kursziel' : 'Analyst Price Target'}</span>
                {forecast.analystCount && (
                  <span className="text-[10px] text-txt-muted">
                    {forecast.analystCount} {de ? 'Analysten' : 'analysts'}
                    {forecast.recommendation && ` \u2022 ${forecast.recommendation.toUpperCase()}`}
                  </span>
                )}
              </div>
              <PriceTargetBar current={forecast.currentPrice} low={forecast.analystLow} high={forecast.analystHigh} mean={forecast.analystMean} label="" currency={currency} locale={locale} />
            </div>
          )}
          <div>
            <div className="text-xs font-semibold text-txt-primary mb-2">
              Monte-Carlo {de ? 'Simulation (80% Konfidenz)' : 'Simulation (80% Confidence)'}
            </div>
            <div className="space-y-3">
              <PriceTargetBar current={forecast.monteCarlo.median7d} low={forecast.monteCarlo.lower7d} high={forecast.monteCarlo.upper7d} mean={forecast.monteCarlo.median7d} label={`7 ${de ? 'Tage' : 'Days'}`} currency={currency} locale={locale} />
              <PriceTargetBar current={forecast.monteCarlo.median30d} low={forecast.monteCarlo.lower30d} high={forecast.monteCarlo.upper30d} mean={forecast.monteCarlo.median30d} label={`30 ${de ? 'Tage' : 'Days'}`} currency={currency} locale={locale} />
              <PriceTargetBar current={forecast.monteCarlo.median90d} low={forecast.monteCarlo.lower90d} high={forecast.monteCarlo.upper90d} mean={forecast.monteCarlo.median90d} label={`90 ${de ? 'Tage' : 'Days'}`} currency={currency} locale={locale} />
            </div>
          </div>
        </div>
      )}

      {/* Monte Carlo Detail */}
      <SectionHeader
        title={de ? 'Monte-Carlo Szenarien' : 'Monte Carlo Scenarios'}
        icon={<Activity className="w-4 h-4" />}
        expanded={expandedSections.montecarlo}
        onToggle={() => toggleSection('montecarlo')}
      />
      {expandedSections.montecarlo && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/20">
                <th className="text-left px-4 py-2 text-xs text-txt-secondary font-medium">{de ? 'Zeitraum' : 'Period'}</th>
                <th className="text-right px-4 py-2 text-xs text-txt-secondary font-medium">{de ? 'Pessimistisch' : 'Bearish'} (P10)</th>
                <th className="text-right px-4 py-2 text-xs text-txt-secondary font-medium">Median (P50)</th>
                <th className="text-right px-4 py-2 text-xs text-txt-secondary font-medium">{de ? 'Optimistisch' : 'Bullish'} (P90)</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: `7 ${de ? 'Tage' : 'Days'}`, low: forecast.monteCarlo.lower7d, mid: forecast.monteCarlo.median7d, high: forecast.monteCarlo.upper7d },
                { label: `30 ${de ? 'Tage' : 'Days'}`, low: forecast.monteCarlo.lower30d, mid: forecast.monteCarlo.median30d, high: forecast.monteCarlo.upper30d },
                { label: `90 ${de ? 'Tage' : 'Days'}`, low: forecast.monteCarlo.lower90d, mid: forecast.monteCarlo.median90d, high: forecast.monteCarlo.upper90d },
              ].map(row => (
                <tr key={row.label} className="border-b border-border/10 last:border-0">
                  <td className="px-4 py-2.5 text-txt-primary font-medium">{row.label}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-danger font-mono">{fp(row.low, currency)}</span>
                    <span className="text-[10px] text-txt-muted ml-1">({formatPercent(((row.low - forecast.currentPrice) / forecast.currentPrice) * 100)})</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-accent font-mono font-medium">{fp(row.mid, currency)}</span>
                    <span className="text-[10px] text-txt-muted ml-1">({formatPercent(((row.mid - forecast.currentPrice) / forecast.currentPrice) * 100)})</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-success font-mono">{fp(row.high, currency)}</span>
                    <span className="text-[10px] text-txt-muted ml-1">({formatPercent(((row.high - forecast.currentPrice) / forecast.currentPrice) * 100)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Support & Resistance */}
      <SectionHeader
        title={de ? 'Unterstützung & Widerstand' : 'Support & Resistance'}
        icon={<Shield className="w-4 h-4" />}
        expanded={expandedSections.levels}
        onToggle={() => toggleSection('levels')}
      />
      {expandedSections.levels && (
        <div className="card p-4">
          {forecast.supportLevels.length === 0 && forecast.resistanceLevels.length === 0 ? (
            <p className="text-sm text-txt-secondary text-center py-2">{de ? 'Keine signifikanten Niveaus gefunden.' : 'No significant levels found.'}</p>
          ) : (
            <div className="space-y-1.5">
              {[...forecast.resistanceLevels].reverse().map((level, i) => (
                <LevelRow key={`r-${i}`} label={`R${forecast.resistanceLevels.length - i}`} price={level} current={forecast.currentPrice} type="resistance" currency={currency} locale={locale} />
              ))}
              <div className="flex items-center gap-3 py-1.5 px-3 bg-accent/10 rounded-lg border border-accent/20">
                <span className="text-xs font-bold text-accent w-8">{de ? 'Kurs' : 'Price'}</span>
                <div className="flex-1 h-0.5 bg-accent/30 rounded" />
                <span className="text-sm font-mono font-bold text-accent">{fp(forecast.currentPrice, currency)}</span>
              </div>
              {forecast.supportLevels.map((level, i) => (
                <LevelRow key={`s-${i}`} label={`S${i + 1}`} price={level} current={forecast.currentPrice} type="support" currency={currency} locale={locale} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Technical Signals */}
      <SectionHeader
        title={de ? 'Technische Signale' : 'Technical Signals'}
        icon={<Activity className="w-4 h-4" />}
        expanded={expandedSections.signals}
        onToggle={() => toggleSection('signals')}
      />
      {expandedSections.signals && (
        <div className="card overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0">
            {forecast.signals.map(signal => (
              <div key={signal.name} className="flex items-center justify-between px-4 py-2.5 border-b border-r border-border/10">
                <span className="text-xs text-txt-secondary">{signal.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-txt-primary">{signal.value}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    signal.signal === 'bullish' ? 'bg-success/15 text-success' : signal.signal === 'bearish' ? 'bg-danger/15 text-danger' : 'bg-dark-600 text-txt-secondary'
                  }`}>
                    {signal.signal === 'bullish' ? (de ? 'KAUF' : 'BUY') : signal.signal === 'bearish' ? (de ? 'VERK' : 'SELL') : '\u2014'}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 bg-dark-700/50">
            <div className="flex gap-1 h-1.5 rounded-full overflow-hidden mb-2">
              <div className="bg-success rounded-l-full transition-all" style={{ flex: forecast.signals.filter(s => s.signal === 'bullish').length }} />
              <div className="bg-txt-muted transition-all" style={{ flex: forecast.signals.filter(s => s.signal === 'neutral').length }} />
              <div className="bg-danger rounded-r-full transition-all" style={{ flex: forecast.signals.filter(s => s.signal === 'bearish').length }} />
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-success">{forecast.signals.filter(s => s.signal === 'bullish').length} {de ? 'Kaufen' : 'Buy'}</span>
              <span className="text-txt-muted">{forecast.signals.filter(s => s.signal === 'neutral').length} Neutral</span>
              <span className="text-danger">{forecast.signals.filter(s => s.signal === 'bearish').length} {de ? 'Verkaufen' : 'Sell'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Divergences */}
      <SectionHeader
        title={de ? 'Divergenzen' : 'Divergences'}
        icon={<GitBranchPlus className="w-4 h-4" />}
        expanded={expandedSections.divergences}
        onToggle={() => toggleSection('divergences')}
      />
      {expandedSections.divergences && (
        <div className="card p-4">
          {forecast.divergences.length === 0 ? (
            <p className="text-sm text-txt-secondary text-center py-2">{de ? 'Keine Divergenzen erkannt.' : 'No divergences detected.'}</p>
          ) : (
            <div className="space-y-2">
              {forecast.divergences.map((div, i) => (
                <div key={`${div.indicator}-${div.type}-${i}`} className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border ${div.type === 'bullish' ? 'bg-success/10 border-success/20' : 'bg-danger/10 border-danger/20'}`}>
                  <div className="shrink-0 mt-0.5">{div.type === 'bullish' ? <TrendingUp className="w-4 h-4 text-success" /> : <TrendingDown className="w-4 h-4 text-danger" />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-txt-primary">{div.indicator}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${div.type === 'bullish' ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}>
                        {div.type === 'bullish' ? (de ? 'BULLISCH' : 'BULLISH') : (de ? 'B\u00c4RISCH' : 'BEARISH')}
                      </span>
                    </div>
                    <p className="text-[11px] text-txt-secondary leading-snug">{div.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Chart Patterns */}
      <SectionHeader
        title={de ? 'Chart-Muster' : 'Chart Patterns'}
        icon={<Layers className="w-4 h-4" />}
        expanded={expandedSections.patterns}
        onToggle={() => toggleSection('patterns')}
      />
      {expandedSections.patterns && (
        <div className="card p-4">
          {forecast.patterns.length === 0 ? (
            <p className="text-sm text-txt-secondary text-center py-2">{de ? 'Keine Chart-Muster erkannt.' : 'No chart patterns detected.'}</p>
          ) : (
            <div className="space-y-3">
              {forecast.patterns.map((pat, i) => (
                <div key={`${pat.name}-${i}`} className={`px-3 py-2.5 rounded-lg border ${pat.type === 'bullish' ? 'bg-success/10 border-success/20' : pat.type === 'bearish' ? 'bg-danger/10 border-danger/20' : 'bg-dark-600 border-border/20'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      {pat.type === 'bullish' ? <TrendingUp className="w-4 h-4 text-success" /> : pat.type === 'bearish' ? <TrendingDown className="w-4 h-4 text-danger" /> : <Minus className="w-4 h-4 text-txt-muted" />}
                      <span className="text-xs font-semibold text-txt-primary">{pat.name}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${pat.type === 'bullish' ? 'bg-success/15 text-success' : pat.type === 'bearish' ? 'bg-danger/15 text-danger' : 'bg-dark-600 text-txt-secondary'}`}>
                        {pat.type === 'bullish' ? (de ? 'BULLISCH' : 'BULLISH') : pat.type === 'bearish' ? (de ? 'B\u00c4RISCH' : 'BEARISH') : 'NEUTRAL'}
                      </span>
                    </div>
                    <span className="text-[10px] text-txt-muted font-medium">{de ? 'Konfidenz' : 'Confidence'}: {pat.confidence}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-dark-700 rounded-full overflow-hidden mb-1.5">
                    <div className={`h-full rounded-full transition-all ${pat.type === 'bullish' ? 'bg-success' : pat.type === 'bearish' ? 'bg-danger' : 'bg-txt-muted'}`} style={{ width: `${pat.confidence}%` }} />
                  </div>
                  <p className="text-[11px] text-txt-secondary leading-snug">{pat.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Forecast Page ───

export default function Forecast() {
  const { locale, t, watchlist } = useApp();
  const { fp } = usePrice();
  const [symbol, setSymbol] = useState('AAPL');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ symbol: string; shortname: string }[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OHLCVData[]>([]);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsData | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    overview: true,
    targets: true,
    montecarlo: true,
    levels: true,
    signals: true,
    divergences: true,
    patterns: true,
  });

  const currency = quote?.currency || 'USD';

  // Search handler
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const timeout = setTimeout(async () => {
      try {
        const results = await searchSymbols(searchQuery);
        setSearchResults(results.slice(0, 6));
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery]);

  // Load data for selected symbol
  const loadData = useCallback(async (sym: string) => {
    setLoading(true);
    try {
      const [chartResult, quoteResult, fundResult] = await Promise.allSettled([
        fetchChart(sym, '1y', '1d'),
        fetchQuote(sym),
        fetchFundamentals(sym),
      ]);
      if (chartResult.status === 'fulfilled') setData(chartResult.value.quotes);
      if (quoteResult.status === 'fulfilled') setQuote(quoteResult.value);
      if (fundResult.status === 'fulfilled') setFundamentals(fundResult.value);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadData(symbol); }, [symbol, loadData]);

  // Compute forecast
  const forecast = useMemo(() => {
    if (data.length < 50 || !quote) return null;
    return computeForecast(data, quote, fundamentals);
  }, [data, quote, fundamentals]);

  function selectSymbol(sym: string) {
    setSymbol(sym);
    setSearchQuery('');
    setSearchOpen(false);
  }

  function toggleSection(key: string) {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const de = locale === 'de';

  return (
    <div className="space-y-4 animate-fade-in max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center">
            <Target className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-txt-primary">
              {de ? 'Kurs-Prognose' : 'Price Forecast'}
            </h1>
            <p className="text-xs text-txt-secondary">
              {de ? 'Technische Analyse & statistische Vorhersage' : 'Technical Analysis & Statistical Prediction'}
            </p>
          </div>
        </div>

        {/* Symbol selector */}
        <div className="relative w-full sm:w-64">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-txt-muted" />
            <input
              type="text"
              value={searchOpen ? searchQuery : symbol}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              placeholder={de ? 'Symbol suchen...' : 'Search symbol...'}
              className="w-full pl-9 pr-3 py-2 bg-dark-700 border border-border/30 rounded-lg text-sm text-txt-primary focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* Search dropdown */}
          {searchOpen && (searchResults.length > 0 || watchlist.length > 0) && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-dark-800 border border-border/30 rounded-lg shadow-xl z-50 overflow-hidden">
              {searchResults.length > 0 ? (
                searchResults.map(r => (
                  <button
                    key={r.symbol}
                    onClick={() => selectSymbol(r.symbol)}
                    className="w-full text-left px-3 py-2 hover:bg-dark-600 flex justify-between items-center transition-colors"
                  >
                    <span className="text-sm font-medium text-txt-primary">{r.symbol}</span>
                    <span className="text-xs text-txt-secondary truncate ml-2">{r.shortname}</span>
                  </button>
                ))
              ) : (
                <>
                  <div className="px-3 py-1.5 text-[10px] text-txt-muted uppercase tracking-wider">
                    Watchlist
                  </div>
                  {watchlist.slice(0, 6).map(item => (
                    <button
                      key={item.symbol}
                      onClick={() => selectSymbol(item.symbol)}
                      className="w-full text-left px-3 py-2 hover:bg-dark-600 flex justify-between items-center transition-colors"
                    >
                      <span className="text-sm font-medium text-txt-primary">{item.symbol}</span>
                      <span className="text-xs text-txt-secondary truncate ml-2">{item.name}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Close search on outside click */}
      {searchOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setSearchOpen(false)} />
      )}

      {loading && <LoadingSpinner text={`${de ? 'Analysiere' : 'Analyzing'} ${symbol}...`} />}

      {!loading && !forecast && (
        <div className="card p-8 text-center">
          <Activity className="w-12 h-12 text-txt-muted mx-auto mb-3" />
          <p className="text-txt-secondary">
            {de ? 'Nicht genug Daten für eine Prognose.' : 'Not enough data for a forecast.'}
          </p>
        </div>
      )}

      {!loading && forecast && (
        <ForecastContent forecast={forecast} currency={currency} locale={locale} fp={fp} />
      )}
    </div>
  );
}

// ─── Sub-components ───

function SectionHeader({
  title, icon, expanded, onToggle,
}: {
  title: string; icon: React.ReactNode; expanded: boolean; onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between py-2 group"
    >
      <div className="flex items-center gap-2 text-txt-primary">
        {icon}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="text-txt-muted group-hover:text-txt-primary transition-colors">
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </div>
    </button>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-txt-secondary">{label}</span>
      <span className="text-xs font-mono font-medium text-txt-primary">{value}</span>
    </div>
  );
}

function ProjectionRow({
  label, value, current, currency, locale,
}: {
  label: string; value: number; current: number; currency: string; locale: 'de' | 'en';
}) {
  const { fp } = usePrice();
  const change = ((value - current) / current) * 100;
  const isPositive = change >= 0;

  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-txt-secondary">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-txt-primary">{fp(value, currency)}</span>
        <span className={`text-[10px] font-medium ${isPositive ? 'text-success' : 'text-danger'}`}>
          {isPositive ? '+' : ''}{change.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

function LevelRow({
  label, price, current, type, currency, locale,
}: {
  label: string; price: number; current: number;
  type: 'support' | 'resistance'; currency: string; locale: 'de' | 'en';
}) {
  const { fp } = usePrice();
  const diff = ((price - current) / current) * 100;
  const color = type === 'support' ? 'text-success' : 'text-danger';
  const bgColor = type === 'support' ? 'bg-success/10 border-success/20' : 'bg-danger/10 border-danger/20';

  return (
    <div className={`flex items-center gap-3 py-1.5 px-3 rounded-lg border ${bgColor}`}>
      <span className={`text-xs font-bold w-8 ${color}`}>{label}</span>
      <div className={`flex-1 h-0.5 ${type === 'support' ? 'bg-success/20' : 'bg-danger/20'} rounded`} />
      <span className={`text-sm font-mono ${color}`}>{fp(price, currency)}</span>
      <span className="text-[10px] text-txt-muted">({diff > 0 ? '+' : ''}{diff.toFixed(1)}%)</span>
    </div>
  );
}
