import axios from 'axios';
import type {
  QuoteData,
  OHLCVData,
  SearchResult,
  NewsItem,
  FundamentalsData,
  TimeRange,
  ChartInterval,
} from './types';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

export async function fetchQuote(symbol: string): Promise<QuoteData> {
  const { data } = await api.get(`/quote/${encodeURIComponent(symbol)}`);
  return data;
}

export async function fetchQuotes(symbols: string[]): Promise<QuoteData[]> {
  if (!symbols.length) return [];
  const { data } = await api.get('/quotes', {
    params: { symbols: symbols.join(',') },
  });
  return data;
}

export async function fetchChart(
  symbol: string,
  range: TimeRange = '1y',
  interval: ChartInterval = '1d'
): Promise<{ meta: any; quotes: OHLCVData[] }> {
  const { data } = await api.get(`/chart/${encodeURIComponent(symbol)}`, {
    params: { range, interval },
  });
  return data;
}

export interface DividendPayment {
  date: number;   // unix seconds
  amount: number; // per-share, native currency
}

export async function fetchDividends(symbol: string): Promise<DividendPayment[]> {
  const { data } = await api.get(`/dividends/${encodeURIComponent(symbol)}`);
  return Array.isArray(data) ? data : [];
}

export async function searchSymbols(query: string): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const { data } = await api.get('/search', { params: { q: query } });
  return data.quotes || [];
}

export type StatementPeriod = Record<string, number | undefined> & { endDate?: number };
export interface FinancialsData {
  income: StatementPeriod[];
  balance: StatementPeriod[];
  cashflow: StatementPeriod[];
}

export async function fetchFinancials(symbol: string): Promise<FinancialsData> {
  const { data } = await api.get(`/financials/${encodeURIComponent(symbol)}`);
  return data;
}

export async function fetchFundamentals(symbol: string): Promise<FundamentalsData> {
  const { data } = await api.get(`/fundamentals/${encodeURIComponent(symbol)}`);
  return data;
}

export async function fetchNews(symbol: string): Promise<NewsItem[]> {
  const { data } = await api.get(`/news/${encodeURIComponent(symbol)}`);
  return data;
}

export interface CalendarEvent {
  symbol: string;
  name: string;
  /** Next earnings report date (unix seconds), if known. */
  earningsDate: number | null;
  /** Consensus EPS estimate for the upcoming report. */
  earningsEstimate: number | null;
  /** Ex-dividend date (unix seconds). */
  exDividendDate: number | null;
  /** Dividend payment date (unix seconds). */
  dividendDate: number | null;
  /** Annual dividend per share. */
  dividendRate: number | null;
  /** Forward dividend yield (fraction, e.g. 0.015). */
  dividendYield: number | null;
}

export async function fetchCalendarEvents(symbols: string[]): Promise<CalendarEvent[]> {
  if (!symbols.length) return [];
  const { data } = await api.get('/calendar-events', {
    params: { symbols: symbols.join(',') },
  });
  return data;
}

export async function fetchSparklines(symbols: string[]): Promise<Record<string, number[]>> {
  if (!symbols.length) return {};
  const { data } = await api.get('/sparklines', {
    params: { symbols: symbols.join(',') },
  });
  return data;
}

// ─── Heatmap ───

export interface HeatmapStock {
  symbol: string;
  shortName: string;
  price: number;
  changePercent: number;
  marketCap: number;
}

export async function fetchHeatmap(): Promise<Record<string, HeatmapStock[]>> {
  const { data } = await api.get('/heatmap');
  return data;
}

// ─── Screener ───

export interface ScreenerStock {
  symbol: string;
  shortName: string;
  price: number;
  changePercent: number;
  marketCap: number;
  volume: number;
  pe: number | null;
  forwardPE: number | null;
  dividendYield: number | null;
  sector: string;
  exchange: string;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  currency?: string;
  quoteType?: string;
}

export async function fetchScreener(): Promise<ScreenerStock[]> {
  const { data } = await api.get('/screener');
  return data;
}

// ─── Index Constituents ───

export async function fetchIndexConstituents(indexSymbol: string): Promise<ScreenerStock[]> {
  const { data } = await api.get(`/index-constituents/${encodeURIComponent(indexSymbol)}`);
  return data;
}

// ─── Global Markets ───

export interface GlobalMarketIndex {
  symbol: string;
  shortName: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  exchange?: string;
  marketState?: string;
}

export async function fetchGlobalMarkets(): Promise<Record<string, GlobalMarketIndex[]>> {
  const { data } = await api.get('/globalmarkets');
  return data;
}

// ─── Exchange Rate ───

export interface ExchangeRateResult {
  rate: number;
  from: string;
  to: string;
}

export async function fetchExchangeRate(from = 'USD', to = 'EUR'): Promise<ExchangeRateResult> {
  const { data } = await api.get('/exchangerate', { params: { from, to } });
  return data;
}

// Helper: determine interval based on range
export function getIntervalForRange(range: TimeRange): ChartInterval {
  switch (range) {
    case '1d':
      return '5m';
    case '5d':
      return '15m';
    case '1mo':
      return '1h';
    default:
      return '1d';
  }
}
