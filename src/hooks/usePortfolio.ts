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

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      return JSON.parse(raw) as T;
    }
  } catch {
    // corrupted data – fall through
  }
  return fallback;
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
// Hook
// ---------------------------------------------------------------------------

export function usePortfolio() {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>(() =>
    loadFromStorage<PortfolioHolding[]>(HOLDINGS_KEY, []),
  );

  const [transactions, setTransactions] = useState<PortfolioTransaction[]>(() =>
    loadFromStorage<PortfolioTransaction[]>(TRANSACTIONS_KEY, []),
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
    removeHolding,
    clearAll,
    totalInvested,
    getHolding,
  } as const;
}
