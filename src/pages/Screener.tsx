import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, ArrowUpDown, ArrowUp, ArrowDown, Filter, RotateCcw } from 'lucide-react';
import { useApp } from '../context';
import { fetchScreener, type ScreenerStock } from '../api';
import { formatPercent, formatLargeNumber, formatRatio } from '../formatters';
import { usePrice } from '../hooks/usePrice';
import LoadingSpinner from '../components/LoadingSpinner';

interface Filters {
  sector: string;
  minMarketCap: number; // in billions
  maxPE: number;
  minDividendYield: number;
  minChangePercent: number;
  maxChangePercent: number;
}

const DEFAULT_FILTERS: Filters = {
  sector: '',
  minMarketCap: 0,
  maxPE: 9999,
  minDividendYield: 0,
  minChangePercent: -100,
  maxChangePercent: 100,
};

const PRESETS: { label: string; filters: Partial<Filters> }[] = [
  { label: 'Hohe Dividende', filters: { minDividendYield: 2 } },
  { label: 'Unterbewertet (KGV<15)', filters: { maxPE: 15 } },
  { label: 'Large Cap (>200B)', filters: { minMarketCap: 200 } },
  { label: 'Top Gewinner', filters: { minChangePercent: 1 } },
  { label: 'Top Verlierer', filters: { maxChangePercent: -1 } },
];

type SortField = 'symbol' | 'price' | 'changePercent' | 'marketCap' | 'pe' | 'dividendYield' | 'volume';
type SortDir = 'asc' | 'desc';

export default function Screener() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { locale } = useApp();
  const { fp } = usePrice();
  const [stocks, setStocks] = useState<ScreenerStock[]>([]);
  const [loading, setLoading] = useState(true);

  // Apply preset from URL params (?preset=gainers or ?preset=losers)
  const urlPreset = searchParams.get('preset');
  const [filters, setFilters] = useState<Filters>(() => {
    if (urlPreset === 'gainers') return { ...DEFAULT_FILTERS, minChangePercent: 0.01 };
    if (urlPreset === 'losers') return { ...DEFAULT_FILTERS, maxChangePercent: -0.01 };
    return DEFAULT_FILTERS;
  });
  const [sortField, setSortField] = useState<SortField>(
    urlPreset === 'gainers' || urlPreset === 'losers' ? 'changePercent' : 'marketCap'
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    urlPreset === 'losers' ? 'asc' : 'desc'
  );

  useEffect(() => {
    fetchScreener()
      .then(setStocks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sectors = useMemo(() => {
    const set = new Set(stocks.map((s) => s.sector).filter((s) => s && s !== 'N/A'));
    return Array.from(set).sort();
  }, [stocks]);

  const filtered = useMemo(() => {
    let result = stocks.filter((s) => {
      if (filters.sector && s.sector !== filters.sector) return false;
      if ((s.marketCap || 0) / 1e9 < filters.minMarketCap) return false;
      if (filters.maxPE < 9999 && (s.pe == null || s.pe > filters.maxPE)) return false;
      if (
        filters.minDividendYield > 0 &&
        (s.dividendYield == null || s.dividendYield * 100 < filters.minDividendYield)
      )
        return false;
      if (s.changePercent < filters.minChangePercent) return false;
      if (s.changePercent > filters.maxChangePercent) return false;
      return true;
    });

    result.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sortField) {
        case 'symbol':
          return sortDir === 'asc'
            ? a.symbol.localeCompare(b.symbol)
            : b.symbol.localeCompare(a.symbol);
        case 'price':
          aVal = a.price || 0;
          bVal = b.price || 0;
          break;
        case 'changePercent':
          aVal = a.changePercent || 0;
          bVal = b.changePercent || 0;
          break;
        case 'marketCap':
          aVal = a.marketCap || 0;
          bVal = b.marketCap || 0;
          break;
        case 'pe':
          aVal = a.pe || 9999;
          bVal = b.pe || 9999;
          break;
        case 'dividendYield':
          aVal = a.dividendYield || 0;
          bVal = b.dividendYield || 0;
          break;
        case 'volume':
          aVal = a.volume || 0;
          bVal = b.volume || 0;
          break;
        default:
          return 0;
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [stocks, filters, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function applyPreset(preset: Partial<Filters>) {
    setFilters({ ...DEFAULT_FILTERS, ...preset });
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field)
      return <ArrowUpDown className="w-3 h-3 text-txt-muted" />;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-accent" />
    ) : (
      <ArrowDown className="w-3 h-3 text-accent" />
    );
  }

  if (loading) return <LoadingSpinner text="Lade Screener..." />;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <SlidersHorizontal className="w-5 h-5 text-accent" />
        <h2 className="text-lg font-bold text-txt-primary">Stock Screener</h2>
        <span className="text-xs text-txt-muted ml-2">
          {filtered.length} von {stocks.length} Aktien
        </span>
      </div>

      {/* Presets */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => applyPreset(p.filters)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-dark-700 text-txt-secondary hover:text-txt-primary hover:bg-dark-600 border border-border/20 transition-colors"
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setFilters(DEFAULT_FILTERS)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-txt-muted hover:text-txt-primary hover:bg-dark-600 transition-colors flex items-center gap-1"
        >
          <RotateCcw className="w-3 h-3" /> Reset
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-4 h-4 text-txt-secondary" />
          <span className="text-sm font-medium text-txt-primary">Filter</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div>
            <label className="stat-label mb-1 block">Sektor</label>
            <select
              value={filters.sector}
              onChange={(e) => setFilters({ ...filters, sector: e.target.value })}
              className="input w-full text-xs"
            >
              <option value="">Alle</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="stat-label mb-1 block">Min. MarktKap. (Mrd.)</label>
            <input
              type="number"
              value={filters.minMarketCap || ''}
              onChange={(e) =>
                setFilters({ ...filters, minMarketCap: Number(e.target.value) || 0 })
              }
              className="input w-full text-xs"
              placeholder="0"
            />
          </div>
          <div>
            <label className="stat-label mb-1 block">Max. KGV</label>
            <input
              type="number"
              value={filters.maxPE >= 9999 ? '' : filters.maxPE}
              onChange={(e) =>
                setFilters({ ...filters, maxPE: Number(e.target.value) || 9999 })
              }
              className="input w-full text-xs"
              placeholder="unbegrenzt"
            />
          </div>
          <div>
            <label className="stat-label mb-1 block">Min. Div.Rendite (%)</label>
            <input
              type="number"
              step="0.5"
              value={filters.minDividendYield || ''}
              onChange={(e) =>
                setFilters({ ...filters, minDividendYield: Number(e.target.value) || 0 })
              }
              className="input w-full text-xs"
              placeholder="0"
            />
          </div>
          <div>
            <label className="stat-label mb-1 block">Min. Veränd. (%)</label>
            <input
              type="number"
              step="0.5"
              value={filters.minChangePercent === -100 ? '' : filters.minChangePercent}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  minChangePercent: e.target.value ? Number(e.target.value) : -100,
                })
              }
              className="input w-full text-xs"
              placeholder="-100"
            />
          </div>
          <div>
            <label className="stat-label mb-1 block">Max. Veränd. (%)</label>
            <input
              type="number"
              step="0.5"
              value={filters.maxChangePercent === 100 ? '' : filters.maxChangePercent}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  maxChangePercent: e.target.value ? Number(e.target.value) : 100,
                })
              }
              className="input w-full text-xs"
              placeholder="100"
            />
          </div>
        </div>
      </div>

      {/* Results table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30 bg-dark-800">
                <th
                  className="text-left px-4 py-2.5 text-xs text-txt-muted font-medium cursor-pointer hover:text-txt-primary"
                  onClick={() => toggleSort('symbol')}
                >
                  <div className="flex items-center gap-1">
                    Symbol <SortIcon field="symbol" />
                  </div>
                </th>
                <th
                  className="text-right px-4 py-2.5 text-xs text-txt-muted font-medium cursor-pointer hover:text-txt-primary"
                  onClick={() => toggleSort('price')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Kurs <SortIcon field="price" />
                  </div>
                </th>
                <th
                  className="text-right px-4 py-2.5 text-xs text-txt-muted font-medium cursor-pointer hover:text-txt-primary"
                  onClick={() => toggleSort('changePercent')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Veränd. <SortIcon field="changePercent" />
                  </div>
                </th>
                <th
                  className="text-right px-4 py-2.5 text-xs text-txt-muted font-medium cursor-pointer hover:text-txt-primary hidden md:table-cell"
                  onClick={() => toggleSort('marketCap')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Marktkapit. <SortIcon field="marketCap" />
                  </div>
                </th>
                <th
                  className="text-right px-4 py-2.5 text-xs text-txt-muted font-medium cursor-pointer hover:text-txt-primary hidden lg:table-cell"
                  onClick={() => toggleSort('pe')}
                >
                  <div className="flex items-center justify-end gap-1">
                    KGV <SortIcon field="pe" />
                  </div>
                </th>
                <th
                  className="text-right px-4 py-2.5 text-xs text-txt-muted font-medium cursor-pointer hover:text-txt-primary hidden lg:table-cell"
                  onClick={() => toggleSort('dividendYield')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Div.Rend. <SortIcon field="dividendYield" />
                  </div>
                </th>
                <th
                  className="text-right px-4 py-2.5 text-xs text-txt-muted font-medium cursor-pointer hover:text-txt-primary hidden md:table-cell"
                  onClick={() => toggleSort('volume')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Volumen <SortIcon field="volume" />
                  </div>
                </th>
                <th className="text-left px-4 py-2.5 text-xs text-txt-muted font-medium hidden xl:table-cell">
                  Sektor
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.symbol}
                  onClick={() => navigate(`/stock/${s.symbol}`)}
                  className="border-b border-border/10 last:border-0 hover:bg-dark-600/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2">
                    <div>
                      <span className="font-mono font-semibold text-accent">{s.symbol}</span>
                      <span className="text-xs text-txt-muted ml-2 hidden sm:inline">
                        {s.shortName}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-txt-primary">
                    {fp(s.price, s.currency || 'USD')}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span
                      className={`font-mono text-xs ${
                        s.changePercent >= 0 ? 'text-success' : 'text-danger'
                      }`}
                    >
                      {formatPercent(s.changePercent)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-txt-secondary hidden md:table-cell">
                    {formatLargeNumber(s.marketCap)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-txt-secondary hidden lg:table-cell">
                    {s.pe ? formatRatio(s.pe) : '--'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-txt-secondary hidden lg:table-cell">
                    {s.dividendYield ? (s.dividendYield * 100).toFixed(2) + '%' : '--'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-txt-secondary hidden md:table-cell">
                    {formatLargeNumber(s.volume)}
                  </td>
                  <td className="px-4 py-2 text-xs text-txt-muted hidden xl:table-cell">
                    {s.sector}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-8 text-txt-muted text-sm">
            Keine Aktien gefunden mit diesen Filtern.
          </div>
        )}
      </div>
    </div>
  );
}
