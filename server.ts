import express from 'express';
import cors from 'cors';
import https from 'https';
import path from 'path';
import fs from 'fs';

// ─── Persistent Cache (file-backed) ───
const CACHE_FILE = path.join(
  process.env.APPDATA || process.env.HOME || '.',
  'StockAnalyzer',
  'cache.json'
);

let diskCache: Record<string, { data: any; expires: number }> = {};

const DISK_CACHE_MAX_ENTRIES = 1000;

// Drop expired entries and enforce a size cap (oldest-expiring first) so
// cache.json cannot grow without bound over weeks of use.
function pruneDiskCache() {
  const now = Date.now();
  for (const key of Object.keys(diskCache)) {
    if (now >= diskCache[key].expires) delete diskCache[key];
  }
  const keys = Object.keys(diskCache);
  if (keys.length > DISK_CACHE_MAX_ENTRIES) {
    keys.sort((a, b) => diskCache[a].expires - diskCache[b].expires);
    for (const key of keys.slice(0, keys.length - DISK_CACHE_MAX_ENTRIES)) {
      delete diskCache[key];
    }
  }
}

function loadDiskCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      diskCache = JSON.parse(raw);
      pruneDiskCache();
      console.log(`  Loaded ${Object.keys(diskCache).length} cached entries from disk`);
    }
  } catch { /* ignore corrupt cache */ }
}

function saveDiskCache() {
  try {
    pruneDiskCache();
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFile(CACHE_FILE, JSON.stringify(diskCache), 'utf-8', () => { /* ignore write errors */ });
  } catch { /* ignore write errors */ }
}

// Debounce disk writes to avoid I/O spam
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDiskCache, 5000);
}

// Load on startup
loadDiskCache();

export function createApp() {
  const app = express();
  // Local companion server: only the app's own localhost origins may read
  // responses cross-origin (dev goes through the Vite proxy anyway).
  app.use(cors({
    origin: [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/],
  }));
  // Reject non-local Host headers (DNS-rebinding protection).
  const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
  app.use((req, res, next) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    if (ALLOWED_HOSTS.has(host)) return next();
    res.status(403).json({ error: 'Forbidden' });
  });
  app.use(express.json());

// ─── Response Cache (memory + disk fallback) ───
const cache = new Map<string, { data: any; expires: number }>();

function getCached(key: string): any | null {
  // Memory cache only. A miss MUST return null so the endpoint performs a fresh
  // fetch — otherwise live data (quotes, indices, …) would freeze on first load.
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expires) return entry.data;
  if (entry) cache.delete(key);
  return null;
}

// Stale disk-backed fallback — only used inside endpoint catch blocks when a
// live fetch fails (offline mode / Yahoo outage). Returns data regardless of age.
function getStale(key: string): any | null {
  const disk = diskCache[key];
  return disk ? disk.data : null;
}

function setCache(key: string, data: any, ttlMs: number) {
  const entry = { data, expires: Date.now() + ttlMs };
  cache.set(key, entry);
  // Persist to disk with longer TTL (24h) for offline fallback
  diskCache[key] = { data, expires: Date.now() + 86_400_000 };
  scheduleSave();
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now >= v.expires) cache.delete(k);
    }
  }
}

// ─── Yahoo Finance Auth (crumb + cookie) ───
let _cookie = '';
let _crumb = '';
let _crumbExpiry = 0;

function httpsGet(url: string, cookie?: string, maxRedirects = 3): Promise<{ status: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(cookie ? { Cookie: cookie } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      // Follow redirects (301, 302, 303, 307, 308)
      if (maxRedirects > 0 && res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://${u.hostname}${res.headers.location}`;
        res.resume(); // drain response
        httpsGet(redirectUrl, cookie, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function ensureCrumb(): Promise<{ cookie: string; crumb: string }> {
  if (_cookie && _crumb && Date.now() < _crumbExpiry) {
    return { cookie: _cookie, crumb: _crumb };
  }

  const r1 = await httpsGet('https://fc.yahoo.com/');
  const rawCookie = (r1.headers['set-cookie'] || [])[0] || '';
  const cookie = rawCookie.split(';')[0];
  if (!cookie) throw new Error('Failed to get Yahoo cookie');

  const r2 = await httpsGet('https://query2.finance.yahoo.com/v1/test/getcrumb', cookie);
  if (r2.status !== 200 || !r2.body) throw new Error('Failed to get crumb');

  _cookie = cookie;
  _crumb = r2.body;
  _crumbExpiry = Date.now() + 20 * 60 * 1000;

  console.log('  Yahoo auth refreshed (crumb acquired)');
  return { cookie, crumb: r2.body };
}

async function yahooFetch(url: string, retries = 3): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { cookie, crumb } = await ensureCrumb();
      const separator = url.includes('?') ? '&' : '?';
      const fullUrl = `${url}${separator}crumb=${encodeURIComponent(crumb)}`;
      const res = await httpsGet(fullUrl, cookie);

      if (res.status === 401) {
        _crumbExpiry = 0;
        const auth = await ensureCrumb();
        const retryUrl = `${url}${separator}crumb=${encodeURIComponent(auth.crumb)}`;
        const retry = await httpsGet(retryUrl, auth.cookie);
        if (retry.status !== 200) throw new Error(`Yahoo API ${retry.status}`);
        return JSON.parse(retry.body);
      }

      if (res.status !== 200) throw new Error(`Yahoo API ${res.status}`);
      return JSON.parse(res.body);
    } catch (err: any) {
      if (attempt === retries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
      console.log(`  Retry ${attempt}/${retries} after ${delay}ms: ${err.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ─── Unwrap Yahoo v10 nested {raw, fmt} objects ───
function unwrapYahoo(obj: any): any {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(unwrapYahoo);
  if ('raw' in obj && ('fmt' in obj || 'longFmt' in obj)) return obj.raw;
  const result: any = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = unwrapYahoo(v);
  }
  return result;
}

// ─── v8 Chart Fallback (no auth needed) ───
// When v7 quote fails, extract basic price data from v8 chart API
async function v8QuoteFallback(symbol: string): Promise<any | null> {
  try {
    const r = await httpsGet(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`
    );
    if (r.status !== 200) return null;
    const data = JSON.parse(r.body);
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    return {
      symbol: meta.symbol,
      shortName: meta.shortName || meta.symbol,
      longName: meta.longName || meta.shortName || meta.symbol,
      regularMarketPrice: meta.regularMarketPrice,
      regularMarketChange: (meta.regularMarketPrice || 0) - (meta.chartPreviousClose || meta.previousClose || 0),
      regularMarketChangePercent: (meta.chartPreviousClose && meta.regularMarketPrice != null)
        ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100
        : 0,
      currency: meta.currency || 'USD',
      exchange: meta.exchangeName,
      marketCap: null,
      regularMarketVolume: meta.regularMarketVolume || null,
    };
  } catch {
    return null;
  }
}

// ─── Quote (v7 with v8 fallback) ───
app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const cacheKey = `quote:${symbol}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const data = await yahooFetch(
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`
    );
    const q = data?.quoteResponse?.result?.[0];
    if (!q) throw new Error('No data');

    setCache(cacheKey, q, 15_000);
    res.json(q);
  } catch (error: any) {
    console.error(`Quote error for ${req.params.symbol}:`, error.message);
    // Fallback: try v8 chart API (no auth needed)
    const fallback = await v8QuoteFallback(req.params.symbol);
    if (fallback) return res.json(fallback);
    // Last resort: stale cached data (offline mode)
    const stale = getStale(`quote:${req.params.symbol}`);
    if (stale) return res.json(stale);
    res.status(500).json({ error: 'Failed to fetch quote' });
  }
});

// ─── Multiple quotes ───
app.get('/api/quotes', async (req, res) => {
  try {
    const symbols = (req.query.symbols as string || '').split(',').filter(Boolean);
    if (!symbols.length) return res.json([]);

    const cacheKey = `quotes:${symbols.sort().join(',')}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const data = await yahooFetch(
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols.map(s => encodeURIComponent(s.trim())).join(',')}`
    );
    const result = data?.quoteResponse?.result || [];

    setCache(cacheKey, result, 15_000);
    res.json(result);
  } catch (error: any) {
    console.error('Quotes error:', error.message);
    // Fallback: try v8 chart API individually (no auth needed, capped fan-out)
    const symbols = (req.query.symbols as string || '').split(',').filter(Boolean);
    const fallbacks = await Promise.all(symbols.slice(0, 60).map(s => v8QuoteFallback(s.trim())));
    const validFallbacks = fallbacks.filter(Boolean);
    if (validFallbacks.length > 0) return res.json(validFallbacks);
    // Last resort: stale cached data (offline mode)
    const stale = getStale(`quotes:${symbols.sort().join(',')}`);
    if (stale) return res.json(stale);
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

// ─── Chart data (v8 - no auth needed) ───
const CHART_RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);
const CHART_INTERVALS = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo']);

app.get('/api/chart/:symbol', async (req, res) => {
  const range = String(req.query.range ?? '1y');
  const interval = String(req.query.interval ?? '1d');
  if (!CHART_RANGES.has(range) || !CHART_INTERVALS.has(interval)) {
    return res.status(400).json({ error: 'Invalid range/interval' });
  }
  try {
    const { symbol } = req.params;

    const cacheKey = `chart:${symbol}:${range}:${interval}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const r = await httpsGet(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`
    );
    const data = JSON.parse(r.body);
    const chartResult = data?.chart?.result?.[0];
    if (!chartResult) throw new Error('No data');

    const ts = chartResult.timestamp || [];
    const ohlcv = chartResult.indicators?.quote?.[0] || {};

    // Intraday intervals need unix timestamps (seconds) for lightweight-charts;
    // daily+ intervals use YYYY-MM-DD date strings. Shift by the exchange's GMT
    // offset so the calendar day matches the exchange's local trading day.
    const isIntraday = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h'].includes(interval);
    const gmtOffset = chartResult.meta?.gmtoffset ?? 0;

    const quotes = ts.map((t: number, i: number) => ({
      date: isIntraday ? t : new Date((t + gmtOffset) * 1000).toISOString().split('T')[0],
      open: ohlcv.open?.[i],
      high: ohlcv.high?.[i],
      low: ohlcv.low?.[i],
      close: ohlcv.close?.[i],
      volume: ohlcv.volume?.[i],
    })).filter((q: any) => q.open != null && q.close != null);

    const result = { meta: chartResult.meta, quotes };

    // Chart data: 5min cache for intraday, 10min for daily+
    const ttl = (range === '1d' || range === '5d') ? 60_000 : 600_000;
    setCache(cacheKey, result, ttl);
    res.json(result);
  } catch (error: any) {
    console.error(`Chart error for ${req.params.symbol}:`, error.message);
    const stale = getStale(`chart:${req.params.symbol}:${range}:${interval}`);
    if (stale) return res.json(stale);
    res.status(500).json({ error: 'Failed to fetch chart data' });
  }
});

// ─── Search ───
app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q as string) || '';
    if (!q.trim()) return res.json({ quotes: [] });

    const cacheKey = `search:${q.toLowerCase().trim()}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const r = await httpsGet(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableFuzzyQuery=true`
    );
    const data = JSON.parse(r.body);

    const quotes = (data.quotes || [])
      .filter((item: any) => item.isYahooFinance !== false)
      .map((item: any) => ({
        symbol: item.symbol,
        shortname: item.shortname || item.longname || item.symbol,
        exchange: item.exchDisp || item.exchange,
        type: item.quoteType || item.typeDisp,
      }));

    const result = { quotes };
    setCache(cacheKey, result, 60_000);
    res.json(result);
  } catch (error: any) {
    console.error('Search error:', error.message);
    const q = (req.query.q as string) || '';
    const stale = getStale(`search:${q.toLowerCase().trim()}`);
    if (stale) return res.json(stale);
    res.status(500).json({ error: 'Failed to search' });
  }
});

// ─── Fundamentals (v10 quoteSummary - needs auth) ───
app.get('/api/fundamentals/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;

    const cacheKey = `fundamentals:${symbol}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Always include both stock and fund modules — Yahoo silently ignores irrelevant ones.
    // Fund-specific: fundProfile, topHoldings, fundPerformance
    const modules = [
      'summaryDetail',
      'financialData',
      'defaultKeyStatistics',
      'earnings',
      'summaryProfile',
      'fundProfile',
      'topHoldings',
      'fundPerformance',
    ].join(',');

    const data = await yahooFetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`
    );

    const raw = data?.quoteSummary?.result?.[0];
    if (!raw) throw new Error('No data');

    // Unwrap Yahoo's nested {raw, fmt} objects to flat values
    const result = unwrapYahoo(raw);

    setCache(cacheKey, result, 900_000);
    res.json(result);
  } catch (error: any) {
    console.error(`Fundamentals error for ${req.params.symbol}:`, error.message);
    const stale = getStale(`fundamentals:${req.params.symbol}`);
    if (stale) return res.json(stale);
    res.status(500).json({ error: 'Failed to fetch fundamentals' });
  }
});

// ─── Financial statements (fundamentals-timeseries API) ───
// Yahoo deprecated the detailed fields in the legacy quoteSummary statement
// modules; the data now lives in the fundamentals-timeseries endpoint. We map
// the new taxonomy back to the classic field names the client renders.
const FIN_MAP: Record<'income' | 'balance' | 'cashflow', Record<string, string>> = {
  income: {
    annualTotalRevenue: 'totalRevenue',
    annualCostOfRevenue: 'costOfRevenue',
    annualGrossProfit: 'grossProfit',
    annualResearchAndDevelopment: 'researchDevelopment',
    annualSellingGeneralAndAdministration: 'sellingGeneralAdministrative',
    annualOperatingExpense: 'totalOperatingExpenses',
    annualOperatingIncome: 'operatingIncome',
    annualPretaxIncome: 'incomeBeforeTax',
    annualTaxProvision: 'incomeTaxExpense',
    annualNetIncome: 'netIncome',
  },
  balance: {
    annualCashAndCashEquivalents: 'cash',
    annualCurrentAssets: 'totalCurrentAssets',
    annualTotalAssets: 'totalAssets',
    annualCurrentLiabilities: 'totalCurrentLiabilities',
    annualLongTermDebt: 'longTermDebt',
    annualTotalLiabilitiesNetMinorityInterest: 'totalLiab',
    annualRetainedEarnings: 'retainedEarnings',
    annualStockholdersEquity: 'totalStockholderEquity',
  },
  cashflow: {
    annualNetIncome: 'netIncome',
    annualDepreciationAndAmortization: 'depreciation',
    annualOperatingCashFlow: 'totalCashFromOperatingActivities',
    annualCapitalExpenditure: 'capitalExpenditures',
    annualInvestingCashFlow: 'totalCashflowsFromInvestingActivities',
    annualCashDividendsPaid: 'dividendsPaid',
    annualRepurchaseOfCapitalStock: 'repurchaseOfStock',
    annualFinancingCashFlow: 'totalCashFromFinancingActivities',
  },
};

app.get('/api/financials/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const cacheKey = `financials:${symbol}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Which statement does each requested type belong to?
    const typeToStatement: Record<string, 'income' | 'balance' | 'cashflow'> = {};
    const allTypes: string[] = [];
    (Object.keys(FIN_MAP) as Array<'income' | 'balance' | 'cashflow'>).forEach((stmt) => {
      for (const t of Object.keys(FIN_MAP[stmt])) {
        // a type can map to two statements (annualNetIncome); request once, fan out below
        if (!allTypes.includes(t)) allTypes.push(t);
        typeToStatement[t] = stmt; // last wins; fan-out handled in parse
      }
    });

    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - 6 * 366 * 86400; // ~6 years back
    const url =
      `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(symbol)}` +
      `?symbol=${encodeURIComponent(symbol)}&type=${allTypes.join(',')}&period1=${period1}&period2=${period2}&merge=false`;

    const data = await yahooFetch(url);
    const results: any[] = data?.timeseries?.result || [];

    // statement → asOfDate → { endDate, [field]: value }
    const periods: Record<'income' | 'balance' | 'cashflow', Map<string, any>> = {
      income: new Map(), balance: new Map(), cashflow: new Map(),
    };

    for (const series of results) {
      const type: string = series?.meta?.type?.[0];
      if (!type) continue;
      const points: any[] = series[type] || [];
      // A type may belong to several statements (e.g. annualNetIncome → income + cashflow)
      const targets = (Object.keys(FIN_MAP) as Array<'income' | 'balance' | 'cashflow'>).filter(
        (stmt) => FIN_MAP[stmt][type]
      );
      for (const pt of points) {
        if (!pt || pt.reportedValue?.raw == null || !pt.asOfDate) continue;
        const value = pt.reportedValue.raw;
        const endDate = Math.floor(Date.parse(pt.asOfDate) / 1000);
        for (const stmt of targets) {
          const field = FIN_MAP[stmt][type];
          const map = periods[stmt];
          if (!map.has(pt.asOfDate)) map.set(pt.asOfDate, { endDate });
          map.get(pt.asOfDate)[field] = value;
        }
      }
    }

    const toArray = (m: Map<string, any>) =>
      [...m.values()].sort((a, b) => (b.endDate || 0) - (a.endDate || 0));

    const result = {
      income: toArray(periods.income),
      balance: toArray(periods.balance),
      cashflow: toArray(periods.cashflow),
    };

    setCache(cacheKey, result, 900_000);
    res.json(result);
  } catch (error: any) {
    console.error(`Financials error for ${req.params.symbol}:`, error.message);
    const stale = getStale(`financials:${req.params.symbol}`);
    if (stale) return res.json(stale);
    res.status(500).json({ error: 'Failed to fetch financials' });
  }
});

// ─── News (Google News RSS + Finnhub fallback) ───

// Simple XML tag extractor (no dependency)
function extractTag(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function extractAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const results: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

// Map common stock symbols to readable company names for better Google News results
const SYMBOL_SEARCH_NAMES: Record<string, string> = {
  AAPL: 'Apple', MSFT: 'Microsoft', GOOGL: 'Google Alphabet', AMZN: 'Amazon',
  TSLA: 'Tesla', META: 'Meta Facebook', NVDA: 'Nvidia', NFLX: 'Netflix',
  'SAP.DE': 'SAP', 'SIE.DE': 'Siemens', 'ALV.DE': 'Allianz', 'BAS.DE': 'BASF',
  'BMW.DE': 'BMW', 'DTE.DE': 'Deutsche Telekom', 'MBG.DE': 'Mercedes-Benz',
};

async function fetchGoogleNewsRSS(symbol: string): Promise<any[]> {
  // Use company name if known, otherwise use the symbol
  const searchTerm = SYMBOL_SEARCH_NAMES[symbol] || symbol.replace('.DE', '').replace('^', '');
  const query = encodeURIComponent(`${searchTerm} stock`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=en&gl=US&ceid=US:en`;

  const r = await httpsGet(url);
  if (r.status !== 200) return [];

  // Parse RSS XML
  const items = r.body.split('<item>').slice(1);
  return items.slice(0, 15).map((item) => {
    const title = extractTag(item, 'title').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    const link = extractTag(item, 'link');
    const pubDate = extractTag(item, 'pubDate');
    // Google News source is in the <source> tag
    const source = extractTag(item, 'source').replace(/&amp;/g, '&');

    return {
      title,
      link,
      publisher: source || 'Google News',
      publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
      thumbnail: null,
    };
  }).filter((n: any) => n.title && n.link);
}

async function fetchFinnhubNews(symbol: string): Promise<any[]> {
  // Finnhub free tier — no API key needed for company news (limited)
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().split('T')[0];
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${weekAgo}&to=${today}&token=demo`;

  try {
    const r = await httpsGet(url);
    if (r.status !== 200) return [];
    const data = JSON.parse(r.body);
    if (!Array.isArray(data)) return [];

    return data.slice(0, 15).map((item: any) => ({
      title: item.headline || item.title || '',
      link: item.url || '',
      publisher: item.source || 'Finnhub',
      publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : null,
      thumbnail: item.image || null,
    })).filter((n: any) => n.title && n.link);
  } catch {
    return [];
  }
}

// ─── Upcoming calendar events (earnings + ex-dividend dates) ───
// Batched across the watchlist via quoteSummary calendarEvents + summaryDetail.
app.get('/api/calendar-events', async (req, res) => {
  try {
    const symbolsParam = String(req.query.symbols || '');
    const symbols = symbolsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60);
    if (symbols.length === 0) return res.json([]);

    const cacheKey = `calevents:${symbols.slice().sort().join(',')}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Normalise Yahoo's {raw} / numeric / ISO date variants to unix seconds.
    const toUnix = (v: any): number | null => {
      if (v == null) return null;
      if (typeof v === 'number') return v > 1e11 ? Math.floor(v / 1000) : v;
      if (typeof v === 'object' && v.raw != null) return toUnix(v.raw);
      const parsed = Date.parse(String(v));
      return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
    };

    const results = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const data = await yahooFetch(
            `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents,summaryDetail,price`
          );
          const raw = data?.quoteSummary?.result?.[0];
          if (!raw) return null;
          const cal = raw.calendarEvents || {};
          const sd = raw.summaryDetail || {};
          const price = raw.price || {};

          // earnings.earningsDate is an array of {raw} timestamps; pick the first
          // one that is in the future (fall back to the first entry).
          const nowSec = Math.floor(Date.now() / 1000);
          const earningsDates: number[] = (cal.earnings?.earningsDate || [])
            .map(toUnix)
            .filter((n: number | null): n is number => n != null);
          const futureEarnings = earningsDates.find((d) => d >= nowSec - 86400);
          const earningsDate = futureEarnings ?? earningsDates[0] ?? null;

          const exDiv = toUnix(cal.exDividendDate) ?? toUnix(sd.exDividendDate);
          const divDate = toUnix(cal.dividendDate) ?? toUnix(sd.dividendDate);

          return {
            symbol,
            name: price.shortName || price.longName || symbol,
            earningsDate,
            earningsEstimate: cal.earnings?.earningsAverage?.raw ?? cal.earnings?.earningsAverage ?? null,
            exDividendDate: exDiv ?? null,
            dividendDate: divDate ?? null,
            dividendRate: sd.dividendRate?.raw ?? sd.dividendRate ?? null,
            dividendYield: sd.dividendYield?.raw ?? sd.dividendYield ?? null,
          };
        } catch {
          return null;
        }
      })
    );

    const events = results.filter(Boolean);
    setCache(cacheKey, events, 1800_000); // 30 min
    res.json(events);
  } catch (error: any) {
    console.error('Calendar events error:', error.message);
    res.status(500).json({ error: 'Failed to fetch calendar events' });
  }
});

app.get('/api/news/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;

    const cacheKey = `news:${symbol}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Try Google News RSS first, Finnhub as fallback.
    // Guard the Google call so a network error still lets Finnhub run.
    let news: any[] = [];
    try {
      news = await fetchGoogleNewsRSS(symbol);
    } catch (e: any) {
      console.error(`Google News failed for ${symbol}, falling back to Finnhub:`, e.message);
    }

    // If Google News returned too few, supplement with Finnhub
    if (news.length < 5) {
      const finnhubNews = await fetchFinnhubNews(symbol);
      // Merge, avoiding duplicate titles
      const titles = new Set(news.map((n) => (n.title || '').toLowerCase()));
      for (const item of finnhubNews) {
        const key = (item.title || '').toLowerCase();
        if (key && !titles.has(key)) {
          news.push(item);
          titles.add(key);
        }
      }
    }

    // Sort by date descending
    news.sort((a: any, b: any) => {
      const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return db - da;
    });

    news = news.slice(0, 20);
    setCache(cacheKey, news, 300_000);
    res.json(news);
  } catch (error: any) {
    console.error(`News error for ${req.params.symbol}:`, error.message);
    const stale = getStale(`news:${req.params.symbol}`);
    if (stale) return res.json(stale);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// ─── Sparkline batch (5d mini charts for watchlist) ───
app.get('/api/sparklines', async (req, res) => {
  try {
    const symbols = (req.query.symbols as string || '').split(',').filter(Boolean).slice(0, 60);
    if (!symbols.length) return res.json({});

    const result: Record<string, number[]> = {};
    await Promise.all(
      symbols.map(async (symbol) => {
        const cacheKey = `sparkline:${symbol}`;
        const cached = getCached(cacheKey);
        if (cached) {
          result[symbol] = cached;
          return;
        }
        try {
          const r = await httpsGet(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1h&includePrePost=false`
          );
          const data = JSON.parse(r.body);
          const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
          const filtered = closes.filter((c: any) => c != null);
          result[symbol] = filtered;
          setCache(cacheKey, filtered, 300_000);
        } catch {
          result[symbol] = getStale(cacheKey) || [];
        }
      })
    );

    res.json(result);
  } catch (error: any) {
    console.error('Sparklines error:', error.message);
    res.status(500).json({ error: 'Failed to fetch sparklines' });
  }
});

// ─── Heatmap data (batch quotes grouped by sector) ───
const HEATMAP_STOCKS: Record<string, string[]> = {
  'Technology': ['AAPL', 'MSFT', 'GOOGL', 'META', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'AMD', 'INTC'],
  'Healthcare': ['UNH', 'JNJ', 'LLY', 'PFE', 'ABBV', 'MRK', 'TMO', 'ABT'],
  'Finance': ['JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'BLK'],
  'Energy': ['XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY'],
  'Consumer': ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'COST', 'WMT', 'PG'],
  'Communication': ['DIS', 'NFLX', 'CMCSA', 'T', 'VZ', 'TMUS'],
  'Industrial': ['CAT', 'BA', 'UNP', 'HON', 'GE', 'RTX'],
};

app.get('/api/heatmap', async (req, res) => {
  try {
    const cacheKey = 'heatmap';
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const allSymbols = Object.values(HEATMAP_STOCKS).flat();
    const data = await yahooFetch(
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${allSymbols.map(s => encodeURIComponent(s)).join(',')}`
    );
    const quotes = data?.quoteResponse?.result || [];

    const result: Record<string, Array<{
      symbol: string;
      shortName: string;
      price: number;
      changePercent: number;
      marketCap: number;
    }>> = {};

    for (const [sector, symbols] of Object.entries(HEATMAP_STOCKS)) {
      result[sector] = symbols.map(sym => {
        const q = quotes.find((q: any) => q.symbol === sym);
        return {
          symbol: sym,
          shortName: q?.shortName || sym,
          price: q?.regularMarketPrice || 0,
          changePercent: q?.regularMarketChangePercent || 0,
          marketCap: q?.marketCap || 0,
        };
      }).filter(s => s.marketCap > 0);
    }

    setCache(cacheKey, result, 60_000);
    res.json(result);
  } catch (error: any) {
    console.error('Heatmap error:', error.message);
    const stale = getStale('heatmap');
    if (stale) return res.json(stale);
    res.status(500).json({ error: 'Failed to fetch heatmap data' });
  }
});

// ─── Screener (100 stock universe) ───
const SCREENER_UNIVERSE = [
  'AAPL','MSFT','GOOGL','AMZN','TSLA','META','NVDA','BRK-B','JPM','V',
  'JNJ','WMT','PG','MA','UNH','HD','DIS','BAC','INTC',
  'VZ','NFLX','ADBE','CRM','PFE','MRK','PEP','KO','CSCO','TMO',
  'ABT','COST','AVGO','NKE','LLY','ORCL','ACN','TXN','QCOM','MDT',
  'UNP','LOW','HON','AMGN','SBUX','IBM','GS','BLK','CAT','GE',
  'BA','RTX','CVX','XOM','COP','SLB','EOG','OXY',
  'AMD','MU','AMAT','LRCX','MRVL','SNPS','PANW',
  'NOW','INTU','ISRG','REGN','VRTX','GILD','ZTS','SYK',
  'MS','C','WFC','AXP','SCHW','CB','CME','ICE',
  'LIN','APD','SHW','ECL','EMR','ITW','ETN','DHR',
  'TMUS','T','CMCSA',
  // ETFs (so the asset-type filter has something to find)
  'SPY','VOO','IVV','QQQ','VTI','VEA','VWO','EEM','AGG','BND',
  'TLT','GLD','SLV','XLK','XLF','XLV','XLE','XLY','XLP','XLI',
  'XLB','XLRE','XLU','XLC','VYM','SCHD','VGT','SMH','SOXX','ARKK',
];

app.get('/api/screener', async (req, res) => {
  try {
    const cacheKey = 'screener';
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Fetch in batches of 50
    const allQuotes: any[] = [];
    for (let i = 0; i < SCREENER_UNIVERSE.length; i += 50) {
      const batch = SCREENER_UNIVERSE.slice(i, i + 50);
      const data = await yahooFetch(
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${batch.join(',')}`
      );
      allQuotes.push(...(data?.quoteResponse?.result || []));
    }

    const result = allQuotes.map((q: any) => ({
      symbol: q.symbol,
      shortName: q.shortName || q.longName || q.symbol,
      price: q.regularMarketPrice,
      changePercent: q.regularMarketChangePercent,
      marketCap: q.marketCap,
      volume: q.regularMarketVolume,
      pe: q.trailingPE || null,
      forwardPE: q.forwardPE || null,
      dividendYield: q.trailingAnnualDividendYield || null,
      sector: q.sector || 'N/A',
      exchange: q.exchange,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow,
      currency: q.currency || 'USD',
      quoteType: q.quoteType || 'EQUITY',
    }));

    setCache(cacheKey, result, 120_000);
    res.json(result);
  } catch (error: any) {
    console.error('Screener error:', error.message);
    const stale = getStale('screener');
    if (stale) return res.json(stale);
    res.status(500).json({ error: 'Failed to fetch screener data' });
  }
});

// ─── Index Constituents ───

const INDEX_CONSTITUENTS: Record<string, string[]> = {
  '^DJI': [
    'AAPL','AMGN','AMZN','AXP','BA','CAT','CRM','CSCO','CVX','DIS',
    'DOW','GS','HD','HON','IBM','INTC','JNJ','JPM','KO','MCD',
    'MMM','MRK','MSFT','NKE','PG','SHW','TRV','UNH','V','WMT',
  ],
  '^GSPC': [
    'AAPL','MSFT','AMZN','NVDA','GOOGL','META','TSLA','BRK-B','UNH','JNJ',
    'JPM','V','PG','HD','MA','AVGO','MRK','PEP','KO','LLY',
    'ABBV','PFE','COST','ADBE','CRM','TMO','ACN','MCD','CSCO','ABT',
    'DHR','WMT','NKE','TXN','NEE','UPS','PM','MS','RTX','LOW',
    'QCOM','INTC','INTU','AMD','ISRG','CAT','GS','BLK','SPGI','AXP',
  ],
  '^IXIC': [
    'AAPL','MSFT','AMZN','NVDA','GOOGL','META','TSLA','AVGO','PEP','COST',
    'ADBE','CSCO','NFLX','AMD','INTC','CMCSA','TXN','QCOM','INTU','AMGN',
    'AMAT','ISRG','BKNG','ADP','GILD','MDLZ','ADI','VRTX','REGN','LRCX',
    'MU','PANW','SNPS','CDNS','KLAC','MELI','ABNB','MNST','FTNT','DXCM',
    'ORLY','PCAR','MAR','KDP','CTAS','MCHP','KHC','AEP','EXC','PAYX',
  ],
  '^GDAXI': [
    'SAP.DE','SIE.DE','ALV.DE','DTE.DE','AIR.DE','MBG.DE','BMW.DE','MUV2.DE',
    'BAS.DE','IFX.DE','SHL.DE','DB1.DE','VOW3.DE','HEN3.DE','BEI.DE','MRK.DE',
    'RWE.DE','DHL.DE','ADS.DE','FRE.DE','EOAN.DE','HEI.DE','MTX.DE','SY1.DE',
    'VNA.DE','QIA.DE','PAH3.DE','ZAL.DE','1COV.DE','PUM.DE','ENR.DE','RHM.DE',
    'FME.DE','DTG.DE','CBK.DE','SRT3.DE','LEG.DE','HFG.DE','BNR.DE','DHER.DE',
  ],
  '^FTSE': [
    'SHEL.L','AZN.L','HSBA.L','ULVR.L','BP.L','GSK.L','RIO.L','BATS.L',
    'DGE.L','REL.L','LSEG.L','NG.L','VOD.L','PRU.L','CPG.L','AAL.L',
    'GLEN.L','CRH.L','RKT.L','EXPN.L','AHT.L','LLOY.L','BARC.L','III.L',
    'IMB.L','ABF.L','SSE.L','WPP.L','BNZL.L','LAND.L','RTO.L','SGRO.L',
    'NWG.L','SMIN.L','IHG.L','INF.L','AV.L','JD.L','FRAS.L','MNG.L',
    'PSON.L','SVT.L','TSCO.L','WTB.L','AUTO.L','BA.L','HLN.L','MNDI.L',
    'BRBY.L','EDV.L',
  ],
  '^FCHI': [
    'MC.PA','OR.PA','TTE.PA','SAN.PA','AI.PA','SU.PA','BN.PA','AIR.PA',
    'CS.PA','DG.PA','SAF.PA','RI.PA','BNP.PA','KER.PA','EL.PA','SGO.PA',
    'CA.PA','ACA.PA','EN.PA','VIV.PA','DSY.PA','STLA.PA','CAP.PA','HO.PA',
    'ML.PA','LR.PA','GLE.PA','ORA.PA','PUB.PA','STM.PA','WLN.PA','ATO.PA',
    'URW.PA','RMS.PA','EDEN.PA','FP.PA','TEP.PA','ERF.PA','VIE.PA','RNO.PA',
  ],
  '^N225': [
    '7203.T','6758.T','9984.T','6861.T','8306.T','6501.T','7267.T','6902.T',
    '4502.T','8035.T','9433.T','4063.T','6367.T','6954.T','7741.T','4519.T',
    '8058.T','9432.T','4568.T','8316.T','6098.T','3382.T','7974.T','8001.T',
    '6273.T','8411.T','9983.T','2914.T','6594.T','4503.T',
  ],
};

app.get('/api/index-constituents/:symbol', async (req, res) => {
  try {
    const indexSymbol = decodeURIComponent(req.params.symbol);
    const cacheKey = `index-constituents:${indexSymbol}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const constituents = INDEX_CONSTITUENTS[indexSymbol];
    if (!constituents || constituents.length === 0) {
      return res.json([]);
    }

    const allQuotes: any[] = [];
    for (let i = 0; i < constituents.length; i += 50) {
      const batch = constituents.slice(i, i + 50);
      const data = await yahooFetch(
        `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${batch.join(',')}`
      );
      allQuotes.push(...(data?.quoteResponse?.result || []));
    }

    const result = allQuotes.map((q: any) => ({
      symbol: q.symbol,
      shortName: q.shortName || q.longName || q.symbol,
      price: q.regularMarketPrice,
      changePercent: q.regularMarketChangePercent,
      marketCap: q.marketCap,
      volume: q.regularMarketVolume,
      pe: q.trailingPE || null,
      forwardPE: q.forwardPE || null,
      dividendYield: q.trailingAnnualDividendYield || null,
      sector: q.sector || 'N/A',
      exchange: q.exchange,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow,
      currency: q.currency || 'USD',
      quoteType: q.quoteType || 'EQUITY',
    }));

    setCache(cacheKey, result, 120_000);
    res.json(result);
  } catch (error: any) {
    console.error('Index constituents error:', error.message);
    const stale = getStale(`index-constituents:${decodeURIComponent(req.params.symbol)}`);
    if (stale) return res.json(stale);
    res.status(500).json({ error: 'Failed to fetch index constituents' });
  }
});

// ─── Global Markets (regional indices) ───
const GLOBAL_MARKET_INDICES: Record<string, string[]> = {
  americas: ['^DJI', '^GSPC', '^IXIC', '^RUT', '^GSPTSE'],
  europe: ['^GDAXI', '^FTSE', '^FCHI', '^STOXX50E', '^AEX', '^IBEX', '^SSMI'],
  asiaPacific: ['^N225', '^HSI', '000001.SS', '^AORD', '^KS11', '^BSESN', '^STI'],
  latinAmerica: ['^BVSP', '^MXX'],
};

const INDEX_DISPLAY_NAMES: Record<string, string> = {
  '^DJI': 'Dow Jones',
  '^GSPC': 'S&P 500',
  '^IXIC': 'NASDAQ',
  '^RUT': 'Russell 2000',
  '^GSPTSE': 'TSX Composite',
  '^GDAXI': 'DAX',
  '^FTSE': 'FTSE 100',
  '^FCHI': 'CAC 40',
  '^STOXX50E': 'Euro Stoxx 50',
  '^AEX': 'AEX',
  '^IBEX': 'IBEX 35',
  '^SSMI': 'SMI',
  '^N225': 'Nikkei 225',
  '^HSI': 'Hang Seng',
  '000001.SS': 'Shanghai Comp.',
  '^AORD': 'All Ordinaries',
  '^KS11': 'KOSPI',
  '^BSESN': 'BSE Sensex',
  '^STI': 'Straits Times',
  '^BVSP': 'Bovespa',
  '^MXX': 'IPC Mexico',
};

app.get('/api/globalmarkets', async (req, res) => {
  try {
    const cacheKey = 'globalmarkets';
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const allSymbols = Object.values(GLOBAL_MARKET_INDICES).flat();
    const data = await yahooFetch(
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${allSymbols.map(s => encodeURIComponent(s)).join(',')}`
    );
    const quotes = data?.quoteResponse?.result || [];

    const result: Record<string, any[]> = {};
    for (const [region, symbols] of Object.entries(GLOBAL_MARKET_INDICES)) {
      result[region] = symbols.map(sym => {
        const q = quotes.find((q: any) => q.symbol === sym);
        return q ? {
          symbol: q.symbol,
          shortName: INDEX_DISPLAY_NAMES[sym] || q.shortName || q.longName || sym,
          price: q.regularMarketPrice || 0,
          change: q.regularMarketChange || 0,
          changePercent: q.regularMarketChangePercent || 0,
          currency: q.currency || 'USD',
          exchange: q.exchange,
          marketState: q.marketState,
        } : null;
      }).filter(Boolean);
    }

    setCache(cacheKey, result, 60_000);
    res.json(result);
  } catch (error: any) {
    console.error('Global markets error:', error.message);
    const stale = getStale('globalmarkets');
    if (stale) return res.json(stale);
    res.status(500).json({ error: 'Failed to fetch global markets' });
  }
});

// ─── Exchange Rates ───
app.get('/api/exchangerate', async (req, res) => {
  try {
    const from = (req.query.from as string || 'USD').toUpperCase();
    const to = (req.query.to as string || 'EUR').toUpperCase();
    if (from === to) return res.json({ rate: 1, from, to });

    const cacheKey = `fx:${from}${to}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const symbol = `${from}${to}=X`;
    const data = await yahooFetch(
      `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`
    );
    const q = data?.quoteResponse?.result?.[0];
    const rate = q?.regularMarketPrice;
    if (!rate) throw new Error('No rate data');

    const result = { rate, from, to };
    setCache(cacheKey, result, 300_000); // 5min cache
    res.json(result);
  } catch (error: any) {
    console.error('Exchange rate error:', error.message);
    const from = (req.query.from as string || 'USD').toUpperCase();
    const to = (req.query.to as string || 'EUR').toUpperCase();
    const stale = getStale(`fx:${from}${to}`);
    if (stale) return res.json(stale);
    res.status(500).json({ error: 'Failed to fetch exchange rate' });
  }
});

  // Expose ensureCrumb for pre-warming
  app.locals._warmup = () => ensureCrumb().catch(() => {});

  return app;
}

export function startServer(
  staticDir?: string,
  port: number = 3001,
): Promise<{ port: number; server: import('http').Server }> {
  const app = createApp();

  // Pre-warm Yahoo auth in background (faster first request)
  if (app.locals._warmup) {
    app.locals._warmup();
  }

  // Serve static frontend files if directory provided
  if (staticDir) {
    app.use(express.static(staticDir));
    // SPA fallback - serve index.html for all non-API routes
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  // Bind to a STABLE port so the renderer's origin (http://localhost:<port>)
  // stays constant across launches — otherwise Chromium keys localStorage by a
  // new origin every start and all persisted data (portfolio, watchlist,
  // drawings, alerts) appears to vanish. If the preferred port is taken we walk
  // up a small deterministic range before finally falling back to a random
  // port (last resort: app still works, but storage won't persist that run).
  return new Promise((resolve, reject) => {
    const MAX_TRIES = 16;
    let attempt = 0;

    const tryListen = (p: number) => {
      // Loopback only — this is a local companion server for the Electron
      // renderer and must never be reachable from the network.
      const server = app.listen(p, '127.0.0.1', () => {
        const addr = server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : p;
        console.log(`\n  StockAnalyzer running at http://localhost:${actualPort}\n`);
        resolve({ port: actualPort, server });
      });
      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && p !== 0) {
          if (attempt < MAX_TRIES) {
            attempt++;
            tryListen(p + 1);
          } else {
            // Give up on a stable port; let the OS pick one so the app runs.
            console.warn(`  Preferred port range busy — falling back to a random port (storage won't persist this run).`);
            tryListen(0);
          }
        } else {
          // Non-EADDRINUSE error (or port 0 itself failed): unrecoverable.
          console.error(`  Server failed to bind (port ${p}): ${err.message}`);
          reject(new Error(`StockAnalyzer server failed to start: ${err.message}`));
        }
      });
    };

    tryListen(port);
  });
}

// Direct execution (dev mode)
const isDirectRun = process.argv[1]?.includes('server');
if (isDirectRun) {
  startServer(undefined, 3001);
}
