import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateStochastic,
  calculateWilliamsR,
} from '../indicators';
import type { OHLCVData } from '../types';

interface TechnicalSummaryProps {
  data: OHLCVData[];
}

type Signal = 'buy' | 'sell' | 'neutral';

interface SignalItem {
  label: string;
  value: string;
  signal: Signal;
}

function getSignalColor(signal: Signal) {
  switch (signal) {
    case 'buy': return 'text-success';
    case 'sell': return 'text-danger';
    default: return 'text-txt-secondary';
  }
}

function getSignalBg(signal: Signal) {
  switch (signal) {
    case 'buy': return 'bg-success/15';
    case 'sell': return 'bg-danger/15';
    default: return 'bg-dark-600';
  }
}

export default function TechnicalSummary({ data }: TechnicalSummaryProps) {
  const analysis = useMemo(() => {
    if (data.length < 50) return null;

    const closes = data.map((d) => d.close);
    const lastPrice = closes[closes.length - 1];
    const signals: SignalItem[] = [];

    // SMA signals
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);
    const lastSma20 = sma20[sma20.length - 1];
    const lastSma50 = sma50[sma50.length - 1];

    signals.push({
      label: 'SMA 20',
      value: lastSma20.toFixed(2),
      signal: lastPrice > lastSma20 ? 'buy' : 'sell',
    });
    signals.push({
      label: 'SMA 50',
      value: lastSma50.toFixed(2),
      signal: lastPrice > lastSma50 ? 'buy' : 'sell',
    });

    if (closes.length >= 200) {
      const sma200 = calculateSMA(closes, 200);
      const lastSma200 = sma200[sma200.length - 1];
      signals.push({
        label: 'SMA 200',
        value: lastSma200.toFixed(2),
        signal: lastPrice > lastSma200 ? 'buy' : 'sell',
      });
    }

    // EMA signals
    const ema12 = calculateEMA(closes, 12);
    const ema26 = calculateEMA(closes, 26);
    const lastEma12 = ema12[ema12.length - 1];
    const lastEma26 = ema26[ema26.length - 1];

    signals.push({
      label: 'EMA 12/26',
      value: lastEma12 > lastEma26 ? 'Bullish' : 'Bearish',
      signal: lastEma12 > lastEma26 ? 'buy' : 'sell',
    });

    // RSI
    const rsi = calculateRSI(closes, 14);
    const lastRsi = rsi[rsi.length - 1];
    signals.push({
      label: 'RSI (14)',
      value: lastRsi.toFixed(1),
      signal: lastRsi < 30 ? 'buy' : lastRsi > 70 ? 'sell' : 'neutral',
    });

    // MACD
    const { macd, signal: macdSignal, histogram } = calculateMACD(closes);
    if (histogram.length > 0) {
      const lastHist = histogram[histogram.length - 1];
      const prevHist = histogram.length > 1 ? histogram[histogram.length - 2] : 0;
      signals.push({
        label: 'MACD',
        value: lastHist > 0 ? 'Bullish' : 'Bearish',
        signal: lastHist > 0 && lastHist > prevHist ? 'buy'
          : lastHist < 0 && lastHist < prevHist ? 'sell'
          : 'neutral',
      });
    }

    // Stochastic
    if (data.length >= 17) {
      const { k } = calculateStochastic(data);
      const lastK = k[k.length - 1];
      signals.push({
        label: 'Stochastik %K',
        value: lastK.toFixed(1),
        signal: lastK < 20 ? 'buy' : lastK > 80 ? 'sell' : 'neutral',
      });
    }

    // Williams %R
    if (data.length >= 14) {
      const { values: willR } = calculateWilliamsR(data);
      const lastWR = willR[willR.length - 1];
      signals.push({
        label: 'Williams %R',
        value: lastWR.toFixed(1),
        signal: lastWR < -80 ? 'buy' : lastWR > -20 ? 'sell' : 'neutral',
      });
    }

    // Overall signal
    const buyCount = signals.filter((s) => s.signal === 'buy').length;
    const sellCount = signals.filter((s) => s.signal === 'sell').length;
    const overall: Signal = buyCount > sellCount + 1 ? 'buy'
      : sellCount > buyCount + 1 ? 'sell'
      : 'neutral';

    return { signals, overall, buyCount, sellCount };
  }, [data]);

  if (!analysis) {
    return (
      <div className="card p-4 text-sm text-txt-secondary text-center">
        Nicht genug Daten für die technische Analyse.
      </div>
    );
  }

  const { signals, overall, buyCount, sellCount } = analysis;
  const neutralCount = signals.length - buyCount - sellCount;

  return (
    <div className="card p-4 animate-slide-up">
      {/* Overall Signal */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-accent/10">
            <Activity className="w-4 h-4 text-accent" />
          </div>
          <h3 className="text-sm font-bold text-txt-primary">Technische Analyse</h3>
        </div>
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${getSignalBg(overall)} ${getSignalColor(overall)}`}>
          {overall === 'buy' && <TrendingUp className="w-3.5 h-3.5" />}
          {overall === 'sell' && <TrendingDown className="w-3.5 h-3.5" />}
          {overall === 'neutral' && <Minus className="w-3.5 h-3.5" />}
          {overall === 'buy' ? 'Kaufen' : overall === 'sell' ? 'Verkaufen' : 'Neutral'}
        </div>
      </div>

      {/* Signal meter */}
      <div className="flex gap-1 mb-3 h-1.5 rounded-full overflow-hidden">
        <div className="bg-success rounded-l-full transition-all" style={{ flex: buyCount }} />
        <div className="bg-txt-muted transition-all" style={{ flex: neutralCount }} />
        <div className="bg-danger rounded-r-full transition-all" style={{ flex: sellCount }} />
      </div>
      <div className="flex justify-between text-[10px] mb-4">
        <span className="text-success">{buyCount} Kaufen</span>
        <span className="text-txt-muted">{neutralCount} Neutral</span>
        <span className="text-danger">{sellCount} Verkaufen</span>
      </div>

      {/* Individual signals */}
      <div className="space-y-0">
        {signals.map((s) => (
          <div key={s.label} className="flex items-center justify-between py-2 px-2 -mx-2 rounded-lg border-b border-border/5 last:border-0 hover:bg-dark-600/20 transition-colors">
            <span className="text-xs text-txt-secondary">{s.label}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono tabular-nums text-txt-primary">{s.value}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${getSignalBg(s.signal)} ${getSignalColor(s.signal)}`}>
                {s.signal === 'buy' ? 'KAUF' : s.signal === 'sell' ? 'VERK' : '—'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
