import { useEffect, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { fetchFinancials, type FinancialsData } from '../api';
import { formatLargeNumber } from '../formatters';
import { useApp } from '../context';
import LoadingSpinner from './LoadingSpinner';

type StatementKey = 'income' | 'balance' | 'cashflow';

type Row = { key: string; label: string; bold?: boolean; growth?: boolean };

// Line items per statement (Yahoo field name → display label).
const INCOME_ROWS: Row[] = [
  { key: 'totalRevenue', label: 'Umsatz', bold: true, growth: true },
  { key: 'costOfRevenue', label: 'Umsatzkosten' },
  { key: 'grossProfit', label: 'Bruttogewinn', bold: true },
  { key: 'researchDevelopment', label: 'F&E' },
  { key: 'sellingGeneralAdministrative', label: 'Vertrieb & Verwaltung' },
  { key: 'totalOperatingExpenses', label: 'Betriebsaufwand' },
  { key: 'operatingIncome', label: 'Betriebsergebnis', bold: true },
  { key: 'incomeBeforeTax', label: 'Ergebnis vor Steuern' },
  { key: 'incomeTaxExpense', label: 'Steueraufwand' },
  { key: 'netIncome', label: 'Nettogewinn', bold: true, growth: true },
];

const BALANCE_ROWS: Row[] = [
  { key: 'cash', label: 'Barmittel' },
  { key: 'totalCurrentAssets', label: 'Umlaufvermögen' },
  { key: 'totalAssets', label: 'Bilanzsumme', bold: true },
  { key: 'totalCurrentLiabilities', label: 'Kurzfr. Verbindlichkeiten' },
  { key: 'longTermDebt', label: 'Langfr. Schulden' },
  { key: 'totalLiab', label: 'Verbindlichkeiten ges.', bold: true },
  { key: 'retainedEarnings', label: 'Gewinnrücklagen' },
  { key: 'totalStockholderEquity', label: 'Eigenkapital', bold: true },
];

const CASHFLOW_ROWS: Row[] = [
  { key: 'netIncome', label: 'Nettogewinn' },
  { key: 'depreciation', label: 'Abschreibungen' },
  { key: 'totalCashFromOperatingActivities', label: 'Operativer Cashflow', bold: true, growth: true },
  { key: 'capitalExpenditures', label: 'Investitionen (CapEx)' },
  { key: 'totalCashflowsFromInvestingActivities', label: 'Cashflow aus Investition', bold: true },
  { key: 'dividendsPaid', label: 'Dividenden' },
  { key: 'repurchaseOfStock', label: 'Aktienrückkäufe' },
  { key: 'totalCashFromFinancingActivities', label: 'Cashflow aus Finanzierung', bold: true },
];

export default function FinancialStatements({ symbol }: { symbol: string }) {
  const { locale } = useApp();
  const de = locale === 'de';
  const [tab, setTab] = useState<StatementKey>('income');
  const [data, setData] = useState<FinancialsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchFinancials(symbol)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  const statements = {
    income: data?.income || [],
    balance: data?.balance || [],
    cashflow: data?.cashflow || [],
  };

  const TABS: { key: StatementKey; label: string }[] = [
    { key: 'income', label: de ? 'Gewinn & Verlust' : 'Income' },
    { key: 'balance', label: de ? 'Bilanz' : 'Balance Sheet' },
    { key: 'cashflow', label: de ? 'Cashflow' : 'Cash Flow' },
  ];

  const ROWS = tab === 'income' ? INCOME_ROWS : tab === 'balance' ? BALANCE_ROWS : CASHFLOW_ROWS;
  // Most recent first
  const periods = [...statements[tab]].sort((a, b) => (b.endDate || 0) - (a.endDate || 0));

  const enLabels: Record<string, string> = {
    Umsatz: 'Revenue', Umsatzkosten: 'Cost of Revenue', Bruttogewinn: 'Gross Profit', 'F&E': 'R&D',
    'Vertrieb & Verwaltung': 'SG&A', Betriebsaufwand: 'Operating Expenses', Betriebsergebnis: 'Operating Income',
    'Ergebnis vor Steuern': 'Pretax Income', Steueraufwand: 'Tax Expense', Nettogewinn: 'Net Income',
    Barmittel: 'Cash', Umlaufvermögen: 'Current Assets', Bilanzsumme: 'Total Assets',
    'Kurzfr. Verbindlichkeiten': 'Current Liabilities', 'Langfr. Schulden': 'Long-Term Debt',
    'Verbindlichkeiten ges.': 'Total Liabilities', Gewinnrücklagen: 'Retained Earnings', Eigenkapital: 'Equity',
    Abschreibungen: 'Depreciation', 'Operativer Cashflow': 'Operating Cash Flow', 'Investitionen (CapEx)': 'CapEx',
    'Cashflow aus Investition': 'Investing Cash Flow', Dividenden: 'Dividends Paid', Aktienrückkäufe: 'Buybacks',
    'Cashflow aus Finanzierung': 'Financing Cash Flow',
  };
  const label = (l: string) => (de ? l : enLabels[l] || l);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <LoadingSpinner text={de ? 'Lade Finanzberichte...' : 'Loading financials...'} />
      </div>
    );
  }

  if (!periods.length) {
    return (
      <div className="card p-8 text-center text-sm text-txt-muted">
        {de ? 'Keine Finanzberichte verfügbar (z. B. bei ETFs/Indizes).' : 'No financial statements available.'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="p-1.5 rounded-lg bg-accent/10">
          <FileSpreadsheet className="w-4 h-4 text-accent" />
        </div>
        <h3 className="section-title">{de ? 'Finanzberichte (jährlich)' : 'Financial Statements (annual)'}</h3>
        <div className="ml-auto flex gap-0.5 bg-dark-700/60 ring-1 ring-border/10 rounded-xl p-1">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all duration-200 ${
                tab === tb.key ? 'bg-accent text-white shadow-glow-sm' : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40'
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-txt-muted border-b border-border/20">
              <th className="text-left font-semibold px-4 py-2.5 sticky left-0 bg-dark-800/80 backdrop-blur">
                {de ? 'Position' : 'Line Item'}
              </th>
              {periods.map((p) => (
                <th key={p.endDate} className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                  {p.endDate ? new Date(p.endDate * 1000).getFullYear() : '—'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key} className="border-b border-border/5 hover:bg-dark-700/30 transition-colors">
                <td className={`px-4 py-2 sticky left-0 bg-dark-800/60 backdrop-blur ${row.bold ? 'font-semibold text-txt-primary' : 'text-txt-secondary'}`}>
                  {label(row.label)}
                </td>
                {periods.map((p, i) => {
                  const v = p[row.key] as number | undefined;
                  const prev = periods[i + 1]?.[row.key] as number | undefined;
                  const growth = row.growth && v != null && prev != null && prev !== 0 ? ((v - prev) / Math.abs(prev)) * 100 : null;
                  return (
                    <td key={p.endDate} className={`px-4 py-2 text-right font-mono tabular-nums whitespace-nowrap ${row.bold ? 'font-semibold text-txt-primary' : 'text-txt-secondary'}`}>
                      {v != null ? formatLargeNumber(v) : '—'}
                      {growth != null && (
                        <span className={`ml-1.5 text-[10px] ${growth >= 0 ? 'text-success' : 'text-danger'}`}>
                          {growth >= 0 ? '+' : ''}{growth.toFixed(0)}%
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-txt-muted px-1">
        {de ? 'Werte in Berichtswährung. Quelle: Yahoo Finance.' : 'Values in reporting currency. Source: Yahoo Finance.'}
      </p>
    </div>
  );
}
