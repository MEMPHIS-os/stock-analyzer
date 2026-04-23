import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Star,
  StarOff,
  GitCompareArrows,
  Bell,
  Maximize2,
  ExternalLink,
  Copy,
} from 'lucide-react';
import { useApp } from '../context';

interface ContextMenuProps {
  symbol: string;
  name?: string;
  x: number;
  y: number;
  onClose: () => void;
}

export default function StockContextMenu({ symbol, name, x, y, onClose }: ContextMenuProps) {
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    isInWatchlist,
    addToWatchlist,
    removeFromWatchlist,
    addCompareSymbol,
    setAlertsPanelOpen,
    showToast,
    t,
  } = useApp();

  const inWatchlist = isInWatchlist(symbol);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleScroll() {
      onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Clamp position to viewport
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const nx = x + rect.width > window.innerWidth ? window.innerWidth - rect.width - 8 : x;
      const ny = y + rect.height > window.innerHeight ? window.innerHeight - rect.height - 8 : y;
      setPos({ x: nx, y: ny });
    }
  }, [x, y]);

  const items = [
    {
      icon: Maximize2,
      label: t('contextMenu.openChart'),
      onClick: () => { navigate(`/stock/${symbol}`); onClose(); },
    },
    {
      icon: inWatchlist ? StarOff : Star,
      label: inWatchlist ? t('contextMenu.removeWatchlist') : t('contextMenu.addWatchlist'),
      onClick: () => {
        if (inWatchlist) {
          removeFromWatchlist(symbol);
          showToast(`${symbol} ${t('toast.removedFromWatchlist')}`, 'info');
        } else {
          addToWatchlist(symbol, name || symbol);
          showToast(`${symbol} ${t('toast.addedToWatchlist')}`, 'success');
        }
        onClose();
      },
    },
    {
      icon: GitCompareArrows,
      label: t('contextMenu.compare'),
      onClick: () => { addCompareSymbol(symbol); navigate('/compare'); onClose(); },
    },
    {
      icon: Bell,
      label: t('contextMenu.createAlert'),
      onClick: () => { setAlertsPanelOpen(true); onClose(); },
    },
    { divider: true },
    {
      icon: Copy,
      label: t('contextMenu.copySymbol'),
      onClick: () => {
        navigator.clipboard.writeText(symbol);
        showToast(`${symbol} kopiert`, 'info');
        onClose();
      },
    },
    {
      icon: ExternalLink,
      label: t('contextMenu.yahooFinance'),
      onClick: () => {
        window.open(`https://finance.yahoo.com/quote/${symbol}`, '_blank');
        onClose();
      },
    },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] bg-dark-800 border border-border/40 rounded-lg shadow-2xl py-1 min-w-[200px] animate-fade-in"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Header */}
      <div className="px-3 py-1.5 border-b border-border/20">
        <span className="font-mono font-bold text-sm text-accent">{symbol}</span>
        {name && <span className="text-xs text-txt-muted ml-2">{name}</span>}
      </div>
      {items.map((item, i) => {
        if ('divider' in item && item.divider) {
          return <div key={i} className="border-t border-border/20 my-1" />;
        }
        const Icon = (item as any).icon;
        return (
          <button
            key={i}
            onClick={(item as any).onClick}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-txt-secondary hover:bg-dark-600 hover:text-txt-primary transition-colors text-left"
          >
            <Icon className="w-4 h-4" />
            {(item as any).label}
          </button>
        );
      })}
    </div>
  );
}
