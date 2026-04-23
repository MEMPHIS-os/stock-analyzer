export interface OHLCVData {
  date: string | number; // string "YYYY-MM-DD" for daily, unix timestamp (seconds) for intraday
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface QuoteData {
  symbol: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketVolume: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  regularMarketOpen: number;
  regularMarketPreviousClose: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  marketCap?: number;
  averageVolume?: number;
  currency?: string;
  exchange?: string;
  exchangeTimezoneName?: string;
}

export interface SearchResult {
  symbol: string;
  shortname: string;
  exchange: string;
  type: string;
}

export interface NewsItem {
  title: string;
  link: string;
  publisher: string;
  publishedAt: string | number;
  thumbnail: string | null;
}

export interface FundamentalsData {
  summaryDetail?: {
    trailingPE?: number;
    forwardPE?: number;
    priceToBook?: number;
    dividendYield?: number;
    dividendRate?: number;
    payoutRatio?: number;
    beta?: number;
    marketCap?: number;
    fiftyTwoWeekHigh?: number;
    fiftyTwoWeekLow?: number;
    fiftyDayAverage?: number;
    twoHundredDayAverage?: number;
    volume?: number;
    averageVolume?: number;
  };
  financialData?: {
    currentPrice?: number;
    targetHighPrice?: number;
    targetLowPrice?: number;
    targetMeanPrice?: number;
    recommendationKey?: string;
    numberOfAnalystOpinions?: number;
    totalRevenue?: number;
    revenuePerShare?: number;
    grossProfits?: number;
    ebitda?: number;
    totalDebt?: number;
    totalCash?: number;
    operatingMargins?: number;
    profitMargins?: number;
    returnOnEquity?: number;
    returnOnAssets?: number;
    earningsGrowth?: number;
    revenueGrowth?: number;
    debtToEquity?: number;
    currentRatio?: number;
    freeCashflow?: number;
  };
  defaultKeyStatistics?: {
    enterpriseValue?: number;
    forwardPE?: number;
    pegRatio?: number;
    priceToSalesTrailing12Months?: number;
    enterpriseToRevenue?: number;
    enterpriseToEbitda?: number;
    sharesOutstanding?: number;
    floatShares?: number;
    shortRatio?: number;
    shortPercentOfFloat?: number;
    bookValue?: number;
    earningsQuarterlyGrowth?: number;
  };
  summaryProfile?: {
    sector?: string;
    industry?: string;
    fullTimeEmployees?: number;
    longBusinessSummary?: string;
    website?: string;
    country?: string;
    city?: string;
  };
  earnings?: {
    earningsChart?: {
      quarterly?: Array<{ date: string; actual: number; estimate: number }>;
    };
    financialsChart?: {
      yearly?: Array<{ date: number; revenue: number; earnings: number }>;
    };
  };
}

export type TimeRange = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' | 'max';
export type ChartInterval = '1m' | '5m' | '15m' | '1h' | '1d' | '1wk' | '1mo';
export type ChartType = 'candlestick' | 'heikinashi' | 'line' | 'area';

export type IndicatorType =
  | 'sma20'
  | 'sma50'
  | 'sma200'
  | 'ema12'
  | 'ema26'
  | 'bb'
  | 'rsi'
  | 'macd'
  | 'stochastic'
  | 'atr'
  | 'vwap'
  | 'williamsR'
  | 'ichimoku'
  | 'pivotPoints';

export interface WatchlistItem {
  symbol: string;
  name: string;
  addedAt: number;
  group?: string; // e.g. "Tech", "Finance", "Favoriten"
}
