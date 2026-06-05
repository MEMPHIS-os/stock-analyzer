import { useState, useCallback } from 'react';
import type { IndicatorType, ChartType } from '../types';

// ---------------------------------------------------------------------------
// Named chart templates (TradingView-style "indicator templates / layouts").
// Stores a snapshot of the active indicator set + chart type so a user can
// flip between, e.g., a "Swing" setup (SMA50/200 + RSI) and a "Scalp" setup
// (EMA12/26 + MACD + VWAP) with one click.
// ---------------------------------------------------------------------------

export interface ChartTemplate {
  id: string;
  name: string;
  indicators: IndicatorType[];
  chartType: ChartType;
}

const STORAGE_KEY = 'stockanalyzer_chart_templates';

// A couple of sensible built-ins so the feature isn't empty on first use.
const BUILTINS: ChartTemplate[] = [
  { id: 'builtin-swing', name: 'Swing (SMA 50/200 · RSI)', indicators: ['sma50', 'sma200', 'rsi'], chartType: 'candlestick' },
  { id: 'builtin-scalp', name: 'Scalp (EMA 12/26 · MACD · VWAP)', indicators: ['ema12', 'ema26', 'macd', 'vwap'], chartType: 'candlestick' },
  { id: 'builtin-bands', name: 'Bänder (BB · Stochastik)', indicators: ['bb', 'stochastic'], chartType: 'candlestick' },
];

function load(): ChartTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function useChartTemplates() {
  const [userTemplates, setUserTemplates] = useState<ChartTemplate[]>(load);

  const persist = useCallback((next: ChartTemplate[]) => {
    setUserTemplates(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const saveTemplate = useCallback(
    (name: string, indicators: IndicatorType[], chartType: ChartType) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const template: ChartTemplate = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: trimmed,
        indicators: [...indicators],
        chartType,
      };
      persist([...userTemplates, template]);
    },
    [userTemplates, persist]
  );

  const deleteTemplate = useCallback(
    (id: string) => persist(userTemplates.filter((t) => t.id !== id)),
    [userTemplates, persist]
  );

  // Built-ins first, then user templates.
  const templates = [...BUILTINS, ...userTemplates];

  return { templates, userTemplates, saveTemplate, deleteTemplate };
}
