import { useEffect, useState } from 'react';
import { Briefcase, PieChart, TrendingUp, Building2, Layers } from 'lucide-react';
import { fetchFundamentals } from '../api';
import { useApp } from '../context';
import { formatPercent, formatLargeNumber } from '../formatters';
import LoadingSpinner from './LoadingSpinner';
import type { FundamentalsData } from '../types';

interface FundPanelProps {
  symbol: string;
  currency?: string;
}

export default function FundPanel({ symbol }: FundPanelProps) {
  const { t, locale } = useApp();
  const [data, setData] = useState<FundamentalsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchFundamentals(symbol)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (loading) return <LoadingSpinner text={t('general.loading')} />;
  if (!data) return <div className="card p-6 text-center text-txt-secondary">{t('funds.noData')}</div>;

  const fundProfile = data.fundProfile;
  const topHoldings = data.topHoldings;
  const fundPerformance = data.fundPerformance;
  const summary = data.summaryDetail;

  const ter = fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio
    ?? fundProfile?.feesExpensesInvestment?.netExpRatio;
  const aum = summary?.marketCap;

  // Asset allocation
  const stockPos = topHoldings?.stockPosition ?? 0;
  const bondPos = topHoldings?.bondPosition ?? 0;
  const cashPos = topHoldings?.cashPosition ?? 0;
  const otherPos = Math.max(0, 1 - stockPos - bondPos - cashPos);

  const hasAnyData = ter != null || aum != null || (topHoldings?.holdings?.length ?? 0) > 0;
  if (!hasAnyData) {
    return <div className="card p-6 text-center text-txt-secondary">{t('funds.noData')}</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ─── Top Stats ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {ter != null && (
          <StatCard
            icon={<TrendingUp className="w-4 h-4" />}
            label={t('funds.terLabel')}
            value={formatPercent(ter * 100)}
          />
        )}
        {aum != null && (
          <StatCard
            icon={<Briefcase className="w-4 h-4" />}
            label={t('funds.aumLabel')}
            value={formatLargeNumber(aum)}
          />
        )}
        {fundProfile?.family && (
          <StatCard
            icon={<Building2 className="w-4 h-4" />}
            label={t('funds.family')}
            value={fundProfile.family}
          />
        )}
        {fundProfile?.categoryName && (
          <StatCard
            icon={<Layers className="w-4 h-4" />}
            label={t('funds.category')}
            value={fundProfile.categoryName}
          />
        )}
      </div>

      {/* ─── Performance ─── */}
      {fundPerformance?.trailingReturns && (
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <TrendingUp className="w-4 h-4 text-accent" />
            </div>
            <h3 className="text-base font-bold text-txt-primary">{t('funds.performance')}</h3>
          </div>
          <div className="card p-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <PerfCell label={t('funds.ytd')} value={fundPerformance.trailingReturns.ytd} />
              <PerfCell label={t('funds.oneYear')} value={fundPerformance.trailingReturns.oneYear} />
              <PerfCell label={t('funds.threeYear')} value={fundPerformance.trailingReturns.threeYear} />
              <PerfCell label={t('funds.fiveYear')} value={fundPerformance.trailingReturns.fiveYear} />
              <PerfCell label={t('funds.tenYear')} value={fundPerformance.trailingReturns.tenYear} />
            </div>
          </div>
        </div>
      )}

      {/* ─── Asset Allocation ─── */}
      {(stockPos > 0 || bondPos > 0 || cashPos > 0) && (
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <PieChart className="w-4 h-4 text-accent" />
            </div>
            <h3 className="text-base font-bold text-txt-primary">{t('funds.assetAllocation')}</h3>
          </div>
          <div className="card p-5">
            <div className="space-y-3">
              <AllocationBar label={locale === 'de' ? 'Aktien' : 'Stocks'} value={stockPos} color="#2962ff" />
              <AllocationBar label={locale === 'de' ? 'Anleihen' : 'Bonds'} value={bondPos} color="#26a69a" />
              <AllocationBar label={locale === 'de' ? 'Cash' : 'Cash'} value={cashPos} color="#ff9800" />
              {otherPos > 0.01 && (
                <AllocationBar label={locale === 'de' ? 'Sonstiges' : 'Other'} value={otherPos} color="#7c4dff" />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Sector Weightings ─── */}
      {topHoldings?.sectorWeightings && topHoldings.sectorWeightings.length > 0 && (
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <Layers className="w-4 h-4 text-accent" />
            </div>
            <h3 className="text-base font-bold text-txt-primary">{t('funds.sectorAllocation')}</h3>
          </div>
          <div className="card p-5">
            <div className="space-y-2.5">
              {topHoldings.sectorWeightings
                .map((entry: any) => {
                  const [name, value] = Object.entries(entry)[0] || [];
                  return { name: name as string, value: value as number };
                })
                .filter((s) => s.value && s.value > 0)
                .sort((a, b) => b.value - a.value)
                .map((s) => (
                  <AllocationBar
                    key={s.name}
                    label={formatSectorName(s.name)}
                    value={s.value}
                    color="#2962ff"
                  />
                ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Top Holdings ─── */}
      {topHoldings?.holdings && topHoldings.holdings.length > 0 && (
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <Briefcase className="w-4 h-4 text-accent" />
            </div>
            <h3 className="text-base font-bold text-txt-primary">{t('funds.topHoldings')}</h3>
            <span className="text-xs text-txt-muted bg-dark-700/40 px-2 py-0.5 rounded-full font-mono">
              {topHoldings.holdings.length}
            </span>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/10">
                  <th className="text-left px-5 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">
                    {t('funds.holding')}
                  </th>
                  <th className="text-left px-5 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider hidden md:table-cell">
                    Symbol
                  </th>
                  <th className="text-right px-5 py-3 text-xs text-txt-muted font-semibold uppercase tracking-wider">
                    {t('funds.weight')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {topHoldings.holdings.map((h: any, i: number) => (
                  <tr key={`${h.symbol || h.holdingName}-${i}`} className="border-b border-border/5 last:border-0 hover:bg-accent/[0.04] transition-all duration-200">
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-txt-primary font-medium">{h.holdingName}</span>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      <span className="font-mono font-bold text-sm text-accent">{h.symbol}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-sm font-mono text-txt-primary font-semibold">
                        {formatPercent((h.holdingPercent || 0) * 100)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-txt-secondary mb-1.5">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-base font-bold text-txt-primary truncate" title={value}>
        {value}
      </div>
    </div>
  );
}

function PerfCell({ label, value }: { label: string; value?: number }) {
  if (value == null) {
    return (
      <div className="text-center">
        <div className="text-[10px] text-txt-muted uppercase tracking-wider mb-1">{label}</div>
        <div className="text-sm text-txt-muted">—</div>
      </div>
    );
  }
  const pct = value * 100;
  const isPositive = pct >= 0;
  return (
    <div className="text-center">
      <div className="text-[10px] text-txt-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-base font-mono font-bold ${isPositive ? 'text-success' : 'text-danger'}`}>
        {formatPercent(pct)}
      </div>
    </div>
  );
}

function AllocationBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = value * 100;
  return (
    <div className="flex items-center gap-3 group">
      <div className="w-32 flex-shrink-0 text-xs text-txt-secondary truncate font-medium group-hover:text-txt-primary transition-colors" title={label}>
        {label}
      </div>
      <div className="flex-1 flex items-center">
        <div
          className="h-5 rounded-md"
          style={{
            width: `${Math.max(pct, 1)}%`,
            minWidth: '4px',
            transition: 'width 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            background: `linear-gradient(90deg, ${color}40 0%, ${color}99 100%)`,
          }}
        />
      </div>
      <div className="w-14 text-right text-xs font-mono font-semibold flex-shrink-0 text-txt-primary">
        {pct.toFixed(2)}%
      </div>
    </div>
  );
}

function formatSectorName(raw: string): string {
  // realestate → Real Estate, basic_materials → Basic Materials
  return raw
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
