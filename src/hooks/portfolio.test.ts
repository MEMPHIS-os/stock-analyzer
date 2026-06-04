import { describe, it, expect } from 'vitest';
import { rebuildHoldings, computeRealizedBySymbol, type PortfolioTransaction } from './usePortfolio';

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
