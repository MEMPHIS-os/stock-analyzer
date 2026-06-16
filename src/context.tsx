import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useAlerts } from './hooks/useAlerts';
import type { PriceAlert, AddAlertInput } from './hooks/useAlerts';
import { useIndicatorAlerts } from './hooks/useIndicatorAlerts';
import type { WatchlistItem } from './types';
import { t as translate, type Locale } from './i18n';
import { fetchExchangeRate } from './api';

const WATCHLIST_KEY = 'stockanalyzer_watchlist';
const THEME_KEY = 'stockanalyzer_theme';
const LOCALE_KEY = 'stockanalyzer_locale';
const DISPLAY_CURRENCY_KEY = 'stockanalyzer_displaycurrency';
const SPLIT_FLAP_KEY = 'stockanalyzer_splitflap';
const ACCENT_KEY = 'stockanalyzer_accent';
const GLASS_KEY = 'stockanalyzer_glass';

export type AccentColor = 'blue' | 'green' | 'violet' | 'amber' | 'rose' | 'cyan' | 'teal';

interface AccentDef {
  label: string;
  accent: string;   // hex
  rgb: string;      // space-separated channels for rgb(var(--accent-rgb) / a)
  hover: string;
  light: string;
}

export const ACCENTS: Record<AccentColor, AccentDef> = {
  blue:   { label: 'Blau',    accent: '#2962ff', rgb: '41 98 255',   hover: '#1e53e4', light: '#5c8aff' },
  green:  { label: 'Grün',    accent: '#10b981', rgb: '16 185 129',  hover: '#059669', light: '#34d399' },
  violet: { label: 'Violett', accent: '#7c4dff', rgb: '124 77 255',  hover: '#6a35f0', light: '#9d7bff' },
  amber:  { label: 'Amber',   accent: '#f59e0b', rgb: '245 158 11',  hover: '#d97f06', light: '#fbbf24' },
  rose:   { label: 'Rosé',    accent: '#f43f5e', rgb: '244 63 94',   hover: '#e11d48', light: '#fb7185' },
  cyan:   { label: 'Cyan',    accent: '#06b6d4', rgb: '6 182 212',   hover: '#0891b2', light: '#22d3ee' },
  teal:   { label: 'Teal',    accent: '#14b8a6', rgb: '20 184 166',  hover: '#0d9488', light: '#2dd4bf' },
};

const DEFAULT_WATCHLIST: WatchlistItem[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', addedAt: Date.now() },
  { symbol: 'MSFT', name: 'Microsoft Corp.', addedAt: Date.now() },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', addedAt: Date.now() },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', addedAt: Date.now() },
  { symbol: 'TSLA', name: 'Tesla Inc.', addedAt: Date.now() },
];

export type Theme = 'dark' | 'light';
export type DisplayCurrency = 'native' | 'EUR';
/** Window transparency / frosted-glass level. 'off' = normal (fully opaque). */
export type GlassLevel = 'off' | 'low' | 'medium' | 'high';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  createdAt: number;
}

interface AppState {
  watchlist: WatchlistItem[];
  addToWatchlist: (symbol: string, name: string) => void;
  removeFromWatchlist: (symbol: string) => void;
  isInWatchlist: (symbol: string) => boolean;
  reorderWatchlist: (fromIndex: number, toIndex: number) => void;
  setWatchlistGroup: (symbol: string, group: string | undefined) => void;
  watchlistGroups: string[];
  compareSymbols: string[];
  addCompareSymbol: (symbol: string) => void;
  removeCompareSymbol: (symbol: string) => void;
  clearCompareSymbols: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  theme: Theme;
  toggleTheme: () => void;
  // i18n
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
  // Alerts
  alerts: PriceAlert[];
  activeAlerts: PriceAlert[];
  triggeredAlerts: PriceAlert[];
  addAlert: (input: AddAlertInput) => PriceAlert;
  removeAlert: (id: string) => void;
  toggleAlert: (id: string) => void;
  clearTriggered: () => void;
  checkAlerts: (
    quotes: Record<
      string,
      { regularMarketPrice: number; regularMarketChangePercent?: number; regularMarketVolume?: number; averageVolume?: number; averageDailyVolume3Month?: number; averageDailyVolume10Day?: number; currency?: string }
    >,
    locale?: 'de' | 'en',
    metrics?: Record<string, { rsi?: number }>
  ) => void;
  alertsPanelOpen: boolean;
  setAlertsPanelOpen: (open: boolean) => void;
  settingsPanelOpen: boolean;
  setSettingsPanelOpen: (open: boolean) => void;
  // Toasts
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  dismissToast: (id: string) => void;
  // Currency conversion
  displayCurrency: DisplayCurrency;
  toggleDisplayCurrency: () => void;
  /** Convert a price from its native currency to the display currency */
  convertPrice: (price: number, nativeCurrency: string) => { value: number; currency: string; converted: boolean };
  exchangeRate: number | null; // EUR per 1 USD
  // Split-flap (Solari) display style
  splitFlapEnabled: boolean;
  toggleSplitFlap: () => void;
  // Accent color theme
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
  // Window transparency / frosted-glass level (Windows acrylic)
  glassLevel: GlassLevel;
  setGlassLevel: (level: GlassLevel) => void;
}

const AppContext = createContext<AppState | null>(null);

function loadWatchlist(): WatchlistItem[] {
  try {
    const stored = localStorage.getItem(WATCHLIST_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return DEFAULT_WATCHLIST;
}

function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  return 'dark';
}

function loadLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored === 'de' || stored === 'en') return stored;
  } catch {}
  return 'de';
}

function loadDisplayCurrency(): DisplayCurrency {
  try {
    const stored = localStorage.getItem(DISPLAY_CURRENCY_KEY);
    if (stored === 'EUR' || stored === 'native') return stored;
  } catch {}
  return 'EUR'; // Default to EUR for German users
}

function loadSplitFlap(): boolean {
  try {
    const stored = localStorage.getItem(SPLIT_FLAP_KEY);
    if (stored === 'true' || stored === 'false') return stored === 'true';
  } catch {}
  return false;
}

function loadAccent(): AccentColor {
  try {
    const stored = localStorage.getItem(ACCENT_KEY);
    if (stored && stored in ACCENTS) return stored as AccentColor;
  } catch {}
  return 'blue';
}

function loadGlassLevel(): GlassLevel {
  try {
    const stored = localStorage.getItem(GLASS_KEY);
    if (stored === 'off' || stored === 'low' || stored === 'medium' || stored === 'high') {
      return stored;
    }
  } catch {}
  return 'off'; // Default: normal, fully opaque window.
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(loadWatchlist);
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [locale, setLocaleState] = useState<Locale>(loadLocale);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>(loadDisplayCurrency);
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);
  const [splitFlapEnabled, setSplitFlapEnabled] = useState<boolean>(loadSplitFlap);
  const [accent, setAccentState] = useState<AccentColor>(loadAccent);
  const [glassLevel, setGlassLevelState] = useState<GlassLevel>(loadGlassLevel);

  // Use alerts hook
  const {
    alerts,
    activeAlerts,
    triggeredAlerts,
    addAlert,
    removeAlert,
    toggleAlert,
    clearTriggered,
    checkAlerts,
  } = useAlerts();

  // Background evaluator for indicator (RSI) alerts.
  useIndicatorAlerts(alerts, checkAlerts, locale);

  useEffect(() => {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
  }, [watchlist]);

  // Apply theme to DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Apply accent color CSS variables to DOM
  useEffect(() => {
    const def = ACCENTS[accent] ?? ACCENTS.blue;
    const root = document.documentElement;
    root.style.setProperty('--accent', def.accent);
    root.style.setProperty('--accent-rgb', def.rgb);
    root.style.setProperty('--accent-hover', def.hover);
    root.style.setProperty('--accent-light', def.light);
    localStorage.setItem(ACCENT_KEY, accent);
  }, [accent]);

  const setAccent = useCallback((next: AccentColor) => setAccentState(next), []);

  // Apply the transparency level to the DOM. The renderer-only `acrylic` class
  // (set in main.tsx for the Windows Electron shell) gates whether index.css
  // actually turns anything translucent; here we just record the chosen level.
  useEffect(() => {
    document.documentElement.setAttribute('data-glass', glassLevel);
    localStorage.setItem(GLASS_KEY, glassLevel);
  }, [glassLevel]);

  const setGlassLevel = useCallback((next: GlassLevel) => setGlassLevelState(next), []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(LOCALE_KEY, l);
  }, []);

  const tFn = useCallback((key: string) => translate(key, locale), [locale]);

  // ─── Currency conversion ───

  // Fetch exchange rate on mount and every 5 minutes
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await fetchExchangeRate('USD', 'EUR');
        if (!cancelled) setExchangeRate(result.rate);
      } catch {}
    };
    load();
    const iv = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  const toggleDisplayCurrency = useCallback(() => {
    setDisplayCurrency((prev) => {
      const next = prev === 'native' ? 'EUR' : 'native';
      localStorage.setItem(DISPLAY_CURRENCY_KEY, next);
      return next;
    });
  }, []);

  const toggleSplitFlap = useCallback(() => {
    setSplitFlapEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(SPLIT_FLAP_KEY, String(next));
      return next;
    });
  }, []);

  const convertPrice = useCallback(
    (price: number, nativeCurrency: string): { value: number; currency: string; converted: boolean } => {
      if (displayCurrency === 'native' || !exchangeRate) {
        return { value: price, currency: nativeCurrency, converted: false };
      }
      // Target: EUR
      if (nativeCurrency === 'EUR') {
        return { value: price, currency: 'EUR', converted: false };
      }
      if (nativeCurrency === 'USD') {
        return { value: price * exchangeRate, currency: 'EUR', converted: true };
      }
      // For other currencies (GBP, JPY, etc.) keep native
      return { value: price, currency: nativeCurrency, converted: false };
    },
    [displayCurrency, exchangeRate]
  );

  // ─── Watchlist ───

  const addToWatchlist = useCallback((symbol: string, name: string) => {
    setWatchlist((prev) => {
      if (prev.some((item) => item.symbol === symbol)) return prev;
      return [...prev, { symbol, name, addedAt: Date.now() }];
    });
  }, []);

  const removeFromWatchlist = useCallback((symbol: string) => {
    setWatchlist((prev) => prev.filter((item) => item.symbol !== symbol));
  }, []);

  const isInWatchlist = useCallback(
    (symbol: string) => watchlist.some((item) => item.symbol === symbol),
    [watchlist]
  );

  const reorderWatchlist = useCallback((fromIndex: number, toIndex: number) => {
    setWatchlist((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const setWatchlistGroup = useCallback((symbol: string, group: string | undefined) => {
    setWatchlist((prev) =>
      prev.map((item) => (item.symbol === symbol ? { ...item, group } : item))
    );
  }, []);

  const watchlistGroups = useMemo(
    () => [...new Set(watchlist.map((item) => item.group).filter((g): g is string => !!g))],
    [watchlist]
  );

  const addCompareSymbol = useCallback((symbol: string) => {
    setCompareSymbols((prev) => {
      if (prev.includes(symbol) || prev.length >= 5) return prev;
      return [...prev, symbol];
    });
  }, []);

  const removeCompareSymbol = useCallback((symbol: string) => {
    setCompareSymbols((prev) => prev.filter((s) => s !== symbol));
  }, []);

  const clearCompareSymbols = useCallback(() => {
    setCompareSymbols([]);
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration = 3000) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const toast: Toast = { id, message, type, createdAt: Date.now() };

    setToasts((prev) => {
      const next = [...prev, toast];
      // Keep max 3 toasts, remove oldest if over
      if (next.length > 3) return next.slice(next.length - 3);
      return next;
    });

    // Auto-remove after duration
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      toastTimersRef.current.delete(id);
    }, duration);
    toastTimersRef.current.set(id, timer);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
  }, []);

  // Cleanup toast timers on unmount
  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return (
    <AppContext.Provider
      value={{
        watchlist,
        addToWatchlist,
        removeFromWatchlist,
        isInWatchlist,
        reorderWatchlist,
        setWatchlistGroup,
        watchlistGroups,
        compareSymbols,
        addCompareSymbol,
        removeCompareSymbol,
        clearCompareSymbols,
        sidebarOpen,
        setSidebarOpen,
        theme,
        toggleTheme,
        alerts,
        activeAlerts,
        triggeredAlerts,
        addAlert,
        removeAlert,
        toggleAlert,
        clearTriggered,
        checkAlerts,
        alertsPanelOpen,
        setAlertsPanelOpen,
        settingsPanelOpen,
        setSettingsPanelOpen,
        locale,
        setLocale,
        t: tFn,
        toasts,
        showToast,
        dismissToast,
        displayCurrency,
        toggleDisplayCurrency,
        convertPrice,
        exchangeRate,
        splitFlapEnabled,
        toggleSplitFlap,
        accent,
        setAccent,
        glassLevel,
        setGlassLevel,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
