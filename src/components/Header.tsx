import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BarChart3,
  LayoutDashboard,
  GitCompareArrows,
  PanelLeftOpen,
  PanelLeftClose,
  Settings,
  Grid3x3,
  SlidersHorizontal,
  LayoutGrid,
  Bell,
  Briefcase,
  Globe,
  Search,
  X,
  FlaskConical,
  ChevronDown,
  PiggyBank,
} from 'lucide-react';
import SearchBar from './SearchBar';
import { useApp } from '../context';

export default function Header() {
  const location = useLocation();
  const { sidebarOpen, setSidebarOpen, activeAlerts, triggeredAlerts, setAlertsPanelOpen, setSettingsPanelOpen, locale, t } = useApp();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close "More" dropdown on click outside
  useEffect(() => {
    if (!moreOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [moreOpen]);

  const primaryNav = [
    { path: '/', label: t('nav.dashboard'), icon: LayoutDashboard },
    { path: '/screener', label: t('nav.screener'), icon: SlidersHorizontal },
    { path: '/funds', label: t('nav.funds'), icon: PiggyBank },
    { path: '/portfolio', label: t('nav.portfolio'), icon: Briefcase },
    { path: '/global', label: t('nav.globalMarkets'), icon: Globe },
  ];

  const moreNav = [
    { path: '/heatmap', label: t('nav.heatmap'), icon: Grid3x3 },
    { path: '/multi', label: t('nav.multiChart'), icon: LayoutGrid },
    { path: '/compare', label: t('nav.compare'), icon: GitCompareArrows },
    { path: '/backtesting', label: t('nav.backtesting'), icon: FlaskConical },
  ];

  const moreIsActive = moreNav.some((item) => location.pathname === item.path);

  return (
    <header className="h-12 md:h-14 border-b flex items-center px-2 md:px-4 gap-2 md:gap-4 shrink-0 z-40 relative"
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderColor: 'var(--glass-border)',
      }}
    >
      {/* Subtle gradient line at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />

      {/* Mobile search overlay */}
      {mobileSearchOpen && (
        <div className="absolute inset-x-0 top-0 h-12 md:hidden z-50 flex items-center px-2 gap-2 animate-fade-in"
          style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
        >
          <div className="flex-1">
            <SearchBar />
          </div>
          <button
            onClick={() => setMobileSearchOpen(false)}
            className="btn-ghost p-2 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Sidebar toggle - hidden on mobile (MobileNav handles it) */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="hidden md:flex btn-ghost p-2 items-center justify-center"
        title={sidebarOpen ? 'Sidebar schließen' : 'Sidebar öffnen'}
      >
        {sidebarOpen ? (
          <PanelLeftClose className="w-5 h-5" />
        ) : (
          <PanelLeftOpen className="w-5 h-5" />
        )}
      </button>

      <Link to="/" className="flex items-center gap-2 shrink-0 group">
        <div className="relative">
          <BarChart3 className="w-5 h-5 md:w-6 md:h-6 text-accent transition-transform duration-200 group-hover:scale-110" />
          <div className="absolute inset-0 blur-lg bg-accent/20 rounded-full scale-150 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        </div>
        <span className="font-bold text-base md:text-lg hidden sm:block text-gradient-warm">
          StockAnalyzer
        </span>
      </Link>

      <nav className="hidden md:flex items-center gap-0.5 ml-4">
        {primaryNav.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'text-accent bg-accent/10 shadow-glow-sm'
                  : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600/50'
              }`}
            >
              <item.icon className={`w-4 h-4 ${isActive ? 'text-accent' : ''}`} />
              {item.label}
            </Link>
          );
        })}
        {/* "Mehr" dropdown */}
        <div className="relative" ref={moreRef}>
          <button
            onClick={() => setMoreOpen((prev) => !prev)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium transition-all duration-200 ${
              moreIsActive
                ? 'text-accent bg-accent/10 shadow-glow-sm'
                : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600/50'
            }`}
          >
            {locale === 'de' ? 'Mehr' : 'More'}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${moreOpen ? 'rotate-180' : ''}`} />
          </button>
          {moreOpen && (
            <div className="absolute top-full left-0 mt-2 rounded-xl shadow-depth-lg py-1.5 min-w-[200px] z-50 animate-scale-in overflow-hidden"
              style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', border: '1px solid var(--glass-border)' }}
            >
              {moreNav.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setMoreOpen(false)}
                  className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-all duration-150 ${
                    location.pathname === item.path
                      ? 'text-accent bg-accent/10'
                      : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600/40'
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* Desktop search */}
      <div className="hidden md:flex flex-1 justify-center px-4">
        <SearchBar />
      </div>

      {/* Mobile search toggle */}
      <div className="flex-1 md:hidden" />
      <button
        onClick={() => setMobileSearchOpen(true)}
        className="md:hidden btn-ghost p-2"
        title="Search"
      >
        <Search className="w-5 h-5" />
      </button>

      <div className="flex items-center gap-0.5 md:gap-1 shrink-0">
        <button
          onClick={() => setAlertsPanelOpen(true)}
          className="btn-ghost p-2 relative group"
          title={t('header.alerts')}
        >
          <Bell className="w-4 h-4 transition-transform duration-200 group-hover:scale-110" />
          {triggeredAlerts.length > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 bg-danger text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-pulse shadow-glow-danger">
              {triggeredAlerts.length}
            </span>
          ) : activeAlerts.length > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 bg-accent text-white text-[9px] font-bold rounded-full flex items-center justify-center shadow-glow-sm">
              {activeAlerts.length}
            </span>
          ) : null}
        </button>
        <button
          onClick={() => setSettingsPanelOpen(true)}
          className="btn-ghost p-2 group"
          title={locale === 'de' ? 'Einstellungen' : 'Settings'}
        >
          <Settings className="w-4 h-4 transition-transform duration-300 group-hover:rotate-90" />
        </button>
      </div>

      <div className="shrink-0 text-xs text-txt-muted hidden lg:flex items-center gap-1.5">
        <div className="live-dot" />
        {t('header.dataVia')}
      </div>
    </header>
  );
}
