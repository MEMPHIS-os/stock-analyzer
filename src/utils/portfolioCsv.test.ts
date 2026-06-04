import { describe, it, expect } from 'vitest';
import {
  buildTransactionsCSV,
  parseTransactionsCSV,
  parseCSVLine,
  csvCell,
  CSV_HEADER,
} from './portfolioCsv';
import type { PortfolioTransaction } from '../hooks/usePortfolio';

const tx = (over: Partial<PortfolioTransaction>): PortfolioTransaction => ({
  id: 'x',
  symbol: 'AAPL',
  type: 'buy',
  shares: 10,
  price: 100,
  date: Date.parse('2024-01-15'),
  ...over,
});

describe('csvCell', () => {
  it('leaves plain values untouched', () => {
    expect(csvCell('Apple')).toBe('Apple');
  });
  it('quotes and escapes values with commas or quotes', () => {
    expect(csvCell('Alphabet, Inc.')).toBe('"Alphabet, Inc."');
    expect(csvCell('A "B" C')).toBe('"A ""B"" C"');
  });
});

describe('parseCSVLine', () => {
  it('parses quoted fields containing commas', () => {
    expect(parseCSVLine('2024-01-15,GOOG,"Alphabet, Inc.",buy,5,100')).toEqual([
      '2024-01-15', 'GOOG', 'Alphabet, Inc.', 'buy', '5', '100',
    ]);
  });
  it('unescapes doubled quotes', () => {
    expect(parseCSVLine('"a ""b"" c",x')).toEqual(['a "b" c', 'x']);
  });
});

describe('buildTransactionsCSV / parseTransactionsCSV round-trip', () => {
  it('exports a header and one row per transaction, sorted by date', () => {
    const txs = [
      tx({ symbol: 'MSFT', date: Date.parse('2024-03-01') }),
      tx({ symbol: 'AAPL', date: Date.parse('2024-01-15') }),
    ];
    const csv = buildTransactionsCSV(txs, { AAPL: 'Apple', MSFT: 'Microsoft' });
    const lines = csv.split('\n');
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines[1]).toContain('2024-01-15,AAPL,Apple,buy,10,100');
    expect(lines[2]).toContain('2024-03-01,MSFT,Microsoft,buy,10,100');
  });

  it('round-trips data losslessly (symbol, type, shares, price, date, name)', () => {
    const txs = [
      tx({ symbol: 'AAPL', type: 'buy', shares: 10, price: 150.25, date: Date.parse('2024-01-15') }),
      tx({ symbol: 'AAPL', type: 'sell', shares: 4, price: 180, date: Date.parse('2024-02-20') }),
    ];
    const csv = buildTransactionsCSV(txs, { AAPL: 'Apple Inc.' });
    const { transactions, names } = parseTransactionsCSV(csv);

    expect(transactions).toHaveLength(2);
    expect(names.AAPL).toBe('Apple Inc.');
    const buy = transactions.find((t) => t.type === 'buy')!;
    expect(buy.shares).toBe(10);
    expect(buy.price).toBe(150.25);
    expect(new Date(buy.date).toISOString().slice(0, 10)).toBe('2024-01-15');
  });

  it('skips the header row and malformed/invalid lines', () => {
    const csv = [
      CSV_HEADER,
      '2024-01-15,AAPL,Apple,buy,10,100',
      '2024-01-16,BAD,Bad,hold,5,100',   // invalid type
      '2024-01-17,NEG,Neg,buy,-5,100',   // negative shares
      'garbage line',
    ].join('\n');
    const { transactions } = parseTransactionsCSV(csv);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].symbol).toBe('AAPL');
  });

  it('uppercases symbols on import', () => {
    const { transactions } = parseTransactionsCSV('2024-01-15,aapl,Apple,buy,1,1');
    expect(transactions[0].symbol).toBe('AAPL');
  });
});
