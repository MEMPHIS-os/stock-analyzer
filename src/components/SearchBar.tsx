import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Clock } from 'lucide-react';
import { searchSymbols } from '../api';
import type { SearchResult } from '../types';

const SEARCH_HISTORY_KEY = 'stockanalyzer_search_history';

function loadSearchHistory(): { symbol: string; name: string }[] {
  try {
    const stored = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return [];
}

function saveSearchHistory(history: { symbol: string; name: string }[]) {
  localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
}

export default function SearchBar() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchHistory, setSearchHistory] = useState(loadSearchHistory);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await searchSymbols(q);
      setResults(res);
      setSelectedIndex(-1);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Global shortcut: "/" focuses the quick search (Ctrl+K opens the command palette)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  function selectResult(result: SearchResult) {
    navigate(`/stock/${result.symbol}`);
    setSearchHistory(prev => {
      const filtered = prev.filter(h => h.symbol !== result.symbol);
      const next = [{ symbol: result.symbol, name: result.shortname || result.symbol }, ...filtered].slice(0, 8);
      saveSearchHistory(next);
      return next;
    });
    setQuery('');
    setResults([]);
    setIsOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && selectedIndex >= 0 && results[selectedIndex]) {
      selectResult(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  }

  const dropdownStyle: React.CSSProperties = {
    background: 'var(--glass-bg)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    border: '1px solid var(--glass-border)',
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-txt-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Aktie suchen... (/)"
          className="input w-full pl-10 pr-10"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-muted hover:text-txt-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isOpen && !query.trim() && searchHistory.length > 0 && (
        <div
          className="absolute top-full left-0 right-0 mt-2 rounded-xl shadow-depth-lg z-50 overflow-hidden animate-scale-in"
          style={dropdownStyle}
        >
          <div className="px-4 py-2 flex items-center justify-between">
            <span className="text-[10px] text-txt-muted uppercase tracking-wider font-medium">Zuletzt gesucht</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSearchHistory([]);
                saveSearchHistory([]);
              }}
              className="text-[10px] text-txt-muted hover:text-danger transition-colors"
            >
              Löschen
            </button>
          </div>
          {searchHistory.map((h) => (
            <button
              key={h.symbol}
              onClick={() => {
                navigate(`/stock/${h.symbol}`);
                setIsOpen(false);
                inputRef.current?.blur();
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150 hover:bg-dark-600/40"
            >
              <Clock className="w-3.5 h-3.5 text-txt-muted" />
              <span className="font-mono font-bold text-sm text-accent min-w-[60px]">
                {h.symbol}
              </span>
              <span className="text-sm text-txt-primary truncate flex-1">
                {h.name}
              </span>
            </button>
          ))}
        </div>
      )}

      {isOpen && (query.trim() || results.length > 0) && (
        <div
          className="absolute top-full left-0 right-0 mt-2 rounded-xl shadow-depth-lg z-50 overflow-hidden animate-scale-in"
          style={dropdownStyle}
        >
          {loading && (
            <div className="px-4 py-3 text-sm text-txt-secondary">Suche...</div>
          )}
          {!loading && results.length === 0 && query.trim() && (
            <div className="px-4 py-3 text-sm text-txt-secondary">
              Keine Ergebnisse
            </div>
          )}
          {results.map((result, i) => (
            <button
              key={result.symbol}
              onClick={() => selectResult(result)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150 ${
                i === selectedIndex ? 'bg-accent/10' : 'hover:bg-dark-600/40'
              }`}
            >
              <span className="font-mono font-bold text-sm text-accent min-w-[60px]">
                {result.symbol}
              </span>
              <span className="text-sm text-txt-primary truncate flex-1">
                {result.shortname}
              </span>
              <span className="text-xs text-txt-muted bg-dark-700/40 px-2 py-0.5 rounded-full">{result.exchange}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
