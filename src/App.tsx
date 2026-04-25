import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './context';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import TickerBand from './components/TickerBand';
import type { TickerItem } from './components/TickerBand';
import Dashboard from './pages/Dashboard';
import StockDetail from './pages/StockDetail';
import ComparisonView from './components/ComparisonView';
import KeyboardShortcuts from './components/KeyboardShortcuts';
import AlertsPanel from './components/AlertsPanel';
import ToastContainer from './components/Toast';
import SettingsPanel from './components/SettingsPanel';
import LoadingSpinner from './components/LoadingSpinner';
import UpdateBanner from './components/UpdateBanner';
import ErrorBoundary from './components/ErrorBoundary';
import { fetchQuotes } from './api';
import { useMarketAlerts, loadMarketAlertsEnabled } from './hooks/useMarketAlerts';

const Heatmap = lazy(() => import('./pages/Heatmap'));
const Screener = lazy(() => import('./pages/Screener'));
const MultiChart = lazy(() => import('./pages/MultiChart'));
const Portfolio = lazy(() => import('./pages/Portfolio'));
const GlobalMarkets = lazy(() => import('./pages/GlobalMarkets'));
const Forecast = lazy(() => import('./pages/Forecast'));
const Backtesting = lazy(() => import('./pages/Backtesting'));
const Funds = lazy(() => import('./pages/Funds'));

const TICKER_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'NFLX', 'JPM', 'V'];

function AppShell() {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [tickerItems, setTickerItems] = useState<TickerItem[]>([]);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [tickerHidden, setTickerHidden] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const {
    setSidebarOpen, sidebarOpen,
    alerts, activeAlerts, triggeredAlerts,
    addAlert, removeAlert, clearTriggered,
    alertsPanelOpen, setAlertsPanelOpen,
    settingsPanelOpen, setSettingsPanelOpen,
    t, locale, showToast,
  } = useApp();

  // Market open alerts
  const [marketAlertsEnabled] = useState(() => loadMarketAlertsEnabled());
  useMarketAlerts(showToast, locale, marketAlertsEnabled);

  // Auto-close sidebar on mobile when route changes
  useEffect(() => {
    const isMobile = window.matchMedia('(max-width: 1023px)').matches;
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [location.pathname, setSidebarOpen]);

  // Load ticker data
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchQuotes(TICKER_SYMBOLS);
        if (!cancelled) {
          setTickerItems(
            data.map((q) => ({
              symbol: q.symbol,
              price: q.regularMarketPrice,
              change: q.regularMarketChange ?? 0,
              changePercent: q.regularMarketChangePercent ?? 0,
              currency: q.currency,
            }))
          );
        }
      } catch {}
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      }
      if (e.key === 'Escape') setShowShortcuts(false);
      if (e.key === 'w' || e.key === 'W') {
        // Only toggle sidebar if not on a page where W might conflict
        if (!(e.target as HTMLElement).closest('[data-no-w-shortcut]')) {
          setSidebarOpen(!sidebarOpen);
        }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [setSidebarOpen, sidebarOpen]);

  // Auto-hide ticker band & show scroll-to-top on scroll
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    function handleScroll() {
      const scrollTop = el!.scrollTop;
      setTickerHidden(scrollTop > 40);
      setShowScrollTop(scrollTop > 300);
    }
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-dark-900">
      <UpdateBanner />
      <div className={`transition-all duration-300 overflow-hidden ${tickerHidden ? 'h-0' : 'h-7'}`}>
        <TickerBand items={tickerItems} />
      </div>
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main ref={mainRef} className="flex-1 overflow-y-auto p-4 lg:p-6 pb-18 md:pb-4 lg:pb-6 relative">
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<LoadingSpinner text={t('general.loading')} />}>
              <div className="animate-page-enter">
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/stock/:symbol" element={<StockDetail />} />
                  <Route path="/compare" element={<ComparisonView />} />
                  <Route path="/heatmap" element={<Heatmap />} />
                  <Route path="/screener" element={<Screener />} />
                  <Route path="/multi" element={<MultiChart />} />
                  <Route path="/portfolio" element={<Portfolio />} />
                  <Route path="/global" element={<GlobalMarkets />} />
                  <Route path="/forecast" element={<Forecast />} />
                  <Route path="/backtesting" element={<Backtesting />} />
                  <Route path="/funds" element={<Funds />} />
                </Routes>
              </div>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <MobileNav />
      <KeyboardShortcuts
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
      {alertsPanelOpen && (
        <AlertsPanel
          alerts={alerts}
          activeAlerts={activeAlerts}
          triggeredAlerts={triggeredAlerts}
          onAdd={addAlert}
          onRemove={removeAlert}
          onClearTriggered={clearTriggered}
          onClose={() => setAlertsPanelOpen(false)}
        />
      )}
      {settingsPanelOpen && (
        <SettingsPanel onClose={() => setSettingsPanelOpen(false)} />
      )}
      {showScrollTop && (
        <button
          onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-20 md:bottom-6 right-6 z-40 w-11 h-11 rounded-2xl text-white flex items-center justify-center hover:shadow-glow transition-all duration-300 animate-fade-in active:scale-90"
          style={{
            background: 'linear-gradient(135deg, #2962ff 0%, #1e88e5 100%)',
            boxShadow: '0 4px 16px -4px rgba(41, 98, 255, 0.4)',
          }}
          title={locale === 'de' ? 'Nach oben' : 'Scroll to top'}
          aria-label="Scroll to top"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </BrowserRouter>
  );
}
