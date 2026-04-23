import { useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useApp } from '../context';
import { usePrice } from '../hooks/usePrice';

export interface TickerItem {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  currency?: string;
}

interface TickerBandProps {
  items: TickerItem[];
}

function TickerSegment({ items, fp, onNavigate }: {
  items: TickerItem[];
  fp: (price: number | undefined | null, currency?: string) => string;
  onNavigate: (symbol: string) => void;
}) {
  return (
    <>
      {items.map((item, i) => {
        const isPositive = item.change >= 0;
        return (
          <span key={`${item.symbol}-${i}`} className="inline-flex items-center">
            <span className="mx-3 w-1 h-1 rounded-full bg-border/30 shrink-0" />
            <button
              onClick={() => onNavigate(item.symbol)}
              className="inline-flex items-center gap-1.5 hover:bg-dark-700/40 px-2 py-0.5 rounded-lg transition-all duration-200 cursor-pointer"
              style={{ fontSize: '11px', lineHeight: '24px' }}
            >
              <span className="font-bold text-accent">{item.symbol}</span>
              <span className="text-txt-secondary font-mono">
                {fp(item.price, item.currency || 'USD')}
              </span>
              <span
                className={`inline-flex items-center gap-0.5 font-semibold ${
                  isPositive ? 'text-success' : 'text-danger'
                }`}
              >
                {isPositive ? (
                  <TrendingUp className="w-2.5 h-2.5" />
                ) : (
                  <TrendingDown className="w-2.5 h-2.5" />
                )}
                {isPositive ? '+' : ''}
                {item.changePercent.toFixed(2)}%
              </span>
            </button>
          </span>
        );
      })}
    </>
  );
}

export default function TickerBand({ items }: TickerBandProps) {
  const { fp } = usePrice();
  const navigate = useNavigate();
  const trackRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const posRef = useRef(0);
  const pausedRef = useRef(false);

  const handleNavigate = useCallback((symbol: string) => {
    navigate(`/stock/${symbol}`);
  }, [navigate]);

  // JS-driven animation for pixel-perfect seamless scrolling
  useEffect(() => {
    if (!items.length) return;

    let lastTime = 0;
    const speed = 50; // px per second

    const tick = (time: number) => {
      if (!trackRef.current) { rafRef.current = requestAnimationFrame(tick); return; }

      if (lastTime === 0) lastTime = time;
      const delta = (time - lastTime) / 1000;
      lastTime = time;

      if (!pausedRef.current) {
        posRef.current -= speed * delta;

        // Measure one segment (track has 3 copies) for seamless wrap
        const segmentWidth = trackRef.current.scrollWidth / 3;
        if (segmentWidth > 0 && Math.abs(posRef.current) >= segmentWidth) {
          posRef.current += segmentWidth;
        }

        trackRef.current.style.transform = `translate3d(${posRef.current}px, 0, 0)`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [items]);

  if (!items.length) return null;

  return (
    <div
      className="border-b overflow-hidden shrink-0 relative h-7"
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderColor: 'var(--glass-border)',
      }}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
    >
      {/* Fade edges */}
      <div className="absolute left-0 top-0 bottom-0 w-8 z-10 pointer-events-none" style={{ background: 'linear-gradient(to right, rgb(var(--color-bg-900)), transparent)' }} />
      <div className="absolute right-0 top-0 bottom-0 w-8 z-10 pointer-events-none" style={{ background: 'linear-gradient(to left, rgb(var(--color-bg-900)), transparent)' }} />

      <div
        ref={trackRef}
        className="flex items-center h-full whitespace-nowrap"
        style={{ width: 'max-content', willChange: 'transform' }}
      >
        {[0, 1, 2].map((copy) => (
          <div key={copy} className="inline-flex items-center shrink-0">
            <TickerSegment items={items} fp={fp} onNavigate={handleNavigate} />
          </div>
        ))}
      </div>
    </div>
  );
}
