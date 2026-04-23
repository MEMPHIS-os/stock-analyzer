import { useState, useEffect, useCallback } from 'react';
import { fetchChart, searchSymbols, getIntervalForRange } from '../api';
import StockChart from './StockChart';
import type { OHLCVData, TimeRange, ChartType, IndicatorType, SearchResult } from '../types';

interface ChartCellProps {
  defaultSymbol: string;
  onSymbolChange: (symbol: string) => void;
  height: number;
}

const MINI_RANGES: TimeRange[] = ['1mo', '3mo', '6mo', '1y', '5y'];

export default function ChartCell({ defaultSymbol, onSymbolChange, height }: ChartCellProps) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [chartData, setChartData] = useState<OHLCVData[]>([]);
  const [range, setRange] = useState<TimeRange>('1y');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [indicators] = useState<IndicatorType[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadChart = useCallback(async () => {
    setLoading(true);
    try {
      const interval = getIntervalForRange(range);
      const result = await fetchChart(symbol, range, interval);
      setChartData(result.quotes);
    } catch {
      setChartData([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, range]);

  useEffect(() => {
    loadChart();
  }, [loadChart]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await searchSymbols(searchQuery);
        setSearchResults(results.slice(0, 5));
      } catch {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  function selectSymbol(sym: string) {
    setSymbol(sym);
    onSymbolChange(sym);
    setShowSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  }

  return (
    <div className="card flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-dark-800 border-b border-border/20">
        {/* Symbol with inline search */}
        <div className="relative">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="font-mono font-bold text-sm text-accent hover:underline"
          >
            {symbol}
          </button>
          {showSearch && (
            <div className="absolute top-full left-0 mt-1 w-52 bg-dark-700 border border-border/50 rounded-lg shadow-2xl z-50">
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input w-full text-xs rounded-b-none border-0 border-b border-border/30"
                placeholder="Symbol suchen..."
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setShowSearch(false);
                    setSearchQuery('');
                  }
                  if (e.key === 'Enter' && searchResults.length > 0) {
                    selectSymbol(searchResults[0].symbol);
                  }
                }}
              />
              {searchResults.map((r) => (
                <button
                  key={r.symbol}
                  onClick={() => selectSymbol(r.symbol)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-dark-600 text-left"
                >
                  <span className="text-xs font-mono text-accent">{r.symbol}</span>
                  <span className="text-[10px] text-txt-secondary truncate">
                    {r.shortname}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mini range buttons */}
        <div className="flex gap-px ml-2">
          {MINI_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                range === r
                  ? 'bg-accent text-white'
                  : 'text-txt-muted hover:text-txt-primary'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Mini chart type */}
        <div className="flex gap-px ml-auto">
          {(['candlestick', 'line', 'area'] as ChartType[]).map((ct) => (
            <button
              key={ct}
              onClick={() => setChartType(ct)}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                chartType === ct
                  ? 'bg-accent/20 text-accent'
                  : 'text-txt-muted hover:text-txt-primary'
              }`}
            >
              {ct === 'candlestick' ? 'K' : ct === 'line' ? 'L' : 'A'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {loading ? (
          <div
            className="flex items-center justify-center text-txt-muted text-xs"
            style={{ height: height - 36 }}
          >
            Lade...
          </div>
        ) : (
          <StockChart
            data={chartData}
            chartType={chartType}
            indicators={indicators}
            height={height - 36}
          />
        )}
      </div>
    </div>
  );
}
