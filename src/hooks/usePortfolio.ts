import { useState, useEffect, useCallback, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PortfolioHolding {
  id: string;
  symbol: string;
  name: string;
  shares: number;
  avgPrice: number; // average purchase price
  addedAt: number;
}

export interface PortfolioTransaction {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  date: number; // timestamp
}

// ---------------------------------------------------------------------------
// LocalStorage helpers
// ---------------------------------------------------------------------------

const HOLDINGS_KEY = 'stockanalyzer_portfolio';
const TRANSACTIONS_KEY = 'stockanalyzer_transactions';

function loadFromStorage<T>(key: string, isValid: (item: unknown) => item is T): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(isValid);
    }
  } catch {
    // corrupted data – fall through
  }
  return [];
}

export function isValidHolding(item: unknown): item is PortfolioHolding {
  if (!item || typeof item !== 'object') return false;
  const h = item as Partial<PortfolioHolding>;
  return (
    typeof h.symbol === 'string' &&
    typeof h.shares === 'number' &&
    typeof h.avgPrice === 'number'
  );
}

export function isValidTransaction(item: unknown): item is PortfolioTransaction {
  if (!item || typeof item !== 'object') return false;
  const t = item as Partial<PortfolioTransaction>;
  return (
    typeof t.symbol === 'string' &&
    (t.type === 'buy' || t.type === 'sell') &&
    typeof t.shares === 'number' &&
    typeof t.price === 'number' &&
    typeof t.date === 'number'
  );
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable – silently ignore
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Rebuild holdings from a full transaction log (chronological replay).
// Used by CSV import. Applies weighted-average cost basis, identical to the
// incremental addTransaction logic but over an arbitrary list.
// ---------------------------------------------------------------------------

export function rebuildHoldings(
  txs: PortfolioTransaction[],
  names: Record<string, string>,
): PortfolioHolding[] {
  const map = new Map<string, PortfolioHolding>();
  const ordered = [...txs].sort((a, b) => a.date - b.date);

  for (const tx of ordered) {
    const sym = tx.symbol.toUpperCase();
    const existing = map.get(sym);

    if (tx.type === 'buy') {
      if (existing) {
        const totalShares = existing.shares + tx.shares;
        const totalCost = existing.shares * existing.avgPrice + tx.shares * tx.price;
        existing.shares = totalShares;
        existing.avgPrice = totalShares > 0 ? totalCost / totalShares : 0;
      } else {
        map.set(sym, {
          id: generateId(),
          symbol: sym,
          name: names[sym] || sym,
          shares: tx.shares,
          avgPrice: tx.price,
          addedAt: tx.date,
        });
      }
    } else {
      if (!existing) continue;
      const remaining = existing.shares - tx.shares;
      if (remaining <= 1e-9) {
        map.delete(sym);
      } else {
        existing.shares = remaining; // avgPrice unchanged on sell
      }
    }
  }

  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Realized P&L per symbol via average-cost replay. Values are in each symbol's
// transaction (native) currency.
// ---------------------------------------------------------------------------

export function computeRealizedBySymbol(
  transactions: PortfolioTransaction[],
): Record<string, number> {
  const cost = new Map<string, { shares: number; avg: number }>();
  const realized: Record<string, number> = {};
  const ordered = [...transactions].sort((a, b) => a.date - b.date);

  for (const tx of ordered) {
    const sym = tx.symbol.toUpperCase();
    const pos = cost.get(sym) ?? { shares: 0, avg: 0 };
    if (tx.type === 'buy') {
      const totalShares = pos.shares + tx.shares;
      const totalCost = pos.shares * pos.avg + tx.shares * tx.price;
      pos.shares = totalShares;
      pos.avg = totalShares > 0 ? totalCost / totalShares : 0;
    } else {
      const sold = Math.min(tx.shares, pos.shares);
      realized[sym] = (realized[sym] ?? 0) + sold * (tx.price - pos.avg);
      pos.shares = Math.max(0, pos.shares - tx.shares);
    }
    cost.set(sym, pos);
  }
  return realized;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePortfolio() {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>(() =>
    loadFromStorage(HOLDINGS_KEY, isValidHolding),
  );

  const [transactions, setTransactions] = useState<PortfolioTransaction[]>(() =>
    loadFromStorage(TRANSACTIONS_KEY, isValidTransaction),
  );

  // Persist holdings whenever they change
  useEffect(() => {
    saveToStorage(HOLDINGS_KEY, holdings);
  }, [holdings]);

  // Persist transactions whenever they change
  useEffect(() => {
    saveToStorage(TRANSACTIONS_KEY, transactions);
  }, [transactions]);

  // -----------------------------------------------------------------------
  // addTransaction
  // -----------------------------------------------------------------------

  const addTransaction = useCallback(
    (
      symbol: string,
      name: string,
      type: 'buy' | 'sell',
      shares: number,
      price: number,
    ): void => {
      if (shares <= 0 || price < 0) return;

      const upperSymbol = symbol.toUpperCase();

      // Record the transaction
      const tx: PortfolioTransaction = {
        id: generateId(),
        symbol: upperSymbol,
        type,
        shares,
        price,
        date: Date.now(),
      };

      setTransactions((prev) => [tx, ...prev]);

      // Update holdings
      setHoldings((prev) => {
        const existing = prev.find((h) => h.symbol === upperSymbol);

        if (type === 'buy') {
          if (existing) {
            // Compute new weighted-average price
            const totalShares = existing.shares + shares;
            const totalCost =
              existing.shares * existing.avgPrice + shares * price;
            const newAvg = totalShares > 0 ? totalCost / totalShares : 0;

            return prev.map((h) =>
              h.symbol === upperSymbol
                ? { ...h, shares: totalShares, avgPrice: newAvg }
                : h,
            );
          }

          // New holding
          const holding: PortfolioHolding = {
            id: generateId(),
            symbol: upperSymbol,
            name,
            shares,
            avgPrice: price,
            addedAt: Date.now(),
          };
          return [...prev, holding];
        }

        // type === 'sell'
        if (!existing) return prev; // nothing to sell

        const remaining = existing.shares - shares;

        if (remaining <= 0) {
          // Remove the holding entirely
          return prev.filter((h) => h.symbol !== upperSymbol);
        }

        // Keep the same avgPrice (selling doesn't change cost basis)
        return prev.map((h) =>
          h.symbol === upperSymbol ? { ...h, shares: remaining } : h,
        );
      });
    },
    [],
  );

  // -----------------------------------------------------------------------
  // removeHolding
  // -----------------------------------------------------------------------

  const removeHolding = useCallback((id: string): void => {
    setHoldings((prev) => prev.filter((h) => h.id !== id));
  }, []);

  // -----------------------------------------------------------------------
  // clearAll
  // -----------------------------------------------------------------------

  const clearAll = useCallback((): void => {
    setHoldings([]);
    setTransactions([]);
    localStorage.removeItem(HOLDINGS_KEY);
    localStorage.removeItem(TRANSACTIONS_KEY);
  }, []);

  // -----------------------------------------------------------------------
  // totalInvested
  // -----------------------------------------------------------------------

  const totalInvested = useMemo(
    () => holdings.reduce((sum, h) => sum + h.shares * h.avgPrice, 0),
    [holdings],
  );

  // -----------------------------------------------------------------------
  // importTransactions – replace the whole log and rebuild holdings
  // -----------------------------------------------------------------------

  const importTransactions = useCallback(
    (incoming: PortfolioTransaction[], names: Record<string, string> = {}): void => {
      if (!incoming.length) return;
      const cleaned = incoming
        .filter((t) => t.symbol && t.shares > 0 && t.price >= 0 && (t.type === 'buy' || t.type === 'sell'))
        .map((t) => ({ ...t, symbol: t.symbol.toUpperCase() }));
      const rebuilt = rebuildHoldings(cleaned, names);
      // Store newest-first for display
      const sortedDesc = [...cleaned].sort((a, b) => b.date - a.date);
      setTransactions(sortedDesc);
      setHoldings(rebuilt);
    },
    [],
  );

  // -----------------------------------------------------------------------
  // realizedBySymbol – realized P&L per symbol via average-cost replay.
  // Values are in each symbol's transaction (native) currency.
  // -----------------------------------------------------------------------

  const realizedBySymbol = useMemo(
    () => computeRealizedBySymbol(transactions),
    [transactions],
  );

  // -----------------------------------------------------------------------
  // getHolding
  // -----------------------------------------------------------------------

  const getHolding = useCallback(
    (symbol: string): PortfolioHolding | undefined => {
      const upper = symbol.toUpperCase();
      return holdings.find((h) => h.symbol === upper);
    },
    [holdings],
  );

  return {
    holdings,
    transactions,
    addTransaction,
    importTransactions,
    removeHolding,
    clearAll,
    totalInvested,
    realizedBySymbol,
    getHolding,
  } as const;
}
