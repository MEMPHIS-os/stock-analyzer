import { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
import { X, Plus, AlertCircle } from 'lucide-react';
import { useApp } from '../context';
import { fetchChart, fetchQuote, searchSymbols } from '../api';
import { formatPercent } from '../formatters';
import { usePrice } from '../hooks/usePrice';
import LoadingSpinner from './LoadingSpinner';
import { Price } from './Price';
import type { OHLCVData, TimeRange, SearchResult } from '../types';
import type { Theme } from '../context';

const COLORS = ['#2962ff', '#26a69a', '#ef5350', '#ff9800', '#9c27b0'];

interface SymbolData {
  symbol: string;
  data: OHLCVData[];
  currency: string;
}

function getChartColors(theme: Theme) {
  return {
    bg: theme === 'dark' ? '#131722' : '#ffffff',
    grid: theme === 'dark' ? '#1e222d' : '#e8e8e8',
    text: theme === 'dark' ? '#787b86' : '#5a5a6e',
    border: theme === 'dark' ? '#2B2B43' : '#d0d0e0',
  };
}

export default function ComparisonView() {
  const { compareSymbols, addCompareSymbol, removeCompareSymbol, clearCompareSymbols, theme } = useApp();
  const { fp } = usePrice();
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApi = useRef<IChartApi | null>(null);
  const [symbolsData, setSymbolsData] = useState<SymbolData[]>([]);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<TimeRange>('1y');
  const [addInput, setAddInput] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);

  const ranges: TimeRange[] = ['1mo', '3mo', '6mo', '1y', '2y', '5y'];

  // Fetch data for all symbols
  useEffect(() => {
    if (!compareSymbols.length) {
      setSymbolsData([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all(
      compareSymbols.map(async (symbol) => {
        const [chartResult, quoteResult] = await Promise.allSettled([
          fetchChart(symbol, range),
          fetchQuote(symbol),
        ]);
        return {
          symbol,
          data: chartResult.status === 'fulfilled' ? chartResult.value.quotes : [],
          currency: quoteResult.status === 'fulfilled' ? (quoteResult.value.currency || 'USD') : 'USD',
        };
      })
    )
      .then((results) => {
        if (!cancelled) setSymbolsData(results);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [compareSymbols, range]);

  // Normalized data (percentage change from first value)
  const normalizedData = useMemo(() => {
    return symbolsData.map(({ symbol, data }) => {
      if (!data.length) return { symbol, data: [] };
      const basePrice = data[0].close;
      return {
        symbol,
        data: data.map((d) => ({
          time: d.date,
          value: ((d.close - basePrice) / basePrice) * 100,
        })),
      };
    });
  }, [symbolsData]);

  // Performance summary
  const perfSummary = useMemo(() => {
    return symbolsData.map(({ symbol, data }) => {
      if (!data.length) return { symbol, change: 0 };
      const first = data[0].close;
      const last = data[data.length - 1].close;
      return { symbol, change: ((last - first) / first) * 100 };
    });
  }, [symbolsData]);

  // Render chart
  useEffect(() => {
    if (!chartRef.current || !normalizedData.length) return;

    const container = chartRef.current;
    const cc = getChartColors(theme);
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: cc.bg },
        textColor: cc.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: cc.grid },
        horzLines: { color: cc.grid },
      },
      rightPriceScale: {
        borderColor: cc.border,
      },
      timeScale: {
        borderColor: cc.border,
        timeVisible: true,
      },
      crosshair: {
        mode: 0,
      },
      width: container.clientWidth,
      height: 500,
    });
    chartApi.current = chart;

    normalizedData.forEach(({ data }, i) => {
      if (!data.length) return;
      const series = chart.addLineSeries({
        color: COLORS[i % COLORS.length],
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        priceFormat: {
          type: 'custom',
          formatter: (price: number) => `${price >= 0 ? '+' : ''}${price.toFixed(2)}%`,
        },
      });
      series.setData(data as any);
    });

    // Zero line
    if (normalizedData[0]?.data.length) {
      const zeroLine = chart.addLineSeries({
        color: 'rgba(120,123,134,0.3)',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      zeroLine.setData(
        normalizedData[0].data.map((d) => ({ time: d.time as any, value: 0 }))
      );
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartApi.current = null;
    };
  }, [normalizedData, theme]);

  // Search handler
  useEffect(() => {
    if (!addInput.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      const results = await searchSymbols(addInput);
      setSearchResults(results.filter((r) => !compareSymbols.includes(r.symbol)));
    }, 300);
    return () => clearTimeout(timer);
  }, [addInput, compareSymbols]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-txt-primary">Aktienvergleich</h2>
        {compareSymbols.length > 0 && (
          <button onClick={clearCompareSymbols} className="btn-ghost text-xs text-danger">
            Alle entfernen
          </button>
        )}
      </div>

      {/* Symbol chips + Add */}
      <div className="flex flex-wrap items-center gap-2">
        {compareSymbols.map((sym, i) => (
          <div
            key={sym}
            className="flex items-center gap-1.5 bg-dark-700 rounded-lg px-3 py-1.5 border border-border/30"
          >
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <span className="text-sm font-mono font-semibold text-txt-primary">{sym}</span>
            {perfSummary[i] && (
              <span
                className={`text-xs font-mono ${
                  perfSummary[i].change >= 0 ? 'text-success' : 'text-danger'
                }`}
              >
                {formatPercent(perfSummary[i].change)}
              </span>
            )}
            <button
              onClick={() => removeCompareSymbol(sym)}
              className="ml-1 text-txt-muted hover:text-danger transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {compareSymbols.length < 5 && (
          <div className="relative">
            <button
              onClick={() => setShowSearch(!showSearch)}
              className="flex items-center gap-1 bg-dark-700 rounded-lg px-3 py-1.5 border border-dashed border-border/50 text-sm text-txt-secondary hover:text-txt-primary hover:border-accent/50 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Hinzufügen
            </button>

            {showSearch && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-dark-700 border border-border/50 rounded-lg shadow-2xl z-50">
                <input
                  autoFocus
                  type="text"
                  value={addInput}
                  onChange={(e) => setAddInput(e.target.value)}
                  placeholder="Symbol suchen..."
                  className="input w-full rounded-b-none border-0 border-b border-border/30"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowSearch(false);
                      setAddInput('');
                    }
                  }}
                />
                {searchResults.map((r) => (
                  <button
                    key={r.symbol}
                    onClick={() => {
                      addCompareSymbol(r.symbol);
                      setAddInput('');
                      setShowSearch(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-dark-600 text-left"
                  >
                    <span className="text-sm font-mono text-accent">{r.symbol}</span>
                    <span className="text-xs text-txt-secondary truncate">{r.shortname}</span>
                  </button>
                ))}
                {addInput && !searchResults.length && (
                  <div className="px-3 py-2 text-xs text-txt-muted">Keine Ergebnisse</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Range selector */}
      {compareSymbols.length > 0 && (
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                range === r
                  ? 'bg-accent text-white'
                  : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600'
              }`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {/* Chart */}
      {loading && <LoadingSpinner text="Lade Vergleichsdaten..." />}

      {!loading && compareSymbols.length === 0 && (
        <div className="card p-12 text-center">
          <AlertCircle className="w-10 h-10 text-txt-muted mx-auto mb-3" />
          <p className="text-txt-secondary">
            Füge mindestens eine Aktie hinzu, um den Vergleich zu starten.
          </p>
          <p className="text-xs text-txt-muted mt-1">
            Du kannst bis zu 5 Aktien gleichzeitig vergleichen.
          </p>
        </div>
      )}

      {!loading && compareSymbols.length > 0 && (
        <div className="card overflow-hidden">
          <div ref={chartRef} />
        </div>
      )}

      {/* Performance table */}
      {!loading && perfSummary.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left px-4 py-2 text-xs text-txt-muted font-medium">Symbol</th>
                <th className="text-right px-4 py-2 text-xs text-txt-muted font-medium">
                  Performance ({range.toUpperCase()})
                </th>
                <th className="text-right px-4 py-2 text-xs text-txt-muted font-medium">Startpreis</th>
                <th className="text-right px-4 py-2 text-xs text-txt-muted font-medium">Aktuell</th>
              </tr>
            </thead>
            <tbody>
              {symbolsData.map(({ symbol, data }, i) => {
                const first = data[0]?.close;
                const last = data[data.length - 1]?.close;
                const change = perfSummary[i]?.change || 0;
                return (
                  <tr key={symbol} className="border-b border-border/10 last:border-0">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: COLORS[i % COLORS.length] }}
                        />
                        <span className="font-mono font-semibold">{symbol}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`font-mono ${change >= 0 ? 'text-success' : 'text-danger'}`}
                      >
                        {formatPercent(change)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-txt-secondary">
                      {first != null ? <Price value={first} currency={symbolsData[i]?.currency || 'USD'} size={12} flapClassName="justify-end" /> : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-txt-primary">
                      {last != null ? <Price value={last} currency={symbolsData[i]?.currency || 'USD'} size={12} flapClassName="justify-end" /> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
