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

function loadDiskCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      diskCache = JSON.parse(raw);
      console.log(`  Loaded ${Object.keys(diskCache).length} cached entries from disk`);
    }
  } catch { /* ignore corrupt cache */ }
}

function saveDiskCache() {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(diskCache), 'utf-8');
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
  app.use(cors());
  app.use(express.json());

// ─── Response Cache (memory + disk fallback) ───
const cache = new Map<string, { data: any; expires: number }>();

function getCached(key: string): any | null {
  // Check memory first
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expires) return entry.data;
  if (entry) cache.delete(key);
  // Fallback to disk cache (even expired — for offline mode)
  const disk = diskCache[key];
  if (disk) return disk.data;
  return null;
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
      regularMarketChangePercent: meta.chartPreviousClose
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
    // Fallback: try v8 chart API individually (no auth needed)
    const symbols = (req.query.symbols as string || '').split(',').filter(Boolean);
    const fallbacks = await Promise.all(symbols.map(s => v8QuoteFallback(s.trim())));
    const validFallbacks = fallbacks.filter(Boolean);
    if (validFallbacks.length > 0) return res.json(validFallbacks);
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

// ─── Chart data (v8 - no auth needed) ───
app.get('/api/chart/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { range = '1y', interval = '1d' } = req.query;

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
    // daily+ intervals use YYYY-MM-DD date strings.
    const isIntraday = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h'].includes(interval as string);

    const quotes = ts.map((t: number, i: number) => ({
      date: isIntraday ? t : new Date(t * 1000).toISOString().split('T')[0],
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
    res.status(500).json({ error: 'Failed to fetch fundamentals' });
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

app.get('/api/news/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;

    const cacheKey = `news:${symbol}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // Try Google News RSS first, Finnhub as fallback
    let news = await fetchGoogleNewsRSS(symbol);

    // If Google News returned too few, supplement with Finnhub
    if (news.length < 5) {
      const finnhubNews = await fetchFinnhubNews(symbol);
      // Merge, avoiding duplicate titles
      const titles = new Set(news.map((n) => n.title.toLowerCase()));
      for (const item of finnhubNews) {
        if (!titles.has(item.title.toLowerCase())) {
          news.push(item);
          titles.add(item.title.toLowerCase());
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
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

// ─── Sparkline batch (5d mini charts for watchlist) ───
app.get('/api/sparklines', async (req, res) => {
  try {
    const symbols = (req.query.symbols as string || '').split(',').filter(Boolean);
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
          result[symbol] = [];
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
    res.status(500).json({ error: 'Failed to fetch exchange rate' });
  }
});

  // Expose ensureCrumb for pre-warming
  app.locals._warmup = () => ensureCrumb().catch(() => {});

  return app;
}

export function startServer(staticDir?: string, port: number = 3001): Promise<number> {
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

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      console.log(`\n  StockAnalyzer running at http://localhost:${actualPort}\n`);
      resolve(actualPort);
    });
  });
}

// Direct execution (dev mode)
const isDirectRun = process.argv[1]?.includes('server');
if (isDirectRun) {
  startServer(undefined, 3001);
}
