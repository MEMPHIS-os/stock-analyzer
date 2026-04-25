import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase,
  Globe2,
  Cpu,
  Coins,
  Sparkles,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Compass,
} from 'lucide-react';
import { useApp } from '../context';
import { fetchQuotes, fetchSparklines } from '../api';
import { formatPercent } from '../formatters';
import { usePrice } from '../hooks/usePrice';
import { SkeletonCard } from '../components/Skeleton';
import type { QuoteData } from '../types';

// ─── Curated fund universe by category ───
// Mostly UCITS-friendly ETFs + popular US ETFs

const FUND_CATEGORIES = [
  {
    id: 'world',
    label: 'funds.category.world',
    icon: Globe2,
    funds: [
      { symbol: 'VWCE.DE', name: 'Vanguard FTSE All-World UCITS ETF (Acc)', terLabel: '0.22%' },
      { symbol: 'IWDA.AS', name: 'iShares Core MSCI World UCITS ETF (Acc)', terLabel: '0.20%' },
      { symbol: 'EUNL.DE', name: 'iShares Core MSCI World UCITS ETF', terLabel: '0.20%' },
      { symbol: 'SWRD.L', name: 'SPDR MSCI World UCITS ETF', terLabel: '0.12%' },
      { symbol: 'XDWD.DE', name: 'Xtrackers MSCI World UCITS ETF (Dist)', terLabel: '0.19%' },
      { symbol: 'ACWI', name: 'iShares MSCI ACWI ETF', terLabel: '0.32%' },
      { symbol: 'VT', name: 'Vanguard Total World Stock ETF', terLabel: '0.07%' },
    ],
  },
  {
    id: 'usa',
    label: 'funds.category.usa',
    icon: TrendingUp,
    funds: [
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', terLabel: '0.09%' },
      { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', terLabel: '0.03%' },
      { symbol: 'IVV', name: 'iShares Core S&P 500 ETF', terLabel: '0.03%' },
      { symbol: 'CSPX.L', name: 'iShares Core S&P 500 UCITS ETF (Acc)', terLabel: '0.07%' },
      { symbol: 'VUSA.AS', name: 'Vanguard S&P 500 UCITS ETF', terLabel: '0.07%' },
      { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', terLabel: '0.03%' },
      { symbol: 'QQQ', name: 'Invesco QQQ Trust (Nasdaq-100)', terLabel: '0.20%' },
      { symbol: 'EQQQ.DE', name: 'Invesco EQQQ Nasdaq-100 UCITS ETF', terLabel: '0.30%' },
    ],
  },
  {
    id: 'europe',
    label: 'funds.category.europe',
    icon: Globe2,
    funds: [
      { symbol: 'EXSA.DE', name: 'iShares STOXX Europe 600 UCITS ETF', terLabel: '0.20%' },
      { symbol: 'VEUR.AS', name: 'Vanguard FTSE Developed Europe UCITS ETF', terLabel: '0.10%' },
      { symbol: 'EXSE.DE', name: 'iShares STOXX Europe 50 UCITS ETF', terLabel: '0.32%' },
      { symbol: 'CEU.PA', name: 'Amundi Stoxx Europe 600 UCITS ETF', terLabel: '0.07%' },
      { symbol: 'DBXD.DE', name: 'Xtrackers DAX UCITS ETF (Dist)', terLabel: '0.09%' },
      { symbol: 'EXS1.DE', name: 'iShares Core DAX UCITS ETF', terLabel: '0.16%' },
    ],
  },
  {
    id: 'emerging',
    label: 'funds.category.emerging',
    icon: Globe2,
    funds: [
      { symbol: 'EIMI.AS', name: 'iShares Core MSCI EM IMI UCITS ETF', terLabel: '0.18%' },
      { symbol: 'VWO', name: 'Vanguard FTSE Emerging Markets ETF', terLabel: '0.08%' },
      { symbol: 'EEM', name: 'iShares MSCI Emerging Markets ETF', terLabel: '0.69%' },
      { symbol: 'VFEM.AS', name: 'Vanguard FTSE Emerging Markets UCITS ETF', terLabel: '0.22%' },
      { symbol: 'XMME.DE', name: 'Xtrackers MSCI Emerging Markets UCITS ETF', terLabel: '0.18%' },
    ],
  },
  {
    id: 'tech',
    label: 'funds.category.tech',
    icon: Cpu,
    funds: [
      { symbol: 'XLK', name: 'Technology Select Sector SPDR Fund', terLabel: '0.09%' },
      { symbol: 'VGT', name: 'Vanguard Information Technology ETF', terLabel: '0.10%' },
      { symbol: 'SMH', name: 'VanEck Semiconductor ETF', terLabel: '0.35%' },
      { symbol: 'SOXX', name: 'iShares Semiconductor ETF', terLabel: '0.35%' },
      { symbol: 'XLC', name: 'Communication Services Select Sector SPDR', terLabel: '0.09%' },
      { symbol: 'IUIT.L', name: 'iShares S&P 500 IT Sector UCITS ETF', terLabel: '0.15%' },
    ],
  },
  {
    id: 'bonds',
    label: 'funds.category.bonds',
    icon: Coins,
    funds: [
      { symbol: 'AGG', name: 'iShares Core US Aggregate Bond ETF', terLabel: '0.03%' },
      { symbol: 'BND', name: 'Vanguard Total Bond Market ETF', terLabel: '0.03%' },
      { symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', terLabel: '0.15%' },
      { symbol: 'IEF', name: 'iShares 7-10 Year Treasury Bond ETF', terLabel: '0.15%' },
      { symbol: 'IEAG.L', name: 'iShares Core Global Aggregate Bond UCITS ETF', terLabel: '0.10%' },
      { symbol: 'EUNA.DE', name: 'iShares Core Euro Government Bond UCITS ETF', terLabel: '0.07%' },
    ],
  },
  {
    id: 'commodities',
    label: 'funds.category.commodities',
    icon: Coins,
    funds: [
      { symbol: 'GLD', name: 'SPDR Gold Trust', terLabel: '0.40%' },
      { symbol: 'IAU', name: 'iShares Gold Trust', terLabel: '0.25%' },
      { symbol: 'SGLN.L', name: 'iShares Physical Gold ETC', terLabel: '0.12%' },
      { symbol: 'SLV', name: 'iShares Silver Trust', terLabel: '0.50%' },
      { symbol: 'USO', name: 'United States Oil Fund', terLabel: '0.81%' },
      { symbol: 'DBC', name: 'Invesco DB Commodity Index Tracking Fund', terLabel: '0.85%' },
    ],
  },
  {
    id: 'thematic',
    label: 'funds.category.thematic',
    icon: Sparkles,
    funds: [
      { symbol: 'ARKK', name: 'ARK Innovation ETF', terLabel: '0.75%' },
      { symbol: 'ICLN', name: 'iShares Global Clean Energy ETF', terLabel: '0.41%' },
      { symbol: 'IWDA.AS', name: 'iShares Core MSCI World UCITS ETF', terLabel: '0.20%' },
      { symbol: 'IBOT.DE', name: 'iShares Automation & Robotics UCITS ETF', terLabel: '0.40%' },
      { symbol: 'BOTZ', name: 'Global X Robotics & AI ETF', terLabel: '0.68%' },
      { symbol: 'LIT', name: 'Global X Lithium & Battery Tech ETF', terLabel: '0.75%' },
      { symbol: 'WCLD', name: 'WisdomTree Cloud Computing Fund', terLabel: '0.45%' },
      { symbol: 'XLV', name: 'Health Care Select Sector SPDR', terLabel: '0.09%' },
    ],
  },
  {
    id: 'dividend',
    label: 'funds.category.dividend',
    icon: TrendingUp,
    funds: [
      { symbol: 'VYM', name: 'Vanguard High Dividend Yield ETF', terLabel: '0.06%' },
      { symbol: 'SCHD', name: 'Schwab US Dividend Equity ETF', terLabel: '0.06%' },
      { symbol: 'SDIV', name: 'Global X SuperDividend ETF', terLabel: '0.58%' },
      { symbol: 'EXSG.DE', name: 'iShares STOXX Global Select Dividend 100', terLabel: '0.46%' },
      { symbol: 'TDIV.DE', name: 'VanEck Morningstar Developed Markets Dividend Leaders', terLabel: '0.38%' },
      { symbol: 'IUKD.L', name: 'iShares UK Dividend UCITS ETF', terLabel: '0.40%' },
    ],
  },
  {
    id: 'managed',
    label: 'funds.category.managed',
    icon: Compass,
    funds: [
      // Klassische Mischfonds / aktiv gemanagt (über ISIN-Suche bei Yahoo gefunden)
      { symbol: 'D5VN.MU', name: 'C-QUADRAT ARTS Total Return Bond Fund (AT0000634720)', terLabel: '~1.50%' },
      { symbol: 'Y9U6.F', name: 'Carmignac Patrimoine (FR0010135103)', terLabel: '~1.71%' },
      { symbol: '0P0001HO18.F', name: 'Warburg Global ETFs-Strategie Aktiv (DE000A2H89E6)', terLabel: '~1.50%' },
      // Weitere populäre Mischfonds
      { symbol: '0P00000F1V.F', name: 'Flossbach von Storch Multiple Opportunities R', terLabel: '~1.62%' },
      { symbol: '0P00009NPM.F', name: 'DWS Concept Kaldemorgen LD', terLabel: '~1.55%' },
      { symbol: '0P0000XW6P.F', name: 'Nordea 1 - Stable Return Fund', terLabel: '~1.65%' },
      { symbol: '0P00000NQM.F', name: 'BlackRock Global Allocation A2 USD', terLabel: '~1.78%' },
      { symbol: '0P0000IUVT.F', name: 'PIMCO GIS Income Fund', terLabel: '~1.45%' },
    ],
  },
];

// ─── Mini Sparkline ───
function MiniSparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data.length || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 32;
  const w = 80;
  const id = `fund-spark-${Math.random().toString(36).substring(2, 9)}`;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const areaPoints = `0,${h} ${points} ${w},${h}`;
  const color = positive ? '#26a69a' : '#ef5350';

  return (
    <svg width={w} height={h}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${id})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Funds() {
  const navigate = useNavigate();
  const { t } = useApp();
  const { fp } = usePrice();
  const [activeCategory, setActiveCategory] = useState<string>('world');
  const [search, setSearch] = useState('');
  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);

  // Get all unique symbols across categories (avoid duplicate fetches)
  const allSymbols = useMemo(() => {
    const set = new Set<string>();
    FUND_CATEGORIES.forEach((cat) => cat.funds.forEach((f) => set.add(f.symbol)));
    return Array.from(set);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchQuotes(allSymbols), fetchSparklines(allSymbols)])
      .then(([quoteData, sparkData]) => {
        if (cancelled) return;
        const map: Record<string, QuoteData> = {};
        quoteData.forEach((q) => {
          if (q?.symbol) map[q.symbol] = q;
        });
        setQuotes(map);
        setSparklines(sparkData);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allSymbols]);

  const activeCat = FUND_CATEGORIES.find((c) => c.id === activeCategory) ?? FUND_CATEGORIES[0];

  const visibleFunds = useMemo(() => {
    if (!search.trim()) return activeCat.funds;
    const q = search.toLowerCase();
    return activeCat.funds.filter(
      (f) => f.symbol.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
    );
  }, [activeCat, search]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5 mb-2">
          <div className="p-2 rounded-xl bg-accent/10">
            <Briefcase className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-txt-primary tracking-tight">{t('funds.title')}</h1>
            <p className="text-sm text-txt-secondary">{t('funds.subtitle')}</p>
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2">
        {FUND_CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-accent/15 text-accent shadow-glow-sm border border-accent/30'
                  : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-700/40 border border-border/10'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t(cat.label)}
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                isActive ? 'bg-accent/20' : 'bg-dark-700/40'
              }`}>
                {cat.funds.length}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-txt-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`${t('funds.holdings')} suchen...`}
          className="input w-full pl-10"
        />
      </div>

      {/* Fund Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : visibleFunds.length === 0 ? (
        <div className="card p-10 text-center text-txt-secondary">
          <Search className="w-10 h-10 text-txt-muted/20 mx-auto mb-3" />
          <p>Keine Fonds gefunden.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {visibleFunds.map((fund) => {
            const quote = quotes[fund.symbol];
            const sparkData = sparklines[fund.symbol] || [];
            const isPositive = (quote?.regularMarketChangePercent ?? 0) >= 0;

            return (
              <div
                key={fund.symbol}
                onClick={() => navigate(`/stock/${fund.symbol}`)}
                className="card p-5 cursor-pointer group"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-mono font-bold text-base text-accent mb-1">
                      {fund.symbol}
                    </div>
                    <div className="text-xs text-txt-secondary line-clamp-2 leading-snug" title={fund.name}>
                      {fund.name}
                    </div>
                  </div>
                  <div className={`p-1.5 rounded-lg shrink-0 ${
                    isPositive ? 'bg-success/10' : 'bg-danger/10'
                  }`}>
                    {isPositive ? (
                      <ArrowUpRight className="w-4 h-4 text-success" />
                    ) : (
                      <ArrowDownRight className="w-4 h-4 text-danger" />
                    )}
                  </div>
                </div>

                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-xl font-bold font-mono text-txt-primary">
                      {quote ? fp(quote.regularMarketPrice, quote.currency) : '—'}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {quote && (
                        <span className={`text-sm font-mono font-semibold ${
                          isPositive ? 'text-success' : 'text-danger'
                        }`}>
                          {formatPercent(quote.regularMarketChangePercent)}
                        </span>
                      )}
                      <span className="text-[10px] text-txt-muted bg-dark-700/40 px-1.5 py-0.5 rounded font-medium">
                        TER {fund.terLabel}
                      </span>
                    </div>
                  </div>
                  <MiniSparkline data={sparkData} positive={isPositive} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
