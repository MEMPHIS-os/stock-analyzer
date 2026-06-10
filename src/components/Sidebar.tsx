import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Star,
  Trash2,
  TrendingUp,
  TrendingDown,
  X,
  GripVertical,
  ChevronDown,
  FolderPlus,
  MoreVertical,
} from 'lucide-react';
import { useApp } from '../context';
import { fetchQuotes, fetchSparklines } from '../api';
import { formatPercent } from '../formatters';
import { usePrice } from '../hooks/usePrice';
import type { QuoteData, WatchlistItem } from '../types';

// ---------- MiniSparkline ----------
function MiniSparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (!data.length || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 24;
  const w = 60;
  const pointsArr = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - ((v - min) / range) * h,
  }));
  const linePoints = pointsArr.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPoints = `0,${h} ${linePoints} ${w},${h}`;
  const color = positive ? '#26a69a' : '#ef5350';

  return (
    <svg width={w} height={h} className="shrink-0">
      <defs>
        <linearGradient id={`spark-fill-${positive ? 'up' : 'down'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#spark-fill-${positive ? 'up' : 'down'})`} />
      <polyline
        points={linePoints}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------- Mobile detection hook ----------
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}

// ---------- Context menu for assigning groups ----------
function GroupContextMenu({
  item,
  groups,
  onAssign,
  onClose,
  position,
}: {
  item: WatchlistItem;
  groups: string[];
  onAssign: (symbol: string, group: string | undefined) => void;
  onClose: () => void;
  position: { x: number; y: number };
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const style: React.CSSProperties = {
    position: 'fixed',
    top: position.y,
    left: position.x,
    zIndex: 9999,
  };

  return (
    <div
      ref={menuRef}
      style={{
        ...style,
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: '1px solid var(--glass-border)',
      }}
      className="rounded-xl shadow-depth-lg py-1.5 min-w-[180px] animate-scale-in"
    >
      <div className="px-3 py-1.5 text-[11px] text-txt-muted uppercase tracking-wider font-medium">
        Gruppe zuweisen
      </div>
      <button
        className={`w-full text-left px-3 py-2 text-sm transition-all duration-150 ${
          !item.group
            ? 'text-accent bg-accent/10'
            : 'text-txt-secondary hover:bg-dark-600/40 hover:text-txt-primary'
        }`}
        onClick={() => {
          onAssign(item.symbol, undefined);
          onClose();
        }}
      >
        Keine Gruppe
      </button>
      {groups.map((g) => (
        <button
          key={g}
          className={`w-full text-left px-3 py-2 text-sm transition-all duration-150 ${
            item.group === g
              ? 'text-accent bg-accent/10'
              : 'text-txt-secondary hover:bg-dark-600/40 hover:text-txt-primary'
          }`}
          onClick={() => {
            onAssign(item.symbol, g);
            onClose();
          }}
        >
          {g}
        </button>
      ))}
      <div className="border-t border-border/10 mt-1.5 pt-1.5 mx-2">
        <button
          className="w-full text-left px-2 py-2 text-sm text-txt-secondary hover:bg-dark-600/40 hover:text-txt-primary transition-all duration-150 rounded-lg"
          onClick={() => {
            const name = prompt('Neuen Gruppennamen eingeben:');
            if (name && name.trim()) {
              onAssign(item.symbol, name.trim());
            }
            onClose();
          }}
        >
          + Neue Gruppe...
        </button>
      </div>
    </div>
  );
}

// ---------- Single watchlist row with DnD ----------
function WatchlistRow({
  item,
  globalIndex,
  quote,
  sparkData,
  dragIndex,
  dropTargetIndex,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onNavigate,
  onRemove,
  onOpenMenu,
  fpSidebar,
  flash,
  flashKey,
}: {
  item: WatchlistItem;
  globalIndex: number;
  quote: QuoteData | undefined;
  sparkData: number[];
  dragIndex: number | null;
  dropTargetIndex: number | null;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
  onNavigate: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onOpenMenu: (item: WatchlistItem, e: React.MouseEvent) => void;
  fpSidebar: (price: number | undefined | null, currency?: string) => string;
  flash?: 'positive' | 'negative' | undefined;
  flashKey?: number;
}) {
  const change = quote?.regularMarketChangePercent;
  const isPositive = change != null && change >= 0;
  const isDragging = dragIndex === globalIndex;
  const isDropTarget = dropTargetIndex === globalIndex;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/stock-symbol', JSON.stringify({ symbol: item.symbol, name: item.name }));
        onDragStart(globalIndex);
      }}
      onDragOver={(e) => onDragOver(e, globalIndex)}
      onDrop={(e) => onDrop(e, globalIndex)}
      onDragEnd={onDragEnd}
      className={`group/item flex items-center gap-1.5 px-2 py-2.5 cursor-pointer border-b transition-all duration-200 rounded-lg mx-1 ${
        isDragging ? 'opacity-40 border-border/10' : ''
      } ${
        isDropTarget
          ? 'bg-accent/10 border-l-2 border-l-accent border-b-border/10 shadow-glow-sm'
          : 'hover:bg-dark-700/50 border-border/5'
      }`}
      onClick={() => onNavigate(item.symbol)}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenMenu(item, e);
      }}
    >
      {/* Drag handle */}
      <div
        className="shrink-0 cursor-grab active:cursor-grabbing p-0.5 opacity-0 group-hover/item:opacity-60 hover:!opacity-100 transition-opacity"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-3.5 h-3.5 text-txt-muted" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-semibold text-sm text-txt-primary">
            {item.symbol}
          </span>
          {change != null &&
            (isPositive ? (
              <TrendingUp className="w-3 h-3 text-success" />
            ) : (
              <TrendingDown className="w-3 h-3 text-danger" />
            ))}
        </div>
        <div className="text-[11px] text-txt-secondary truncate">{item.name}</div>
      </div>
      <MiniSparkline data={sparkData} positive={isPositive} />
      <div key={flash ? `flash-${flashKey}` : undefined} className={`text-right shrink-0 rounded-lg px-1.5 py-0.5 ${flash ? (flash === 'positive' ? 'flash-positive' : 'flash-negative') : ''}`}>
        {quote ? (
          <>
            <div className="text-xs font-mono text-txt-primary font-medium">
              {fpSidebar(quote.regularMarketPrice, quote.currency)}
            </div>
            <div
              className={`text-[11px] font-mono font-semibold ${
                isPositive ? 'text-success' : 'text-danger'
              }`}
            >
              {formatPercent(change)}
            </div>
          </>
        ) : (
          <div className="text-xs text-txt-muted">...</div>
        )}
      </div>

      {/* Context menu trigger */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpenMenu(item, e);
        }}
        className="opacity-0 group-hover/item:opacity-100 p-1 hover:bg-dark-600/50 rounded-lg transition-all"
        title="Gruppe zuweisen"
      >
        <MoreVertical className="w-3.5 h-3.5 text-txt-secondary" />
      </button>

      {/* Remove button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(item.symbol);
        }}
        className="opacity-0 group-hover/item:opacity-100 p-1 hover:bg-danger/20 rounded-lg transition-all"
        title="Entfernen"
      >
        <Trash2 className="w-3.5 h-3.5 text-danger" />
      </button>
    </div>
  );
}

// ---------- Main Sidebar ----------
export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    watchlist,
    removeFromWatchlist,
    reorderWatchlist,
    setWatchlistGroup,
    watchlistGroups,
    sidebarOpen,
    setSidebarOpen,
    checkAlerts,
    showToast,
    t,
  } = useApp();
  const { fp: fpSidebar } = usePrice();

  const [quotes, setQuotes] = useState<Record<string, QuoteData>>({});
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const prevPricesRef = useRef<Record<string, number>>({});
  const [flashSymbols, setFlashSymbols] = useState<Record<string, 'positive' | 'negative'>>({});
  const [flashKey, setFlashKey] = useState(0);
  const isMobile = useIsMobile();

  // DnD state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  // Collapsible group state
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    item: WatchlistItem;
    x: number;
    y: number;
  } | null>(null);

  // Fetch quotes
  const isFirstLoadRef = useRef(true);

  useEffect(() => {
    if (!watchlist.length) return;

    async function loadQuotes() {
      try {
        const symbols = watchlist.map((w) => w.symbol);
        const [data, sparks] = await Promise.all([
          fetchQuotes(symbols),
          fetchSparklines(symbols),
        ]);
        const map: Record<string, QuoteData> = {};
        data.forEach((q) => {
          if (q?.symbol) map[q.symbol] = q;
        });
        setQuotes(map);
        setSparklines(sparks);
        checkAlerts(map);

        // Flash effect
        const newFlashes: Record<string, 'positive' | 'negative'> = {};
        const isFirst = isFirstLoadRef.current;

        if (isFirst) {
          for (const sym of Object.keys(map)) {
            const change = map[sym]?.regularMarketChange;
            if (change != null && change !== 0) {
              newFlashes[sym] = change > 0 ? 'positive' : 'negative';
            }
          }
          isFirstLoadRef.current = false;
        } else {
          for (const sym of Object.keys(map)) {
            const prevPrice = prevPricesRef.current[sym];
            const newPrice = map[sym]?.regularMarketPrice;
            if (prevPrice != null && newPrice != null && prevPrice !== newPrice) {
              newFlashes[sym] = newPrice > prevPrice ? 'positive' : 'negative';
            }
          }
        }

        const nextPrices: Record<string, number> = {};
        for (const [sym, q] of Object.entries(map)) {
          if (q?.regularMarketPrice != null) nextPrices[sym] = q.regularMarketPrice;
        }
        prevPricesRef.current = nextPrices;

        if (Object.keys(newFlashes).length > 0) {
          if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
          setFlashSymbols({});
          requestAnimationFrame(() => {
            setFlashSymbols(newFlashes);
            setFlashKey((k) => k + 1);
          });
          flashTimeoutRef.current = setTimeout(() => setFlashSymbols({}), 1100);
        }
      } catch {}
    }

    loadQuotes();
    intervalRef.current = setInterval(loadQuotes, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [watchlist]);

  // Close sidebar on mobile when route changes
  const prevPathRef = useRef(location.pathname);
  useEffect(() => {
    if (isMobile && location.pathname !== prevPathRef.current) {
      setSidebarOpen(false);
    }
    prevPathRef.current = location.pathname;
  }, [location.pathname, isMobile, setSidebarOpen]);

  const handleBackdropClick = useCallback(() => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  const handleItemClick = useCallback(
    (symbol: string) => {
      navigate(`/stock/${symbol}`);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [navigate, isMobile, setSidebarOpen]
  );

  const grouped = useMemo(() => {
    const ungrouped: { item: WatchlistItem; globalIndex: number }[] = [];
    const groupMap = new Map<string, { item: WatchlistItem; globalIndex: number }[]>();

    watchlist.forEach((item, idx) => {
      if (!item.group) {
        ungrouped.push({ item, globalIndex: idx });
      } else {
        if (!groupMap.has(item.group)) groupMap.set(item.group, []);
        groupMap.get(item.group)!.push({ item, globalIndex: idx });
      }
    });

    const sections: {
      label: string;
      items: { item: WatchlistItem; globalIndex: number }[];
    }[] = [];

    if (ungrouped.length > 0) {
      sections.push({ label: 'Alle', items: ungrouped });
    }

    const sortedGroupNames = [...groupMap.keys()].sort((a, b) => a.localeCompare(b));
    for (const gName of sortedGroupNames) {
      sections.push({ label: gName, items: groupMap.get(gName)! });
    }

    return sections;
  }, [watchlist]);

  // DnD handlers
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropTargetIndex !== index) {
        setDropTargetIndex(index);
      }
    },
    [dropTargetIndex]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== toIndex) {
        reorderWatchlist(dragIndex, toIndex);
      }
      setDragIndex(null);
      setDropTargetIndex(null);
    },
    [dragIndex, reorderWatchlist]
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropTargetIndex(null);
  }, []);

  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }, []);

  const handleOpenMenu = useCallback(
    (item: WatchlistItem, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ item, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleRemoveWithToast = useCallback(
    (symbol: string) => {
      removeFromWatchlist(symbol);
      showToast(`${symbol} ${t('toast.removedFromWatchlist')}`, 'info');
    },
    [removeFromWatchlist, showToast, t]
  );

  const handleAddGroup = useCallback(() => {
    const name = prompt('Neuen Gruppennamen eingeben:');
    if (!name || !name.trim()) return;
    const ungroupedItem = watchlist.find((item) => !item.group);
    if (ungroupedItem) {
      setWatchlistGroup(ungroupedItem.symbol, name.trim());
    } else {
      alert(
        `Gruppe "${name.trim()}" erstellt. Rechtsklick auf ein Item, um es zuzuweisen.`
      );
    }
  }, [watchlist, setWatchlistGroup]);

  const hasGroups = watchlistGroups.length > 0 || grouped.length > 1;

  const sidebarContent = (
    <>
      <div className="px-4 py-3.5 border-b border-border/10 flex items-center gap-2.5">
        <div className="relative">
          <Star className="w-4 h-4 text-warning" />
          <div className="absolute inset-0 blur-md bg-warning/20 rounded-full" />
        </div>
        <h2 className="text-sm font-bold text-txt-primary tracking-tight">Watchlist</h2>
        <span className="ml-auto text-xs text-txt-muted bg-dark-700/50 px-2 py-0.5 rounded-full font-mono">{watchlist.length}</span>
        <button
          onClick={handleAddGroup}
          className="p-1.5 hover:bg-dark-600/50 rounded-lg transition-all duration-200"
          title="Neue Gruppe hinzufuegen"
        >
          <FolderPlus className="w-3.5 h-3.5 text-txt-secondary" />
        </button>
        {isMobile && (
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 hover:bg-dark-600/50 rounded-lg transition-all duration-200 ml-1"
          >
            <X className="w-4 h-4 text-txt-secondary" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {watchlist.length === 0 && (
          <div className="p-6 text-sm text-txt-secondary text-center">
            <Star className="w-8 h-8 text-txt-muted/30 mx-auto mb-3" />
            Keine Aktien in der Watchlist.
            <br />
            <span className="text-txt-muted text-xs mt-1 block">Suche eine Aktie und füge sie hinzu.</span>
          </div>
        )}

        {grouped.map((section) => {
          const isCollapsed = collapsedGroups.has(section.label);
          const showHeader = hasGroups;

          return (
            <div key={section.label}>
              {showHeader && (
                <button
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-txt-muted hover:text-txt-secondary hover:bg-dark-700/30 transition-all duration-150"
                  onClick={() => toggleGroup(section.label)}
                >
                  <ChevronDown
                    className={`w-3 h-3 transition-transform duration-300 ${isCollapsed ? '-rotate-90' : ''}`}
                  />
                  {section.label}
                  <span className="ml-auto text-[10px] font-normal bg-dark-700/40 px-1.5 py-0.5 rounded-full">
                    {section.items.length}
                  </span>
                </button>
              )}

              <div className={`collapse-grid ${isCollapsed ? 'collapsed' : ''}`}>
                <div className="collapse-inner">
                  {section.items.map(({ item, globalIndex }) => (
                    <WatchlistRow
                      key={item.symbol}
                      item={item}
                      globalIndex={globalIndex}
                      quote={quotes[item.symbol]}
                      sparkData={sparklines[item.symbol] || []}
                      dragIndex={dragIndex}
                      dropTargetIndex={dropTargetIndex}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onDragEnd={handleDragEnd}
                      onNavigate={handleItemClick}
                      onRemove={handleRemoveWithToast}
                      onOpenMenu={handleOpenMenu}
                      fpSidebar={fpSidebar}
                      flash={flashSymbols[item.symbol]}
                      flashKey={flashKey}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <GroupContextMenu
          item={contextMenu.item}
          groups={watchlistGroups}
          onAssign={setWatchlistGroup}
          onClose={() => setContextMenu(null)}
          position={{ x: contextMenu.x, y: contextMenu.y }}
        />
      )}
    </>
  );

  // Desktop: inline sidebar
  if (!isMobile) {
    if (!sidebarOpen) return null;
    return (
      <aside
        className="w-72 border-r flex flex-col shrink-0 overflow-hidden"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(16px) saturate(180%)',
          WebkitBackdropFilter: 'blur(16px) saturate(180%)',
          borderColor: 'var(--glass-border)',
        }}
      >
        {sidebarContent}
      </aside>
    );
  }

  // Mobile: overlay drawer
  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 animate-backdrop-in"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          onClick={handleBackdropClick}
        />
      )}
      <aside
        className={`fixed top-0 left-0 h-full w-72 border-r flex flex-col z-50 transform transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          borderColor: 'var(--glass-border)',
        }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
