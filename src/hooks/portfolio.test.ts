import { describe, it, expect } from 'vitest';
import {
  rebuildHoldings,
  computeRealizedBySymbol,
  isValidHolding,
  isValidTransaction,
  type PortfolioTransaction,
} from './usePortfolio';

const tx = (over: Partial<PortfolioTransaction>): PortfolioTransaction => ({
  id: Math.random().toString(36).slice(2),
  symbol: 'AAPL',
  type: 'buy',
  shares: 10,
  price: 100,
  date: Date.parse('2024-01-01'),
  ...over,
});

describe('rebuildHoldings', () => {
  it('applies weighted-average cost basis across buys', () => {
    const txs = [
      tx({ shares: 10, price: 100, date: Date.parse('2024-01-01') }),
      tx({ shares: 10, price: 200, date: Date.parse('2024-02-01') }),
    ];
    const holdings = rebuildHoldings(txs, { AAPL: 'Apple' });
    expect(holdings).toHaveLength(1);
    expect(holdings[0].shares).toBe(20);
    expect(holdings[0].avgPrice).toBe(150); // (10*100 + 10*200) / 20
    expect(holdings[0].name).toBe('Apple');
  });

  it('reduces shares on sell without changing avg price', () => {
    const txs = [
      tx({ shares: 10, price: 100, date: Date.parse('2024-01-01') }),
      tx({ type: 'sell', shares: 4, price: 180, date: Date.parse('2024-02-01') }),
    ];
    const holdings = rebuildHoldings(txs, {});
    expect(holdings[0].shares).toBe(6);
    expect(holdings[0].avgPrice).toBe(100);
  });

  it('removes a holding fully sold off', () => {
    const txs = [
      tx({ shares: 10, price: 100 }),
      tx({ type: 'sell', shares: 10, price: 120, date: Date.parse('2024-03-01') }),
    ];
    expect(rebuildHoldings(txs, {})).toHaveLength(0);
  });

  it('replays in chronological order regardless of input order', () => {
    const txs = [
      tx({ type: 'sell', shares: 5, price: 150, date: Date.parse('2024-02-01') }),
      tx({ shares: 10, price: 100, date: Date.parse('2024-01-01') }),
    ];
    const holdings = rebuildHoldings(txs, {});
    expect(holdings[0].shares).toBe(5);
    expect(holdings[0].avgPrice).toBe(100);
  });
});

describe('computeRealizedBySymbol', () => {
  it('realizes gains using the average cost at time of sale', () => {
    const txs = [
      tx({ shares: 10, price: 100, date: Date.parse('2024-01-01') }),
      tx({ type: 'sell', shares: 4, price: 150, date: Date.parse('2024-02-01') }),
    ];
    // 4 * (150 - 100) = 200
    expect(computeRealizedBySymbol(txs).AAPL).toBe(200);
  });

  it('uses the weighted average across multiple buys before a sell', () => {
    const txs = [
      tx({ shares: 10, price: 100, date: Date.parse('2024-01-01') }),
      tx({ shares: 10, price: 200, date: Date.parse('2024-02-01') }), // avg now 150
      tx({ type: 'sell', shares: 5, price: 250, date: Date.parse('2024-03-01') }),
    ];
    // 5 * (250 - 150) = 500
    expect(computeRealizedBySymbol(txs).AAPL).toBe(500);
  });

  it('caps realized shares at the held quantity', () => {
    const txs = [
      tx({ shares: 5, price: 100, date: Date.parse('2024-01-01') }),
      tx({ type: 'sell', shares: 99, price: 120, date: Date.parse('2024-02-01') }),
    ];
    // only 5 shares were held → 5 * (120 - 100) = 100
    expect(computeRealizedBySymbol(txs).AAPL).toBe(100);
  });

  it('returns no entry for symbols never sold', () => {
    const txs = [tx({ shares: 10, price: 100 })];
    expect(computeRealizedBySymbol(txs).AAPL).toBeUndefined();
  });
});

describe('isValidHolding (localStorage guard)', () => {
  it('accepts a well-formed holding', () => {
    expect(isValidHolding({ symbol: 'AAPL', shares: 10, avgPrice: 100 })).toBe(true);
    expect(isValidHolding({ symbol: 'AAPL', name: 'Apple', shares: 10, avgPrice: 100 })).toBe(true);
  });

  it('rejects non-objects and null (corrupt "{}"/"null"/string payload entries)', () => {
    expect(isValidHolding(null)).toBe(false);
    expect(isValidHolding(undefined)).toBe(false);
    expect(isValidHolding('AAPL')).toBe(false);
    expect(isValidHolding(42)).toBe(false);
    expect(isValidHolding({})).toBe(false);
  });

  it('rejects objects with missing or wrongly-typed fields', () => {
    expect(isValidHolding({ symbol: 'AAPL', shares: 10 })).toBe(false);
    expect(isValidHolding({ symbol: 'AAPL', shares: '10', avgPrice: 100 })).toBe(false);
    expect(isValidHolding({ symbol: 7, shares: 10, avgPrice: 100 })).toBe(false);
  });
});

describe('isValidTransaction (localStorage guard)', () => {
  const valid = { symbol: 'AAPL', type: 'buy', shares: 10, price: 100, date: 1704067200000 };

  it('accepts well-formed buy/sell transactions', () => {
    expect(isValidTransaction(valid)).toBe(true);
    expect(isValidTransaction({ ...valid, type: 'sell' })).toBe(true);
  });

  it('rejects non-objects and null', () => {
    expect(isValidTransaction(null)).toBe(false);
    expect(isValidTransaction([])).toBe(false);
    expect(isValidTransaction('buy')).toBe(false);
    expect(isValidTransaction({})).toBe(false);
  });

  it('rejects unknown transaction types and wrongly-typed fields', () => {
    expect(isValidTransaction({ ...valid, type: 'transfer' })).toBe(false);
    expect(isValidTransaction({ ...valid, shares: '10' })).toBe(false);
    expect(isValidTransaction({ ...valid, price: null })).toBe(false);
    expect(isValidTransaction({ ...valid, date: '2024-01-01' })).toBe(false);
  });
});
