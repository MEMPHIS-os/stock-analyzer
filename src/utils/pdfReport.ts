import type { QuoteData, FundamentalsData } from '../types';
import {
  formatPrice,
  formatChange,
  formatPercent,
  formatLargeNumber,
  formatVolume,
  formatMarginPercent,
  formatRatio,
} from '../formatters';

// ────────────────────────────────────────────────────────────────
// generateStockReport
//
// Opens the browser print dialog with a professionally-formatted
// stock report rendered inside a hidden iframe. The user can then
// choose "Save as PDF" from the print dialog.
// No external dependencies required.
// ────────────────────────────────────────────────────────────────

export interface StockReportData {
  symbol: string;
  name: string;
  quote: QuoteData;
  fundamentals?: FundamentalsData;
  chartCanvas?: HTMLCanvasElement;
  locale?: 'de' | 'en';
}

export async function generateStockReport(data: StockReportData): Promise<void> {
  const { symbol, name, quote, fundamentals, chartCanvas } = data;

  // Capture the chart image before we start building the document
  let chartDataUrl: string | null = null;
  if (chartCanvas) {
    try {
      chartDataUrl = chartCanvas.toDataURL('image/png');
    } catch {
      // Canvas may be tainted (cross-origin) -- silently skip
      chartDataUrl = null;
    }
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const currency = quote.currency ?? 'USD';
  const loc = data.locale ?? 'en';
  const changeColor = quote.regularMarketChange >= 0 ? '#16a34a' : '#dc2626';

  // ── Helper: build a table row ──────────────────────────────────
  function row(label: string, value: string): string {
    return `<tr><td class="label">${label}</td><td class="value">${value}</td></tr>`;
  }

  // ── Key metrics table ──────────────────────────────────────────
  const keyMetricsRows = [
    row('Price', formatPrice(quote.regularMarketPrice, currency, loc)),
    row(
      'Change',
      `<span style="color:${changeColor}">${formatChange(quote.regularMarketChange)} (${formatPercent(quote.regularMarketChangePercent)})</span>`,
    ),
    row('Open', formatPrice(quote.regularMarketOpen, currency, loc)),
    row('Previous Close', formatPrice(quote.regularMarketPreviousClose, currency, loc)),
    row("Day's Range", `${formatPrice(quote.regularMarketDayLow, currency, loc)} &ndash; ${formatPrice(quote.regularMarketDayHigh, currency, loc)}`),
    row('52-Week Range', `${formatPrice(quote.fiftyTwoWeekLow, currency, loc)} &ndash; ${formatPrice(quote.fiftyTwoWeekHigh, currency, loc)}`),
    row('Volume', formatVolume(quote.regularMarketVolume)),
    row('Avg Volume', (() => { const av = quote.averageVolume ?? quote.averageDailyVolume3Month ?? quote.averageDailyVolume10Day; return av != null ? formatVolume(av) : '&mdash;'; })()),
    row('Market Cap', quote.marketCap != null ? formatLargeNumber(quote.marketCap) : '&mdash;'),
  ];

  if (quote.exchange) {
    keyMetricsRows.push(row('Exchange', quote.exchange));
  }

  // ── Fundamentals section ───────────────────────────────────────
  let fundamentalsHtml = '';

  if (fundamentals) {
    const sd = fundamentals.summaryDetail;
    const fd = fundamentals.financialData;
    const ks = fundamentals.defaultKeyStatistics;
    const sp = fundamentals.summaryProfile;

    // Company profile
    if (sp) {
      const profileParts: string[] = [];
      if (sp.sector) profileParts.push(row('Sector', sp.sector));
      if (sp.industry) profileParts.push(row('Industry', sp.industry));
      if (sp.country) profileParts.push(row('Country', sp.country));
      if (sp.fullTimeEmployees != null) profileParts.push(row('Employees', sp.fullTimeEmployees.toLocaleString('en-US')));
      if (sp.website) profileParts.push(row('Website', sp.website));

      if (profileParts.length > 0) {
        fundamentalsHtml += `
          <h2>Company Profile</h2>
          <table class="metrics">${profileParts.join('')}</table>
        `;
      }

      if (sp.longBusinessSummary) {
        fundamentalsHtml += `
          <div class="business-summary">
            <h3>Business Summary</h3>
            <p>${escapeHtml(sp.longBusinessSummary)}</p>
          </div>
        `;
      }
    }

    // Valuation metrics
    const valuationRows: string[] = [];
    if (sd?.trailingPE != null) valuationRows.push(row('Trailing P/E', formatRatio(sd.trailingPE)));
    if (sd?.forwardPE != null) valuationRows.push(row('Forward P/E', formatRatio(sd.forwardPE)));
    if (sd?.priceToBook != null) valuationRows.push(row('Price / Book', formatRatio(sd.priceToBook)));
    if (ks?.pegRatio != null) valuationRows.push(row('PEG Ratio', formatRatio(ks.pegRatio)));
    if (ks?.priceToSalesTrailing12Months != null) valuationRows.push(row('Price / Sales (TTM)', formatRatio(ks.priceToSalesTrailing12Months)));
    if (ks?.enterpriseValue != null) valuationRows.push(row('Enterprise Value', formatLargeNumber(ks.enterpriseValue)));
    if (ks?.enterpriseToRevenue != null) valuationRows.push(row('EV / Revenue', formatRatio(ks.enterpriseToRevenue)));
    if (ks?.enterpriseToEbitda != null) valuationRows.push(row('EV / EBITDA', formatRatio(ks.enterpriseToEbitda)));

    if (valuationRows.length > 0) {
      fundamentalsHtml += `
        <h2>Valuation</h2>
        <table class="metrics">${valuationRows.join('')}</table>
      `;
    }

    // Dividends
    const dividendRows: string[] = [];
    if (sd?.dividendYield != null) dividendRows.push(row('Dividend Yield', formatMarginPercent(sd.dividendYield)));
    if (sd?.dividendRate != null) dividendRows.push(row('Dividend Rate', formatPrice(sd.dividendRate, currency, loc)));
    if (sd?.payoutRatio != null) dividendRows.push(row('Payout Ratio', formatMarginPercent(sd.payoutRatio)));

    if (dividendRows.length > 0) {
      fundamentalsHtml += `
        <h2>Dividends</h2>
        <table class="metrics">${dividendRows.join('')}</table>
      `;
    }

    // Financial health
    const financialRows: string[] = [];
    if (fd?.totalRevenue != null) financialRows.push(row('Total Revenue', formatLargeNumber(fd.totalRevenue)));
    if (fd?.grossProfits != null) financialRows.push(row('Gross Profits', formatLargeNumber(fd.grossProfits)));
    if (fd?.ebitda != null) financialRows.push(row('EBITDA', formatLargeNumber(fd.ebitda)));
    if (fd?.operatingMargins != null) financialRows.push(row('Operating Margin', formatMarginPercent(fd.operatingMargins)));
    if (fd?.profitMargins != null) financialRows.push(row('Profit Margin', formatMarginPercent(fd.profitMargins)));
    if (fd?.returnOnEquity != null) financialRows.push(row('Return on Equity', formatMarginPercent(fd.returnOnEquity)));
    if (fd?.returnOnAssets != null) financialRows.push(row('Return on Assets', formatMarginPercent(fd.returnOnAssets)));
    if (fd?.totalDebt != null) financialRows.push(row('Total Debt', formatLargeNumber(fd.totalDebt)));
    if (fd?.totalCash != null) financialRows.push(row('Total Cash', formatLargeNumber(fd.totalCash)));
    if (fd?.debtToEquity != null) financialRows.push(row('Debt / Equity', formatRatio(fd.debtToEquity)));
    if (fd?.currentRatio != null) financialRows.push(row('Current Ratio', formatRatio(fd.currentRatio)));
    if (fd?.freeCashflow != null) financialRows.push(row('Free Cash Flow', formatLargeNumber(fd.freeCashflow)));

    if (financialRows.length > 0) {
      fundamentalsHtml += `
        <h2>Financial Health</h2>
        <table class="metrics">${financialRows.join('')}</table>
      `;
    }

    // Growth & analyst
    const analystRows: string[] = [];
    if (fd?.earningsGrowth != null) analystRows.push(row('Earnings Growth', formatMarginPercent(fd.earningsGrowth)));
    if (fd?.revenueGrowth != null) analystRows.push(row('Revenue Growth', formatMarginPercent(fd.revenueGrowth)));
    if (fd?.recommendationKey) analystRows.push(row('Analyst Recommendation', fd.recommendationKey.toUpperCase()));
    if (fd?.numberOfAnalystOpinions != null) analystRows.push(row('Number of Analysts', fd.numberOfAnalystOpinions.toString()));
    if (fd?.targetMeanPrice != null) analystRows.push(row('Target Mean Price', formatPrice(fd.targetMeanPrice, currency, loc)));
    if (fd?.targetHighPrice != null) analystRows.push(row('Target High', formatPrice(fd.targetHighPrice, currency, loc)));
    if (fd?.targetLowPrice != null) analystRows.push(row('Target Low', formatPrice(fd.targetLowPrice, currency, loc)));

    if (analystRows.length > 0) {
      fundamentalsHtml += `
        <h2>Growth &amp; Analyst Estimates</h2>
        <table class="metrics">${analystRows.join('')}</table>
      `;
    }

    // Key statistics extras
    const statsRows: string[] = [];
    if (sd?.beta != null) statsRows.push(row('Beta', formatRatio(sd.beta)));
    if (sd?.fiftyDayAverage != null) statsRows.push(row('50-Day Average', formatPrice(sd.fiftyDayAverage, currency, loc)));
    if (sd?.twoHundredDayAverage != null) statsRows.push(row('200-Day Average', formatPrice(sd.twoHundredDayAverage, currency, loc)));
    if (ks?.sharesOutstanding != null) statsRows.push(row('Shares Outstanding', formatLargeNumber(ks.sharesOutstanding)));
    if (ks?.floatShares != null) statsRows.push(row('Float Shares', formatLargeNumber(ks.floatShares)));
    if (ks?.shortRatio != null) statsRows.push(row('Short Ratio', formatRatio(ks.shortRatio)));
    if (ks?.shortPercentOfFloat != null) statsRows.push(row('Short % of Float', formatMarginPercent(ks.shortPercentOfFloat)));
    if (ks?.bookValue != null) statsRows.push(row('Book Value', formatPrice(ks.bookValue, currency, loc)));

    if (statsRows.length > 0) {
      fundamentalsHtml += `
        <h2>Key Statistics</h2>
        <table class="metrics">${statsRows.join('')}</table>
      `;
    }
  }

  // ── Chart image section ────────────────────────────────────────
  const chartHtml = chartDataUrl
    ? `
      <div class="chart-section">
        <h2>Price Chart</h2>
        <img src="${chartDataUrl}" alt="Price chart for ${escapeHtml(symbol)}" />
      </div>
    `
    : '';

  // ── Full HTML document ─────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(symbol)} - Stock Report</title>
  <style>
    /* ── Reset & base ───────────────────────────── */
    *, *::before, *::after {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
      color: #1a1a1a;
      background: #ffffff;
      line-height: 1.5;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Header bar ─────────────────────────────── */
    .header {
      background: #1e293b;
      color: #ffffff;
      padding: 28px 40px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }

    .header-left .symbol {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #94a3b8;
      margin-bottom: 4px;
    }

    .header-left .company-name {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 28px;
      font-weight: 700;
      line-height: 1.2;
    }

    .header-right {
      text-align: right;
      font-size: 13px;
      color: #cbd5e1;
    }

    .header-right .price-large {
      font-size: 28px;
      font-weight: 700;
      color: #ffffff;
      font-family: 'Segoe UI', monospace;
    }

    .header-right .change {
      font-size: 15px;
      font-weight: 600;
      margin-top: 2px;
    }

    /* ── Content area ───────────────────────────── */
    .content {
      padding: 32px 40px;
      max-width: 900px;
    }

    h2 {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
      margin-top: 28px;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 2px solid #e2e8f0;
    }

    h3 {
      font-size: 14px;
      font-weight: 600;
      color: #334155;
      margin-top: 16px;
      margin-bottom: 8px;
    }

    /* ── Metrics table ──────────────────────────── */
    table.metrics {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-bottom: 8px;
    }

    table.metrics tr {
      border-bottom: 1px solid #f1f5f9;
    }

    table.metrics tr:last-child {
      border-bottom: none;
    }

    table.metrics td {
      padding: 7px 12px;
    }

    table.metrics td.label {
      width: 45%;
      font-weight: 500;
      color: #475569;
    }

    table.metrics td.value {
      width: 55%;
      font-weight: 600;
      color: #1e293b;
      text-align: right;
      font-family: 'Segoe UI', monospace;
    }

    table.metrics tr:nth-child(even) {
      background: #f8fafc;
    }

    /* ── Business summary ───────────────────────── */
    .business-summary {
      margin-top: 12px;
      margin-bottom: 8px;
    }

    .business-summary p {
      font-size: 12.5px;
      color: #334155;
      line-height: 1.6;
      text-align: justify;
    }

    /* ── Chart ───────────────────────────────────── */
    .chart-section {
      page-break-inside: avoid;
    }

    .chart-section img {
      width: 100%;
      max-width: 820px;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      display: block;
    }

    /* ── Footer ──────────────────────────────────── */
    .footer {
      margin-top: 40px;
      padding: 16px 40px;
      border-top: 2px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #94a3b8;
    }

    .footer .brand {
      font-weight: 600;
      color: #64748b;
    }

    /* ── Print tweaks ───────────────────────────── */
    @media print {
      body {
        padding: 0;
      }

      .header {
        background: #1e293b !important;
        color: #ffffff !important;
      }

      table.metrics tr:nth-child(even) {
        background: #f8fafc !important;
      }

      .chart-section {
        page-break-inside: avoid;
      }

      h2 {
        page-break-after: avoid;
      }

      .footer {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
      }
    }

    @page {
      margin: 0.5in;
      size: A4;
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <div class="symbol">${escapeHtml(symbol)}</div>
      <div class="company-name">${escapeHtml(name)}</div>
    </div>
    <div class="header-right">
      <div class="price-large">${formatPrice(quote.regularMarketPrice, currency, loc)}</div>
      <div class="change" style="color:${quote.regularMarketChange >= 0 ? '#86efac' : '#fca5a5'}">
        ${formatChange(quote.regularMarketChange)} (${formatPercent(quote.regularMarketChangePercent)})
      </div>
      <div style="margin-top:6px">${dateStr} &middot; ${timeStr}</div>
    </div>
  </div>

  <!-- Content -->
  <div class="content">
    <h2>Key Metrics</h2>
    <table class="metrics">
      ${keyMetricsRows.join('\n      ')}
    </table>

    ${fundamentalsHtml}

    ${chartHtml}
  </div>

  <!-- Footer -->
  <div class="footer">
    <span class="brand">Generated by StockAnalyzer</span>
    <span>${escapeHtml(symbol)} &mdash; Report generated ${dateStr} at ${timeStr}</span>
  </div>

</body>
</html>`;

  // ── Render in iframe and print ─────────────────────────────────
  await printViaIframe(html);
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, (ch) => map[ch]);
}

function printViaIframe(html: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');

    // Position off-screen so it is invisible but still rendered
    Object.assign(iframe.style, {
      position: 'fixed',
      top: '-10000px',
      left: '-10000px',
      width: '900px',
      height: '700px',
      border: 'none',
      opacity: '0',
      pointerEvents: 'none',
    });

    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc || !iframe.contentWindow) {
      cleanup();
      resolve();
      return;
    }

    iframeDoc.open();
    iframeDoc.write(html);
    iframeDoc.close();

    function cleanup() {
      // Small delay so the browser finishes the print job
      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch {
          // already removed
        }
      }, 1000);
    }

    // Wait for all content (especially the chart image) to load
    iframe.contentWindow.addEventListener('load', () => {
      // Additional short delay for rendering to settle
      setTimeout(() => {
        try {
          iframe.contentWindow!.print();
        } catch {
          // Fallback: open in a new window
          const win = window.open('', '_blank');
          if (win) {
            win.document.open();
            win.document.write(html);
            win.document.close();
            win.addEventListener('load', () => {
              win.print();
            });
          }
        }
        cleanup();
        resolve();
      }, 300);
    });

    // Safety timeout in case load never fires (e.g., about:blank quirks)
    setTimeout(() => {
      try {
        iframe.contentWindow?.print();
      } catch {
        // ignore
      }
      cleanup();
      resolve();
    }, 5000);
  });
}
