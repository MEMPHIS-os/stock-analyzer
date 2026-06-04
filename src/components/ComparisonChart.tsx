import { useEffect, useRef, useMemo } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { useApp } from '../context';
import type { OHLCVData } from '../types';

export interface CompareEntry {
  symbol: string;
  data: OHLCVData[];
  color: string;
}

interface ComparisonChartProps {
  primarySymbol: string;
  primaryData: OHLCVData[];
  compares: CompareEntry[];
  height?: number;
}

/** Palette for compared symbols (primary uses the theme accent). */
export const COMPARE_COLORS = ['#ff9800', '#26a69a', '#e91e63', '#7c4dff', '#00bcd4', '#facc15'];

/** Normalize a close series to percent change from its first valid value. */
function toPercentSeries(data: OHLCVData[]): { time: string | number; value: number }[] {
  const out: { time: string | number; value: number }[] = [];
  let base: number | null = null;
  for (const d of data) {
    const c = d.close;
    if (c == null || isNaN(c)) continue;
    if (base == null) {
      if (c === 0) continue;
      base = c;
    }
    out.push({ time: d.date, value: (c / base - 1) * 100 });
  }
  return out;
}

function lastValue(data: OHLCVData[]): number | null {
  const pct = toPercentSeries(data);
  return pct.length ? pct[pct.length - 1].value : null;
}

export default function ComparisonChart({ primarySymbol, primaryData, compares, height = 480 }: ComparisonChartProps) {
  const { theme } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);

  const accent = useMemo(() => {
    if (typeof window === 'undefined') return '#2962ff';
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return v || '#2962ff';
  }, []);

  // All series in render order: primary first, then compares.
  const series = useMemo(
    () => [
      { symbol: primarySymbol, data: primaryData, color: accent },
      ...compares,
    ],
    [primarySymbol, primaryData, compares, accent],
  );

  const colors = useMemo(
    () => ({
      bg: theme === 'dark' ? '#131722' : '#ffffff',
      grid: theme === 'dark' ? '#1e222d' : '#e8e8e8',
      text: theme === 'dark' ? '#787b86' : '#5a5a6e',
      border: theme === 'dark' ? '#2B2B43' : '#d0d0e0',
      crosshair: theme === 'dark' ? '#9598a1' : '#888888',
      zero: theme === 'dark' ? '#3a3f4b' : '#c4c4d4',
    }),
    [theme],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !primaryData.length) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: colors.bg },
        textColor: colors.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: colors.crosshair, labelBackgroundColor: accent },
        horzLine: { color: colors.crosshair, labelBackgroundColor: accent },
      },
      rightPriceScale: { borderColor: colors.border, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: colors.border, timeVisible: true, secondsVisible: false },
      localization: {
        priceFormatter: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`,
      },
    });
    chartApiRef.current = chart;

    const seriesApis: { symbol: string; color: string; api: ISeriesApi<'Line'> }[] = [];
    series.forEach((s, i) => {
      const api = chart.addLineSeries({
        color: s.color,
        lineWidth: i === 0 ? 2 : 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
      });
      api.setData(toPercentSeries(s.data) as any);
      seriesApis.push({ symbol: s.symbol, color: s.color, api });
    });

    // 0% reference line on the primary series.
    if (seriesApis[0]) {
      seriesApis[0].api.createPriceLine({
        price: 0,
        color: colors.zero,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
        title: '',
      });
    }

    chart.timeScale().fitContent();

    // Legend (live on crosshair, last value otherwise).
    const renderLegend = (values: Record<string, number | null>) => {
      const el = legendRef.current;
      if (!el) return;
      el.innerHTML = seriesApis
        .map(({ symbol, color }) => {
          const v = values[symbol];
          const txt = v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
          const cls = v == null ? '' : v >= 0 ? 'color:#26a69a' : 'color:#ef5350';
          return `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px">
            <span style="width:9px;height:9px;border-radius:2px;background:${color};display:inline-block"></span>
            <span style="font-weight:700;color:${color}">${symbol}</span>
            <span style="font-family:'JetBrains Mono',monospace;${cls}">${txt}</span>
          </span>`;
        })
        .join('');
    };

    const lastValues: Record<string, number | null> = {};
    series.forEach((s) => { lastValues[s.symbol] = lastValue(s.data); });
    renderLegend(lastValues);

    const onMove = (param: any) => {
      if (!param.time || !param.seriesData) {
        renderLegend(lastValues);
        return;
      }
      const vals: Record<string, number | null> = {};
      seriesApis.forEach(({ symbol, api }) => {
        const d = param.seriesData.get(api);
        vals[symbol] = d && typeof d.value === 'number' ? d.value : null;
      });
      renderLegend(vals);
    };
    chart.subscribeCrosshairMove(onMove);

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartApiRef.current = null;
    };
  }, [series, colors, accent, height, primaryData.length]);

  return (
    <div className="relative">
      <div
        ref={legendRef}
        className="absolute top-2 left-3 z-10 text-xs pointer-events-none select-none"
      />
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
