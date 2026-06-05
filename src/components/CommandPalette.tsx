import { useState, useEffect, useRef, useMemo, useCallback, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Clock,
  LayoutDashboard,
  SlidersHorizontal,
  PiggyBank,
  Briefcase,
  Globe,
  Grid3x3,
  LayoutGrid,
  GitCompareArrows,
  FlaskConical,
  Flame,
  CalendarRange,
  Sun,
  Moon,
  Bell,
  Settings,
  PanelLeft,
  Euro,
  LayoutPanelTop,
  Palette,
} from 'lucide-react';
import { useApp, ACCENTS, type AccentColor } from '../context';
import { searchSymbols } from '../api';
import type { SearchResult } from '../types';

const SEARCH_HISTORY_KEY = 'stockanalyzer_search_history';

type Icon = ComponentType<{ className?: string }>;

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  icon: Icon;
  keywords?: string;
  run: () => void;
}

interface PaletteGroup {
  section: string;
  items: PaletteItem[];
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

function loadRecentStocks(): { symbol: string; name: string }[] {
  try {
    const stored = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return [];
}

function pushRecentStock(symbol: string, name: string) {
  try {
    const prev = loadRecentStocks().filter((h) => h.symbol !== symbol);
    const next = [{ symbol, name: name || symbol }, ...prev].slice(0, 8);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  } catch {}
}

/**
 * Subsequence fuzzy matcher. Returns a score (higher = better) or -1 for no
 * match. Empty query matches everything with a neutral score.
 */
function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Fast paths give a big boost for direct hits.
  const idx = t.indexOf(q);
  if (idx === 0) return 1000;
  if (idx > 0) return 700 - idx;

  // Subsequence match: every query char appears in order.
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (let i = ti; i < t.length; i++) {
      if (t[i] === ch) {
        found = i;
        break;
      }
    }
    if (found === -1) return -1;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 5;
    ti = found + 1;
  }
  return score;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const {
    locale,
    theme,
    toggleTheme,
    accent,
    setAccent,
    displayCurrency,
    toggleDisplayCurrency,
    splitFlapEnabled,
    toggleSplitFlap,
    setAlertsPanelOpen,
    setSettingsPanelOpen,
    sidebarOpen,
    setSidebarOpen,
    t,
  } = useApp();
  const de = locale === 'de';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recent, setRecent] = useState<{ symbol: string; name: string }[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Reset + focus on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setRecent(loadRecentStocks());
      // Focus after the open animation frame
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const go = useCallback(
    (path: string) => {
      navigate(path);
      onClose();
    },
    [navigate, onClose],
  );

  const openStock = useCallback(
    (symbol: string, name: string) => {
      pushRecentStock(symbol, name);
      navigate(`/stock/${symbol}`);
      onClose();
    },
    [navigate, onClose],
  );

  // ─── Static commands ───
  const navItems = useMemo<PaletteItem[]>(
    () => [
      { id: 'nav-dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, keywords: 'home start übersicht', run: () => go('/') },
      { id: 'nav-screener', label: t('nav.screener'), icon: SlidersHorizontal, keywords: 'filter screen', run: () => go('/screener') },
      { id: 'nav-funds', label: t('nav.funds'), icon: PiggyBank, keywords: 'etf fonds', run: () => go('/funds') },
      { id: 'nav-portfolio', label: t('nav.portfolio'), icon: Briefcase, keywords: 'depot bestand holdings', run: () => go('/portfolio') },
      { id: 'nav-global', label: t('nav.globalMarkets'), icon: Globe, keywords: 'indizes welt märkte', run: () => go('/global') },
      { id: 'nav-hotlists', label: t('nav.hotlists'), icon: Flame, keywords: 'gewinner verlierer movers gainers losers active', run: () => go('/hotlists') },
      { id: 'nav-calendar', label: t('nav.calendar'), icon: CalendarRange, keywords: 'wirtschaft makro cpi nfp fed ecb termine economic macro', run: () => go('/calendar') },
      { id: 'nav-heatmap', label: t('nav.heatmap'), icon: Grid3x3, keywords: 'sektoren', run: () => go('/heatmap') },
      { id: 'nav-multi', label: t('nav.multiChart'), icon: LayoutGrid, keywords: 'charts grid', run: () => go('/multi') },
      { id: 'nav-compare', label: t('nav.compare'), icon: GitCompareArrows, keywords: 'vergleich', run: () => go('/compare') },
      { id: 'nav-backtesting', label: t('nav.backtesting'), icon: FlaskConical, keywords: 'strategie test', run: () => go('/backtesting') },
    ],
    [t, go],
  );

  const actionItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      {
        id: 'act-theme',
        label: theme === 'dark' ? (de ? 'Helles Design' : 'Light theme') : (de ? 'Dunkles Design' : 'Dark theme'),
        hint: de ? 'Design wechseln' : 'Toggle theme',
        icon: theme === 'dark' ? Sun : Moon,
        keywords: 'theme dark light hell dunkel mode',
        run: () => { toggleTheme(); onClose(); },
      },
      {
        id: 'act-currency',
        label: displayCurrency === 'EUR' ? (de ? 'Native Währung anzeigen' : 'Show native currency') : (de ? 'In EUR anzeigen' : 'Show in EUR'),
        hint: de ? 'Anzeigewährung' : 'Display currency',
        icon: Euro,
        keywords: 'currency eur usd währung umrechnen',
        run: () => { toggleDisplayCurrency(); onClose(); },
      },
      {
        id: 'act-splitflap',
        label: splitFlapEnabled
          ? (de ? 'Klassische Anzeigetafel aus' : 'Disable split-flap board')
          : (de ? 'Klassische Anzeigetafel an' : 'Enable split-flap board'),
        hint: de ? 'Solari-Anzeige' : 'Solari display',
        icon: LayoutPanelTop,
        keywords: 'split flap solari board tafel klassisch',
        run: () => { toggleSplitFlap(); onClose(); },
      },
      {
        id: 'act-alerts',
        label: de ? 'Kursalarme öffnen' : 'Open alerts',
        hint: de ? 'Alarme verwalten' : 'Manage alerts',
        icon: Bell,
        keywords: 'alert benachrichtigung notification kursalarm',
        run: () => { setAlertsPanelOpen(true); onClose(); },
      },
      {
        id: 'act-settings',
        label: de ? 'Einstellungen öffnen' : 'Open settings',
        hint: de ? 'Optionen' : 'Options',
        icon: Settings,
        keywords: 'settings optionen einstellungen config',
        run: () => { setSettingsPanelOpen(true); onClose(); },
      },
      {
        id: 'act-sidebar',
        label: sidebarOpen ? (de ? 'Watchlist ausblenden' : 'Hide watchlist') : (de ? 'Watchlist einblenden' : 'Show watchlist'),
        hint: de ? 'Seitenleiste' : 'Sidebar',
        icon: PanelLeft,
        keywords: 'sidebar watchlist seitenleiste toggle',
        run: () => { setSidebarOpen(!sidebarOpen); onClose(); },
      },
    ];
    // Accent colour commands
    (Object.keys(ACCENTS) as AccentColor[]).forEach((key) => {
      const def = ACCENTS[key];
      items.push({
        id: `act-accent-${key}`,
        label: de ? `Akzentfarbe: ${def.label}` : `Accent: ${def.label}`,
        hint: accent === key ? (de ? 'aktiv' : 'active') : undefined,
        icon: Palette,
        keywords: `accent akzent farbe color ${def.label}`,
        run: () => { setAccent(key); onClose(); },
      });
    });
    return items;
  }, [de, theme, displayCurrency, splitFlapEnabled, sidebarOpen, accent, toggleTheme, toggleDisplayCurrency, toggleSplitFlap, setAlertsPanelOpen, setSettingsPanelOpen, setSidebarOpen, setAccent, onClose]);

  // ─── Debounced stock search ───
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchSymbols(query.trim());
        setResults(res);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // ─── Build grouped, filtered list ───
  const groups = useMemo<PaletteGroup[]>(() => {
    const out: PaletteGroup[] = [];
    const q = query.trim();

    if (!q) {
      out.push({ section: de ? 'Aktionen' : 'Actions', items: actionItems });
      out.push({ section: de ? 'Seiten' : 'Pages', items: navItems });
      if (recent.length > 0) {
        out.push({
          section: de ? 'Zuletzt gesucht' : 'Recent',
          items: recent.map((r) => ({
            id: `recent-${r.symbol}`,
            label: r.symbol,
            hint: r.name,
            icon: Clock,
            run: () => openStock(r.symbol, r.name),
          })),
        });
      }
      return out;
    }

    // Fuzzy-filter the static commands.
    const score = (it: PaletteItem) => Math.max(fuzzyScore(q, it.label), fuzzyScore(q, it.keywords ?? '') - 50);
    const filteredActions = actionItems
      .map((it) => ({ it, s: score(it) }))
      .filter((x) => x.s > -1)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it);
    const filteredNav = navItems
      .map((it) => ({ it, s: score(it) }))
      .filter((x) => x.s > -1)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.it);

    // Live stock results.
    const stockItems: PaletteItem[] = results.map((r) => ({
      id: `stock-${r.symbol}`,
      label: r.symbol,
      hint: r.shortname,
      icon: Search,
      run: () => openStock(r.symbol, r.shortname || r.symbol),
    }));

    if (stockItems.length > 0) out.push({ section: de ? 'Aktien' : 'Stocks', items: stockItems });
    if (filteredActions.length > 0) out.push({ section: de ? 'Aktionen' : 'Actions', items: filteredActions });
    if (filteredNav.length > 0) out.push({ section: de ? 'Seiten' : 'Pages', items: filteredNav });
    return out;
  }, [query, de, actionItems, navItems, recent, results, openStock]);

  // Flatten for keyboard navigation.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Keep selection in range whenever the list changes.
  useEffect(() => {
    setSelectedIndex((i) => (flat.length === 0 ? 0 : Math.min(i, flat.length - 1)));
  }, [flat.length]);

  // Scroll selected item into view.
  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (flat.length ? (i + 1) % flat.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        flat[selectedIndex]?.run();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [flat, selectedIndex, onClose],
  );

  if (!open) return null;

  const glassStyle: React.CSSProperties = {
    background: 'var(--glass-bg)',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid var(--glass-border)',
  };

  let runningIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] px-4 animate-backdrop-in"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl shadow-depth-lg overflow-hidden animate-scale-in flex flex-col max-h-[70vh]"
        style={glassStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b" style={{ borderColor: 'var(--glass-border)' }}>
          <Search className="w-5 h-5 text-txt-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder={de ? 'Suchen oder Befehl eingeben…' : 'Search or type a command…'}
            className="flex-1 bg-transparent outline-none text-sm text-txt-primary placeholder:text-txt-muted"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin shrink-0" />
          )}
          <kbd className="hidden sm:block text-[10px] text-txt-muted bg-dark-700/50 px-1.5 py-0.5 rounded font-mono shrink-0">esc</kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto py-2">
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-txt-secondary">
              {de ? 'Keine Treffer' : 'No results'}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.section} className="mb-1">
                <div className="px-4 py-1.5 text-[10px] text-txt-muted uppercase tracking-wider font-semibold">
                  {group.section}
                </div>
                {group.items.map((item) => {
                  runningIndex++;
                  const idx = runningIndex;
                  const active = idx === selectedIndex;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      ref={(el) => { itemRefs.current[idx] = el; }}
                      onClick={() => item.run()}
                      onMouseMove={() => setSelectedIndex(idx)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-100 ${
                        active ? 'bg-accent/15' : 'hover:bg-dark-600/30'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-accent' : 'text-txt-muted'}`} />
                      <span className={`text-sm truncate ${item.id.startsWith('stock-') || item.id.startsWith('recent-') ? 'font-mono font-bold text-accent' : 'text-txt-primary'}`}>
                        {item.label}
                      </span>
                      {item.hint && (
                        <span className="ml-auto text-xs text-txt-muted truncate max-w-[55%] text-right">
                          {item.hint}
                        </span>
                      )}
                      {active && !item.hint && (
                        <CornerDownLeft className="ml-auto w-3.5 h-3.5 text-txt-muted shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t flex items-center gap-4 text-[10px] text-txt-muted" style={{ borderColor: 'var(--glass-border)' }}>
          <span className="flex items-center gap-1"><ArrowUp className="w-3 h-3" /><ArrowDown className="w-3 h-3" /> {de ? 'navigieren' : 'navigate'}</span>
          <span className="flex items-center gap-1"><CornerDownLeft className="w-3 h-3" /> {de ? 'auswählen' : 'select'}</span>
          <span className="ml-auto flex items-center gap-1">
            <kbd className="bg-dark-700/50 px-1.5 py-0.5 rounded font-mono">Ctrl</kbd>
            <kbd className="bg-dark-700/50 px-1.5 py-0.5 rounded font-mono">K</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
