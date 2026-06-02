import { useEffect, useState } from 'react';
import { BarChart3, DollarSign, TrendingUp, Building2, AlertCircle } from 'lucide-react';
import { fetchFundamentals } from '../api';
import {
  formatLargeNumber,
  formatRatio,
  formatMarginPercent,
} from '../formatters';
import { useApp } from '../context';
import { usePrice } from '../hooks/usePrice';
import type { FundamentalsData } from '../types';

interface FundamentalsPanelProps {
  symbol: string;
  currency?: string;
}

function sentimentFor(val: number | undefined | null): 'positive' | 'negative' | undefined {
  if (val == null || val === 0) return undefined;
  return val > 0 ? 'positive' : 'negative';
}

function StatRow({
  label,
  value,
  highlight,
  sentiment,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  sentiment?: 'positive' | 'negative';
}) {
  const colorClass =
    sentiment === 'positive'
      ? 'text-success font-semibold'
      : sentiment === 'negative'
        ? 'text-danger font-semibold'
        : highlight
          ? 'text-accent font-semibold'
          : 'text-txt-primary';

  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border/5 last:border-0">
      <span className="text-xs text-txt-secondary">{label}</span>
      <span className={`text-xs font-mono tabular-nums ${colorClass}`}>
        {value}
        {sentiment && (
          <span className="ml-1 text-[10px] opacity-70">{sentiment === 'positive' ? '▲' : '▼'}</span>
        )}
      </span>
    </div>
  );
}

function EarningsBarChart({ yearly }: { yearly: Array<{ date: number; revenue: number; earnings: number }> }) {
  if (!yearly.length) return null;
  const maxRevenue = Math.max(...yearly.map((y) => Math.abs(y.revenue)));

  return (
    <div className="space-y-3 mt-2">
      {yearly.map((year) => {
        const revPct = maxRevenue > 0 ? (Math.abs(year.revenue) / maxRevenue) * 100 : 0;
        const earnPct = maxRevenue > 0 ? (Math.abs(year.earnings) / maxRevenue) * 100 : 0;
        const isProfit = year.earnings >= 0;

        return (
          <div key={year.date}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-mono text-txt-secondary">{year.date}</span>
              <div className="flex gap-3 text-[10px]">
                <span className="text-accent">Umsatz: {formatLargeNumber(year.revenue)}</span>
                <span className={isProfit ? 'text-success' : 'text-danger'}>
                  Gewinn: {formatLargeNumber(year.earnings)}
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="h-3 bg-dark-600 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent/60 rounded-full transition-all"
                  style={{ width: `${revPct}%` }}
                />
              </div>
              <div className="h-2.5 bg-dark-600 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${isProfit ? 'bg-success/60' : 'bg-danger/60'}`}
                  style={{ width: `${earnPct}%` }}
                />
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex gap-4 text-[10px] text-txt-muted mt-1">
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm bg-accent/60" />
          Umsatz
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm bg-success/60" />
          Gewinn
        </div>
      </div>
    </div>
  );
}

export default function FundamentalsPanel({ symbol, currency }: FundamentalsPanelProps) {
  const { locale } = useApp();
  const { fp } = usePrice();
  const cur = currency || 'USD';
  const [data, setData] = useState<FundamentalsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchFundamentals(symbol)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError('Fundamentaldaten konnten nicht geladen werden.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (loading) {
    return (
      <div className="animate-slide-up space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-44 rounded-2xl skeleton-shimmer" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-danger p-4">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  if (!data) return null;

  const sd = data.summaryDetail;
  const fd = data.financialData;
  const ks = data.defaultKeyStatistics;
  const sp = data.summaryProfile;
  const earnings = data.earnings;

  return (
    <div className="animate-slide-up space-y-4">
      {/* Company Profile */}
      {sp && (
        <div className="card p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <Building2 className="w-4 h-4 text-accent" />
            </div>
            <h3 className="text-sm font-bold text-txt-primary">Unternehmensprofil</h3>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {sp.sector && (
              <div>
                <div className="stat-label">Sektor</div>
                <div className="text-xs text-txt-primary">{sp.sector}</div>
              </div>
            )}
            {sp.industry && (
              <div>
                <div className="stat-label">Branche</div>
                <div className="text-xs text-txt-primary">{sp.industry}</div>
              </div>
            )}
            {sp.fullTimeEmployees && (
              <div>
                <div className="stat-label">Mitarbeiter</div>
                <div className="text-xs text-txt-primary">
                  {sp.fullTimeEmployees.toLocaleString('de-DE')}
                </div>
              </div>
            )}
          </div>
          {sp.longBusinessSummary && (
            <p className="text-xs text-txt-secondary leading-relaxed line-clamp-3">
              {sp.longBusinessSummary}
            </p>
          )}
        </div>
      )}

      {/* Valuation */}
      <div className="card p-4">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="p-1.5 rounded-lg bg-accent/10">
            <DollarSign className="w-4 h-4 text-accent" />
          </div>
          <h3 className="text-sm font-bold text-txt-primary">Bewertung</h3>
        </div>
        <StatRow label="Marktkapitalisierung" value={formatLargeNumber(sd?.marketCap)} />
        <StatRow label="KGV (Trailing)" value={formatRatio(sd?.trailingPE)} highlight />
        <StatRow label="KGV (Forward)" value={formatRatio(sd?.forwardPE || ks?.forwardPE)} />
        <StatRow label="KBV" value={formatRatio(sd?.priceToBook)} />
        <StatRow label="PEG Ratio" value={formatRatio(ks?.pegRatio)} />
        <StatRow label="KUV" value={formatRatio(ks?.priceToSalesTrailing12Months)} />
        <StatRow label="EV/Revenue" value={formatRatio(ks?.enterpriseToRevenue)} />
        <StatRow label="EV/EBITDA" value={formatRatio(ks?.enterpriseToEbitda)} />
        <StatRow label="Enterprise Value" value={formatLargeNumber(ks?.enterpriseValue)} />
      </div>

      {/* Financial Health */}
      <div className="card p-4">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="p-1.5 rounded-lg bg-accent/10">
            <BarChart3 className="w-4 h-4 text-accent" />
          </div>
          <h3 className="text-sm font-bold text-txt-primary">Finanzkennzahlen</h3>
        </div>
        <StatRow label="Umsatz" value={formatLargeNumber(fd?.totalRevenue)} />
        <StatRow label="EBITDA" value={formatLargeNumber(fd?.ebitda)} />
        <StatRow label="Bruttomarge" value={formatMarginPercent(fd?.operatingMargins)} sentiment={sentimentFor(fd?.operatingMargins)} />
        <StatRow label="Gewinnmarge" value={formatMarginPercent(fd?.profitMargins)} highlight sentiment={sentimentFor(fd?.profitMargins)} />
        <StatRow label="ROE" value={formatMarginPercent(fd?.returnOnEquity)} sentiment={sentimentFor(fd?.returnOnEquity)} />
        <StatRow label="ROA" value={formatMarginPercent(fd?.returnOnAssets)} sentiment={sentimentFor(fd?.returnOnAssets)} />
        <StatRow label="Umsatzwachstum" value={formatMarginPercent(fd?.revenueGrowth)} sentiment={sentimentFor(fd?.revenueGrowth)} />
        <StatRow label="Gewinnwachstum" value={formatMarginPercent(fd?.earningsGrowth)} sentiment={sentimentFor(fd?.earningsGrowth)} />
        <StatRow label="Free Cashflow" value={formatLargeNumber(fd?.freeCashflow)} sentiment={sentimentFor(fd?.freeCashflow)} />
        <StatRow label="Verschuldungsgrad" value={formatRatio(fd?.debtToEquity)} sentiment={fd?.debtToEquity != null ? (fd.debtToEquity > 150 ? 'negative' : 'positive') : undefined} />
        <StatRow label="Current Ratio" value={formatRatio(fd?.currentRatio)} sentiment={fd?.currentRatio != null ? (fd.currentRatio >= 1 ? 'positive' : 'negative') : undefined} />
      </div>

      {/* Dividends */}
      {(sd?.dividendYield || sd?.dividendRate) && (
        <div className="card p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <TrendingUp className="w-4 h-4 text-accent" />
            </div>
            <h3 className="text-sm font-bold text-txt-primary">Dividende</h3>
          </div>
          <StatRow label="Dividendenrendite" value={formatMarginPercent(sd.dividendYield)} highlight sentiment={sd.dividendYield ? 'positive' : undefined} />
          <StatRow label="Dividende/Aktie" value={fp(sd.dividendRate, cur)} />
          <StatRow label="Ausschüttungsquote" value={formatMarginPercent(sd.payoutRatio)} />
        </div>
      )}

      {/* Analyst Targets */}
      {fd?.targetMeanPrice && (
        <div className="card p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <TrendingUp className="w-4 h-4 text-accent" />
            </div>
            <h3 className="text-sm font-bold text-txt-primary">Analysten-Ziel</h3>
          </div>
          <StatRow label="Durchschn. Zielkurs" value={fp(fd.targetMeanPrice, cur)} highlight />
          <StatRow label="Höchstes Ziel" value={fp(fd.targetHighPrice, cur)} />
          <StatRow label="Niedrigstes Ziel" value={fp(fd.targetLowPrice, cur)} />
          <StatRow label="Empfehlung" value={fd.recommendationKey?.toUpperCase() || '—'} />
          <StatRow
            label="Anzahl Analysten"
            value={fd.numberOfAnalystOpinions?.toString() || '—'}
          />
        </div>
      )}

      {/* Earnings Bar Chart */}
      {earnings?.financialsChart?.yearly && earnings.financialsChart.yearly.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <BarChart3 className="w-4 h-4 text-accent" />
            </div>
            <h3 className="text-sm font-bold text-txt-primary">Jährliche Finanzen</h3>
          </div>
          <EarningsBarChart yearly={earnings.financialsChart.yearly} />
        </div>
      )}
    </div>
  );
}
