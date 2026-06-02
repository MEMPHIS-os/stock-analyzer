import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Grid3x3 } from 'lucide-react';
import { fetchHeatmap, type HeatmapStock } from '../api';
import { formatPercent, formatLargeNumber } from '../formatters';

function getHeatmapColor(pct: number): string {
  const clamped = Math.max(-5, Math.min(5, pct));
  if (clamped >= 0) {
    const t = clamped / 5;
    const r = Math.round(38 - t * 20);
    const g = Math.round(100 + t * 66);
    const b = Math.round(80 + t * 20);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const t = -clamped / 5;
    const r = Math.round(200 + t * 39);
    const g = Math.round(70 - t * 35);
    const b = Math.round(70 - t * 35);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
  stock: HeatmapStock;
}

function layoutTreemap(
  items: HeatmapStock[],
  x: number,
  y: number,
  w: number,
  h: number,
  totalVal: number,
  rects: TreemapRect[]
) {
  if (!items.length) return;
  if (items.length === 1) {
    rects.push({ x, y, w, h, stock: items[0] });
    return;
  }

  const isHorizontal = w >= h;
  let consumed = 0;
  const half = totalVal / 2;
  let splitIdx = 0;

  for (let i = 0; i < items.length; i++) {
    consumed += items[i].marketCap;
    if (consumed >= half) {
      splitIdx = i + 1;
      break;
    }
  }
  if (splitIdx === 0) splitIdx = 1;
  if (splitIdx >= items.length) splitIdx = items.length - 1;

  const firstHalf = items.slice(0, splitIdx);
  const secondHalf = items.slice(splitIdx);
  const firstVal = firstHalf.reduce((s, i) => s + i.marketCap, 0);
  const ratio = firstVal / totalVal;

  if (isHorizontal) {
    const splitW = w * ratio;
    layoutTreemap(firstHalf, x, y, splitW, h, firstVal, rects);
    layoutTreemap(secondHalf, x + splitW, y, w - splitW, h, totalVal - firstVal, rects);
  } else {
    const splitH = h * ratio;
    layoutTreemap(firstHalf, x, y, w, splitH, firstVal, rects);
    layoutTreemap(secondHalf, x, y + splitH, w, h - splitH, totalVal - firstVal, rects);
  }
}

export default function Heatmap() {
  const navigate = useNavigate();
  const [data, setData] = useState<Record<string, HeatmapStock[]>>({});
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ w: 1200, h: 600 });
  const [tooltip, setTooltip] = useState<{ stock: HeatmapStock; x: number; y: number } | null>(null);

  useEffect(() => {
    fetchHeatmap()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        setDimensions({ w: width, h: width / 2 });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="h-8 w-56 rounded-lg skeleton-shimmer" />
        <div className="card overflow-hidden">
          <div className="w-full skeleton-shimmer" style={{ aspectRatio: '2/1' }} />
        </div>
      </div>
    );
  }

  const allStocks = Object.values(data)
    .flat()
    .sort((a, b) => b.marketCap - a.marketCap);
  const totalVal = allStocks.reduce((s, st) => s + st.marketCap, 0);

  const rects: TreemapRect[] = [];
  layoutTreemap(allStocks, 0, 0, dimensions.w, dimensions.h, totalVal, rects);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="p-2 rounded-xl bg-accent/10">
          <Grid3x3 className="w-5 h-5 text-accent" />
        </div>
        <h2 className="section-title text-xl">Markt-Heatmap</h2>
        <span className="text-xs text-txt-muted ml-1">
          Größe = Marktkapitalisierung, Farbe = Tagesveränderung
        </span>
      </div>

      {/* Color legend */}
      <div className="flex items-center gap-2 text-xs text-txt-secondary">
        <span>-5%</span>
        <div className="flex h-3 w-40 rounded-sm overflow-hidden">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="flex-1"
              style={{ backgroundColor: getHeatmapColor(-5 + (i * 10) / 20) }}
            />
          ))}
        </div>
        <span>+5%</span>
      </div>

      <div ref={containerRef} className="card overflow-hidden">
        <svg
          viewBox={`0 0 ${dimensions.w} ${dimensions.h}`}
          className="w-full"
          style={{ aspectRatio: '2/1' }}
        >
          {rects.map((r) => {
            const showText = r.w > 45 && r.h > 28;
            const showPrice = r.w > 70 && r.h > 42;
            const fontSize = r.w > 80 ? 12 : 9;
            return (
              <g
                key={r.stock.symbol}
                onClick={() => navigate(`/stock/${r.stock.symbol}`)}
                className="cursor-pointer"
                role="button"
                onMouseEnter={(e) => setTooltip({ stock: r.stock, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setTooltip({ stock: r.stock, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTooltip(null)}
              >
                <rect
                  x={r.x + 0.5}
                  y={r.y + 0.5}
                  width={Math.max(0, r.w - 1)}
                  height={Math.max(0, r.h - 1)}
                  fill={getHeatmapColor(r.stock.changePercent)}
                  rx={2}
                />
                {showText && (
                  <>
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 - (showPrice ? 6 : 0)}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="white"
                      fontSize={fontSize}
                      fontWeight="bold"
                      fontFamily="monospace"
                    >
                      {r.stock.symbol}
                    </text>
                    <text
                      x={r.x + r.w / 2}
                      y={r.y + r.h / 2 + (showPrice ? 10 : 12)}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="rgba(255,255,255,0.85)"
                      fontSize={fontSize - 1}
                      fontFamily="monospace"
                    >
                      {formatPercent(r.stock.changePercent)}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Sector chips */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(data).map(([sector, stocks]) => {
          const sectorChange =
            stocks.reduce((s, st) => s + st.changePercent * st.marketCap, 0) /
            stocks.reduce((s, st) => s + st.marketCap, 0);
          const up = sectorChange >= 0;
          return (
            <span
              key={sector}
              className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-2 ring-1 transition-colors duration-200 ${
                up ? 'bg-success/10 ring-success/15' : 'bg-danger/10 ring-danger/15'
              }`}
            >
              <span className="text-txt-secondary font-medium">{sector}</span>
              <span className={`font-mono font-semibold tabular-nums ${up ? 'text-success' : 'text-danger'}`}>
                {formatPercent(sectorChange)}
              </span>
            </span>
          );
        })}
      </div>

      {/* Heatmap Tooltip */}
      {tooltip && (
        <div
          className="fixed z-[100] pointer-events-none card border border-border/20 shadow-depth-lg p-3 text-xs animate-scale-in"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10, transform: 'translateY(-100%)', minWidth: 180 }}
        >
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <span className="font-mono font-bold text-accent text-sm">{tooltip.stock.symbol}</span>
            <span
              className={`text-xs font-mono font-semibold tabular-nums px-1.5 py-0.5 rounded-md ${
                tooltip.stock.changePercent >= 0
                  ? 'bg-success/15 text-success'
                  : 'bg-danger/15 text-danger'
              }`}
            >
              {formatPercent(tooltip.stock.changePercent)}
            </span>
          </div>
          <div className="text-txt-secondary text-[11px] mb-2 truncate">{tooltip.stock.shortName}</div>
          <div className="space-y-1 border-t border-border/10 pt-1.5">
            <div className="flex justify-between gap-4">
              <span className="text-txt-muted">Kurs</span>
              <span className="font-mono tabular-nums text-txt-primary">${tooltip.stock.price.toFixed(2)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-txt-muted">Marktkapit.</span>
              <span className="font-mono tabular-nums text-txt-primary">{formatLargeNumber(tooltip.stock.marketCap)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
