import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { fetchIndexConstituents } from '../api';
import type { ScreenerStock } from '../api';
import { formatPercent, formatLargeNumber } from '../formatters';
import { usePrice } from '../hooks/usePrice';
import { useApp } from '../context';
import LoadingSpinner from './LoadingSpinner';
import { Price } from './Price';

type SortKey = 'changePercent' | 'marketCap' | 'shortName' | 'pe' | 'dividendYield';
type SortDir = 'asc' | 'desc';

const SORT_OPTIONS: { key: SortKey; labelDe: string; labelEn: string }[] = [
  { key: 'changePercent', labelDe: 'Performance', labelEn: 'Performance' },
  { key: 'marketCap', labelDe: 'Marktkapit.', labelEn: 'Market Cap' },
  { key: 'shortName', labelDe: 'Name', labelEn: 'Name' },
  { key: 'pe', labelDe: 'KGV', labelEn: 'P/E' },
  { key: 'dividendYield', labelDe: 'Div.Rendite', labelEn: 'Div. Yield' },
];

interface Props {
  indexSymbol: string;
}

export default function IndexConstituents({ indexSymbol }: Props) {
  const navigate = useNavigate();
  const { locale } = useApp();
  const { fp } = usePrice();
  const de = locale === 'de';

  const [stocks, setStocks] = useState<ScreenerStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [sortKey, setSortKey] = useState<SortKey>('changePercent');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sectorFilter, setSectorFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchIndexConstituents(indexSymbol)
      .then((data) => {
        if (!cancelled) setStocks(data);
      })
      .catch(() => {
        if (!cancelled) setError(de ? 'Daten konnten nicht geladen werden.' : 'Failed to load data.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [indexSymbol, de]);

  // Available sectors
  const sectors = useMemo(() => {
    const s = new Set(stocks.map((st) => st.sector).filter((s) => s && s !== 'N/A'));
    return [...s].sort();
  }, [stocks]);

  // Filtered + sorted
  const sorted = useMemo(() => {
    let filtered = stocks;
    if (sectorFilter) {
      filtered = filtered.filter((s) => s.sector === sectorFilter);
    }
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'changePercent':
          cmp = (a.changePercent || 0) - (b.changePercent || 0);
          break;
        case 'marketCap':
          cmp = (a.marketCap || 0) - (b.marketCap || 0);
          break;
        case 'shortName':
          cmp = (a.shortName || '').localeCompare(b.shortName || '');
          break;
        case 'pe':
          cmp = (a.pe ?? 9999) - (b.pe ?? 9999);
          break;
        case 'dividendYield':
          cmp = (a.dividendYield ?? 0) - (b.dividendYield ?? 0);
          break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [stocks, sortKey, sortDir, sectorFilter]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'shortName' ? 'asc' : 'desc');
    }
  }

  if (loading) return <LoadingSpinner text={de ? 'Lade Bestandteile...' : 'Loading constituents...'} />;

  if (error) {
    return (
      <div className="card p-8 text-center text-txt-secondary">
        <p>{error}</p>
      </div>
    );
  }

  if (stocks.length === 0) {
    return (
      <div className="card p-8 text-center text-txt-secondary">
        <p>{de ? 'Keine Bestandteile verfügbar für diesen Index.' : 'No constituents available for this index.'}</p>
      </div>
    );
  }

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 text-txt-muted/40" />;
    return sortDir === 'desc'
      ? <ChevronDown className="w-3 h-3 text-accent" />
      : <ChevronUp className="w-3 h-3 text-accent" />;
  };

  return (
    <div className="space-y-3 pt-4">
      {/* Header + Filter toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-txt-primary">
            {de ? 'Bestandteile' : 'Constituents'}
          </span>
          <span className="text-xs text-txt-muted">({sorted.length}{sectorFilter ? ` / ${stocks.length}` : ''})</span>
        </div>
        <button
          onClick={() => setFilterOpen((p) => !p)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            filterOpen ? 'bg-accent/15 text-accent' : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600/50'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          {de ? 'Filter' : 'Filter'}
          <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${filterOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Filter panel */}
      {filterOpen && (
        <div className="card p-3 space-y-3 animate-fade-in">
          {/* Sort chips */}
          <div>
            <span className="text-[10px] text-txt-muted uppercase tracking-wider block mb-1.5">
              {de ? 'Sortieren nach' : 'Sort by'}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => toggleSort(opt.key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    sortKey === opt.key
                      ? 'bg-accent/15 text-accent border border-accent/30'
                      : 'bg-dark-600/50 text-txt-secondary border border-border/20 hover:border-border/40'
                  }`}
                >
                  {de ? opt.labelDe : opt.labelEn}
                  {sortKey === opt.key && (
                    <span className="ml-1 text-[10px]">{sortDir === 'desc' ? '\u2193' : '\u2191'}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
          {/* Sector filter */}
          {sectors.length > 0 && (
            <div>
              <span className="text-[10px] text-txt-muted uppercase tracking-wider block mb-1.5">
                {de ? 'Sektor' : 'Sector'}
              </span>
              <select
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                className="w-full sm:w-auto px-3 py-1.5 bg-dark-700 border border-border/30 rounded-lg text-xs text-txt-primary focus:outline-none focus:border-accent/50"
              >
                <option value="">{de ? 'Alle Sektoren' : 'All Sectors'}</option>
                {sectors.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/20">
                <th
                  className="text-left px-4 py-2.5 text-xs text-txt-muted font-medium cursor-pointer hover:text-txt-primary transition-colors"
                  onClick={() => toggleSort('shortName')}
                >
                  <div className="flex items-center gap-1">
                    Symbol <SortIcon col="shortName" />
                  </div>
                </th>
                <th className="text-left px-4 py-2.5 text-xs text-txt-muted font-medium hidden sm:table-cell">
                  Name
                </th>
                <th className="text-right px-4 py-2.5 text-xs text-txt-muted font-medium">
                  {de ? 'Kurs' : 'Price'}
                </th>
                <th
                  className="text-right px-4 py-2.5 text-xs text-txt-muted font-medium cursor-pointer hover:text-txt-primary transition-colors"
                  onClick={() => toggleSort('changePercent')}
                >
                  <div className="flex items-center justify-end gap-1">
                    {de ? 'Veränd.' : 'Change'} <SortIcon col="changePercent" />
                  </div>
                </th>
                <th
                  className="text-right px-4 py-2.5 text-xs text-txt-muted font-medium cursor-pointer hover:text-txt-primary transition-colors hidden md:table-cell"
                  onClick={() => toggleSort('marketCap')}
                >
                  <div className="flex items-center justify-end gap-1">
                    {de ? 'Marktkapit.' : 'Market Cap'} <SortIcon col="marketCap" />
                  </div>
                </th>
                <th
                  className="text-right px-4 py-2.5 text-xs text-txt-muted font-medium cursor-pointer hover:text-txt-primary transition-colors hidden lg:table-cell"
                  onClick={() => toggleSort('pe')}
                >
                  <div className="flex items-center justify-end gap-1">
                    {de ? 'KGV' : 'P/E'} <SortIcon col="pe" />
                  </div>
                </th>
                <th
                  className="text-right px-4 py-2.5 text-xs text-txt-muted font-medium cursor-pointer hover:text-txt-primary transition-colors hidden lg:table-cell"
                  onClick={() => toggleSort('dividendYield')}
                >
                  <div className="flex items-center justify-end gap-1">
                    {de ? 'Div.' : 'Div.'} <SortIcon col="dividendYield" />
                  </div>
                </th>
                <th className="text-left px-4 py-2.5 text-xs text-txt-muted font-medium hidden xl:table-cell">
                  {de ? 'Sektor' : 'Sector'}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => {
                const isPositive = s.changePercent >= 0;
                return (
                  <tr
                    key={s.symbol}
                    className="border-b border-border/10 last:border-0 hover:bg-accent/[0.06] cursor-pointer transition-colors"
                    onClick={() => navigate(`/stock/${s.symbol}`)}
                  >
                    <td className="px-4 py-2.5">
                      <span className="font-mono font-semibold text-xs text-accent">{s.symbol}</span>
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      <span className="text-xs text-txt-primary truncate max-w-[180px] inline-block">{s.shortName}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Price value={s.price} currency={s.currency} size={12} className="text-xs font-mono text-txt-primary" flapClassName="justify-end" />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`inline-flex items-center gap-0.5 text-xs font-mono font-medium px-1.5 py-0.5 rounded ${
                        isPositive ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
                      }`}>
                        {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {formatPercent(s.changePercent)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right hidden md:table-cell">
                      <span className="text-xs font-mono text-txt-secondary">
                        {s.marketCap ? formatLargeNumber(s.marketCap) : '\u2014'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right hidden lg:table-cell">
                      <span className="text-xs font-mono text-txt-secondary">
                        {s.pe != null ? s.pe.toFixed(1) : '\u2014'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right hidden lg:table-cell">
                      <span className="text-xs font-mono text-txt-secondary">
                        {s.dividendYield != null ? `${(s.dividendYield * 100).toFixed(2)}%` : '\u2014'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 hidden xl:table-cell">
                      <span className="text-[11px] text-txt-muted truncate max-w-[100px] inline-block">{s.sector !== 'N/A' ? s.sector : '\u2014'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
