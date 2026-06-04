import type { PortfolioTransaction } from '../hooks/usePortfolio';

// ---------------------------------------------------------------------------
// CSV import / export for the portfolio transaction log.
// Format: Date,Symbol,Name,Type,Shares,Price  (Date = ISO YYYY-MM-DD)
// ---------------------------------------------------------------------------

export const CSV_HEADER = 'Date,Symbol,Name,Type,Shares,Price';

/** Quote a field that contains a comma, quote or newline; escape inner quotes. */
export function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildTransactionsCSV(
  transactions: PortfolioTransaction[],
  names: Record<string, string>,
): string {
  const rows = [...transactions]
    .sort((a, b) => a.date - b.date)
    .map((tx) => {
      const date = new Date(tx.date).toISOString().slice(0, 10);
      return [
        date,
        tx.symbol,
        csvCell(names[tx.symbol] || tx.symbol),
        tx.type,
        String(tx.shares),
        String(tx.price),
      ].join(',');
    });
  return [CSV_HEADER, ...rows].join('\n');
}

/** Split a single CSV line into fields, honouring double-quoted values. */
export function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export interface ParsedCSV {
  transactions: PortfolioTransaction[];
  names: Record<string, string>;
}

export function parseTransactionsCSV(text: string): ParsedCSV {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const transactions: PortfolioTransaction[] = [];
  const names: Record<string, string> = {};

  for (const line of lines) {
    const cells = parseCSVLine(line);
    const [dateStr, symbolRaw, name, typeRaw, sharesStr, priceStr] = cells;
    // Skip header / malformed rows
    if (!symbolRaw || symbolRaw.toLowerCase() === 'symbol') continue;
    const symbol = symbolRaw.trim().toUpperCase();
    const type = (typeRaw || '').trim().toLowerCase();
    if (type !== 'buy' && type !== 'sell') continue;
    const shares = parseFloat(sharesStr);
    const price = parseFloat(priceStr);
    if (!isFinite(shares) || shares <= 0 || !isFinite(price) || price < 0) continue;
    const ts = Date.parse(dateStr);
    transactions.push({
      id: `${ts || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol,
      type,
      shares,
      price,
      date: isNaN(ts) ? Date.now() : ts,
    });
    if (name && name.trim()) names[symbol] = name.trim();
  }
  return { transactions, names };
}
