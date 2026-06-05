import { useEffect, useRef, useState, useMemo, useCallback, forwardRef, useImperativeHandle } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { IChartApi, SeriesMarker, Time } from 'lightweight-charts';
import {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateHeikinAshi,
  calculateStochastic,
  calculateATR,
  calculateVWAP,
  calculateWilliamsR,
  calculateIchimoku,
  calculatePivotPoints,
} from '../indicators';
import { useApp } from '../context';
import { formatPrice } from '../formatters';
import type { OHLCVData, IndicatorType, ChartType } from '../types';
import type { Drawing } from '../hooks/useDrawings';
import type { PriceAlert } from '../hooks/useAlerts';

export interface StockChartRef {
  takeScreenshot: () => HTMLCanvasElement | null;
  getChartApi: () => IChartApi | null;
}

interface StockChartProps {
  data: OHLCVData[];
  chartType: ChartType;
  indicators: IndicatorType[];
  height?: number;
  drawings?: Drawing[];
  onChartClick?: (time: string, price: number) => void;
  onRemoveDrawing?: (id: string) => void;
  onUpdateDrawing?: (id: string, changes: Partial<Omit<Drawing, 'id'>>) => void;
  drawingActive?: boolean;
  pendingTextPoint?: { time: string; price: number } | null;
  onConfirmText?: (content: string) => void;
  onCancelText?: () => void;
  markers?: SeriesMarker<Time>[];
  currency?: string;
  alertLevels?: PriceAlert[];
  logScale?: boolean;
  showVolumeProfile?: boolean;
}

const INDICATOR_COLORS: Record<string, string> = {
  sma20: '#2962ff',
  sma50: '#ff9800',
  sma200: '#e91e63',
  ema12: '#00bcd4',
  ema26: '#9c27b0',
  bbUpper: '#7e57c2',
  bbLower: '#7e57c2',
  bbMiddle: '#7e57c2',
  vwap: '#ff6d00',
  ichimokuTenkan: '#2962ff',
  ichimokuKijun: '#e91e63',
  ichimokuSenkouA: 'rgba(38, 166, 154, 0.5)',
  ichimokuSenkouB: 'rgba(239, 83, 80, 0.5)',
  ichimokuChikou: '#9c27b0',
};

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ['#ef5350', '#ff9800', '#ffeb3b', '#4caf50', '#2196f3', '#7e57c2', '#ef5350'];

const StockChart = forwardRef<StockChartRef, StockChartProps>(function StockChart(
  { data, chartType, indicators, height = 480, drawings = [], onChartClick, onRemoveDrawing, onUpdateDrawing, drawingActive = false, pendingTextPoint, onConfirmText, onCancelText, markers = [], currency = 'USD', alertLevels = [], logScale = false, showVolumeProfile = false },
  ref
) {
  const mainChartRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<HTMLDivElement>(null);
  const macdChartRef = useRef<HTMLDivElement>(null);
  const stochChartRef = useRef<HTMLDivElement>(null);
  const atrChartRef = useRef<HTMLDivElement>(null);
  const williamsChartRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mainChartApi = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<any>(null);
  const rsiChartApi = useRef<IChartApi | null>(null);
  const macdChartApi = useRef<IChartApi | null>(null);
  const stochChartApi = useRef<IChartApi | null>(null);
  const atrChartApi = useRef<IChartApi | null>(null);
  const williamsChartApi = useRef<IChartApi | null>(null);

  // Use refs for callbacks to avoid chart recreation when tool changes
  const onChartClickRef = useRef(onChartClick);
  onChartClickRef.current = onChartClick;
  const onRemoveDrawingRef = useRef(onRemoveDrawing);
  onRemoveDrawingRef.current = onRemoveDrawing;
  const onUpdateDrawingRef = useRef(onUpdateDrawing);
  onUpdateDrawingRef.current = onUpdateDrawing;
  const drawingActiveRef = useRef(drawingActive);
  drawingActiveRef.current = drawingActive;

  // Text annotation state
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [textInputValue, setTextInputValue] = useState('');
  const textInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  // Drag state for text annotations
  const dragRef = useRef<{ id: string; startX: number; startY: number; origTime: string; origPrice: number } | null>(null);

  const { theme, locale } = useApp();

  const showRSI = indicators.includes('rsi');
  const showMACD = indicators.includes('macd');
  const showStochastic = indicators.includes('stochastic');
  const showATR = indicators.includes('atr');
  const showWilliamsR = indicators.includes('williamsR');

  // Heikin Ashi transformation (display data vs raw data for indicators)
  const displayData = useMemo(() => {
    if (chartType === 'heikinashi') return calculateHeikinAshi(data);
    return data;
  }, [data, chartType]);

  const closes = useMemo(() => data.map((d) => d.close), [data]);
  const times = useMemo(() => data.map((d) => d.date), [data]);
  const dataMap = useMemo(() => {
    const map = new Map<string | number, OHLCVData>();
    data.forEach((d) => map.set(d.date, d));
    return map;
  }, [data]);

  // Theme-aware chart colors
  const chartColors = useMemo(
    () => ({
      bg: theme === 'dark' ? '#131722' : '#ffffff',
      grid: theme === 'dark' ? '#1e222d' : '#e8e8e8',
      text: theme === 'dark' ? '#787b86' : '#5a5a6e',
      border: theme === 'dark' ? '#2B2B43' : '#d0d0e0',
      up: '#26a69a',
      down: '#ef5350',
      crosshair: theme === 'dark' ? '#9598a1' : '#888888',
    }),
    [theme]
  );

  // Expose screenshot API and chart instance
  useImperativeHandle(ref, () => ({
    takeScreenshot: () => {
      if (mainChartApi.current) {
        return mainChartApi.current.takeScreenshot();
      }
      return null;
    },
    getChartApi: () => mainChartApi.current,
  }));

  const createChartOptions = useCallback(
    (h: number) => ({
      layout: {
        background: { type: ColorType.Solid, color: chartColors.bg },
        textColor: chartColors.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: chartColors.grid },
        horzLines: { color: chartColors.grid },
      },
      crosshair: {
        mode: 0 as const,
        vertLine: { color: chartColors.crosshair, labelBackgroundColor: '#2962ff' },
        horzLine: { color: chartColors.crosshair, labelBackgroundColor: '#2962ff' },
      },
      rightPriceScale: {
        borderColor: chartColors.border,
        scaleMargins: { top: 0.05, bottom: 0.2 },
        mode: logScale ? 1 : 0, // 0 = Normal, 1 = Logarithmic
      },
      timeScale: {
        borderColor: chartColors.border,
        timeVisible: true,
        secondsVisible: false,
      },
      height: h,
    }),
    [chartColors, logScale]
  );

  // Main chart
  useEffect(() => {
    if (!mainChartRef.current || !data.length) return;

    const container = mainChartRef.current;
    const chart = createChart(container, {
      ...createChartOptions(height),
      width: container.clientWidth,
    });
    mainChartApi.current = chart;

    // Price series
    let priceSeries: any;
    if (chartType === 'candlestick' || chartType === 'heikinashi') {
      priceSeries = chart.addCandlestickSeries({
        upColor: chartColors.up,
        downColor: chartColors.down,
        borderUpColor: chartColors.up,
        borderDownColor: chartColors.down,
        wickUpColor: chartColors.up,
        wickDownColor: chartColors.down,
      });
      priceSeries.setData(
        displayData.map((d) => ({
          time: d.date as any,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        }))
      );
    } else if (chartType === 'line') {
      priceSeries = chart.addLineSeries({
        color: chartColors.up,
        lineWidth: 2,
      });
      priceSeries.setData(displayData.map((d) => ({ time: d.date as any, value: d.close })));
    } else {
      priceSeries = chart.addAreaSeries({
        topColor: 'rgba(41, 98, 255, 0.4)',
        bottomColor: 'rgba(41, 98, 255, 0.0)',
        lineColor: '#2962ff',
        lineWidth: 2,
      });
      priceSeries.setData(displayData.map((d) => ({ time: d.date as any, value: d.close })));
    }
    priceSeriesRef.current = priceSeries;

    // Set earnings markers if provided
    if (markers.length > 0) {
      priceSeries.setMarkers(markers);
    }

    // Draw horizontal price lines from drawings
    drawings.filter((d) => d.type === 'hline').forEach((drawing) => {
      priceSeries.createPriceLine({
        price: drawing.points[0].price,
        color: drawing.color,
        lineWidth: 2,
        lineStyle: 0,
        axisLabelVisible: true,
        title: '',
      });
    });

    // Alert level lines (only price-kind alerts have a fixed target line)
    alertLevels.forEach((alert) => {
      if (alert.kind !== 'price' || alert.targetPrice == null) return;
      priceSeries.createPriceLine({
        price: alert.targetPrice,
        color: alert.condition === 'above' ? '#26a69a' : '#ef5350',
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: `\u26A0 ${alert.condition === 'above' ? '\u25B2' : '\u25BC'} ${alert.targetPrice.toFixed(2)}`,
      });
    });

    // Chart click handler for drawing tools (uses ref to avoid recreation)
    chart.subscribeClick((param: any) => {
      if (!onChartClickRef.current || !drawingActiveRef.current) return;
      if (!param.time || !param.point) return;
      try {
        const price = priceSeries.coordinateToPrice(param.point.y);
        if (price != null && !isNaN(price)) {
          onChartClickRef.current(param.time as string, price);
        }
      } catch {}
    });

    // Volume
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    // Gradient volume: opacity scales with relative volume (0.15 – 0.6)
    const maxVol = Math.max(...data.map((d) => d.volume), 1);
    volumeSeries.setData(
      data.map((d) => {
        const alpha = 0.15 + 0.45 * (d.volume / maxVol);
        const color = d.close >= d.open
          ? `rgba(38,166,154,${alpha.toFixed(2)})`
          : `rgba(239,83,80,${alpha.toFixed(2)})`;
        return { time: d.date as any, value: d.volume, color };
      })
    );

    // SMA indicators (use real data, not Heikin Ashi)
    if (indicators.includes('sma20') && closes.length >= 20) {
      const sma = calculateSMA(closes, 20);
      const series = chart.addLineSeries({
        color: INDICATOR_COLORS.sma20,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(sma.map((value, i) => ({ time: times[i + 19] as any, value })));
    }

    if (indicators.includes('sma50') && closes.length >= 50) {
      const sma = calculateSMA(closes, 50);
      const series = chart.addLineSeries({
        color: INDICATOR_COLORS.sma50,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(sma.map((value, i) => ({ time: times[i + 49] as any, value })));
    }

    if (indicators.includes('sma200') && closes.length >= 200) {
      const sma = calculateSMA(closes, 200);
      const series = chart.addLineSeries({
        color: INDICATOR_COLORS.sma200,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(sma.map((value, i) => ({ time: times[i + 199] as any, value })));
    }

    // EMA indicators
    if (indicators.includes('ema12') && closes.length >= 12) {
      const ema = calculateEMA(closes, 12);
      const series = chart.addLineSeries({
        color: INDICATOR_COLORS.ema12,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(ema.map((value, i) => ({ time: times[i + 11] as any, value })));
    }

    if (indicators.includes('ema26') && closes.length >= 26) {
      const ema = calculateEMA(closes, 26);
      const series = chart.addLineSeries({
        color: INDICATOR_COLORS.ema26,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(ema.map((value, i) => ({ time: times[i + 25] as any, value })));
    }

    // Bollinger Bands
    if (indicators.includes('bb') && closes.length >= 20) {
      const bb = calculateBollingerBands(closes, 20, 2);
      const opts = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false };

      const upper = chart.addLineSeries({ ...opts, color: INDICATOR_COLORS.bbUpper });
      upper.setData(bb.upper.map((value, i) => ({ time: times[i + 19] as any, value })));

      const middle = chart.addLineSeries({
        ...opts,
        color: INDICATOR_COLORS.bbMiddle,
        lineStyle: 2,
      });
      middle.setData(bb.middle.map((value, i) => ({ time: times[i + 19] as any, value })));

      const lower = chart.addLineSeries({ ...opts, color: INDICATOR_COLORS.bbLower });
      lower.setData(bb.lower.map((value, i) => ({ time: times[i + 19] as any, value })));
    }

    // VWAP overlay
    if (indicators.includes('vwap') && data.length >= 2) {
      const vwap = calculateVWAP(data);
      const series = chart.addLineSeries({
        color: INDICATOR_COLORS.vwap,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(vwap.map((value, i) => ({ time: times[i] as any, value })));
    }

    // Ichimoku Cloud
    if (indicators.includes('ichimoku') && data.length >= 52) {
      const ichimoku = calculateIchimoku(data);

      // Tenkan-sen (Conversion Line)
      const tenkanSeries = chart.addLineSeries({
        color: '#2962ff',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      tenkanSeries.setData(
        ichimoku.tenkan.map((v, i) => ({ time: times[ichimoku.tenkanStart + i] as any, value: v }))
      );

      // Kijun-sen (Base Line)
      const kijunSeries = chart.addLineSeries({
        color: '#e91e63',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      kijunSeries.setData(
        ichimoku.kijun.map((v, i) => ({ time: times[ichimoku.kijunStart + i] as any, value: v }))
      );

      // Senkou Span A (green cloud boundary) - shifted 26 periods forward
      // We can only plot within our time range, so we just show without displacement
      const senkouASeries = chart.addLineSeries({
        color: 'rgba(38, 166, 154, 0.6)',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      senkouASeries.setData(
        ichimoku.senkouA.map((v, i) => ({ time: times[ichimoku.senkouStart + i] as any, value: v }))
      );

      // Senkou Span B (red cloud boundary)
      const senkouBStart = 52 - 1; // senkouBPeriod - 1
      const senkouBSeries = chart.addLineSeries({
        color: 'rgba(239, 83, 80, 0.6)',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      senkouBSeries.setData(
        ichimoku.senkouB.map((v, i) => ({ time: times[senkouBStart + i] as any, value: v }))
      );

      // Chikou Span (Lagging Span) - plotted 26 periods back
      const chikouSeries = chart.addLineSeries({
        color: '#9c27b0',
        lineWidth: 1,
        lineStyle: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      // Show chikou starting from index 0 but skip the last 26 values
      const chikouEnd = Math.max(0, ichimoku.chikou.length - 26);
      chikouSeries.setData(
        ichimoku.chikou.slice(26).map((v, i) => ({ time: times[i] as any, value: v }))
      );
    }

    // Pivot Points
    if (indicators.includes('pivotPoints') && data.length >= 2) {
      const pivots = calculatePivotPoints(data);
      if (pivots) {
        const pivotLines: { price: number; title: string; color: string; style: number }[] = [
          { price: pivots.pp, title: 'PP', color: '#ffeb3b', style: 0 },
          { price: pivots.r1, title: 'R1', color: '#ef5350', style: 2 },
          { price: pivots.r2, title: 'R2', color: '#ef5350', style: 2 },
          { price: pivots.r3, title: 'R3', color: '#ef5350', style: 1 },
          { price: pivots.s1, title: 'S1', color: '#26a69a', style: 2 },
          { price: pivots.s2, title: 'S2', color: '#26a69a', style: 2 },
          { price: pivots.s3, title: 'S3', color: '#26a69a', style: 1 },
        ];
        for (const pl of pivotLines) {
          priceSeries.createPriceLine({
            price: pl.price,
            color: pl.color,
            lineWidth: 1,
            lineStyle: pl.style,
            axisLabelVisible: true,
            title: pl.title,
          });
        }
      }
    }

    // OHLCV legend helper — renders bar data into the legend element
    function renderLegend(point: OHLCVData) {
      if (!legendRef.current) return;
      const isUp = point.close >= point.open;
      const color = isUp ? '#26a69a' : '#ef5350';
      const vol =
        point.volume >= 1e6
          ? (point.volume / 1e6).toFixed(2) + 'M'
          : point.volume >= 1e3
          ? (point.volume / 1e3).toFixed(1) + 'K'
          : point.volume.toString();
      const dateLabel = typeof point.date === 'number'
        ? new Date(point.date * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
        : point.date;
      const chg = point.close - point.open;
      const chgPct = ((chg / point.open) * 100).toFixed(2);
      const chgSign = chg >= 0 ? '+' : '';
      legendRef.current.style.display = 'flex';
      legendRef.current.innerHTML = `
        <span style="color:${chartColors.text}">${dateLabel}</span>
        <span style="color:${chartColors.text}">O</span><span style="color:${color}">${formatPrice(point.open, currency, locale)}</span>
        <span style="color:${chartColors.text}">H</span><span style="color:${color}">${formatPrice(point.high, currency, locale)}</span>
        <span style="color:${chartColors.text}">L</span><span style="color:${color}">${formatPrice(point.low, currency, locale)}</span>
        <span style="color:${chartColors.text}">C</span><span style="color:${color}">${formatPrice(point.close, currency, locale)}</span>
        <span style="color:${color};font-size:10px">${chgSign}${chgPct}%</span>
        <span style="color:${chartColors.text}">V</span><span style="color:${chartColors.text}">${vol}</span>
      `;
    }

    // Show last bar by default (always visible)
    if (data.length > 0) {
      renderLegend(data[data.length - 1]);
    }

    // Update legend on crosshair move; fall back to last bar when cursor leaves
    chart.subscribeCrosshairMove((param) => {
      if (!legendRef.current) return;
      const point = param.time ? dataMap.get(param.time as string | number) : null;
      renderLegend(point || data[data.length - 1]);
    });

    chart.timeScale().fitContent();

    // Remove TradingView attribution logo from DOM (belt-and-suspenders with CSS)
    requestAnimationFrame(() => {
      const logo = container.querySelector('#tv-attr-logo');
      if (logo) logo.remove();
      const logoStyle = container.querySelector('style');
      if (logoStyle && logoStyle.innerText.includes('tv-attr-logo')) logoStyle.remove();
    });

    // SVG overlay for trendlines, fibonacci & text annotations
    function updateSvgOverlay() {
      if (!svgRef.current || !priceSeries) return;
      const svg = svgRef.current;
      const w = container.clientWidth;
      const h2 = container.clientHeight;
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h2));
      svg.innerHTML = '';

      // ─── Volume Profile (VPVR) ───
      if (showVolumeProfile && data.length > 1) {
        const SVGNS = 'http://www.w3.org/2000/svg';
        let lo = Infinity, hi = -Infinity;
        for (const d of data) { if (d.low < lo) lo = d.low; if (d.high > hi) hi = d.high; }
        if (isFinite(lo) && isFinite(hi) && hi > lo) {
          const BUCKETS = Math.min(48, Math.max(16, Math.round(h2 / 14)));
          const step = (hi - lo) / BUCKETS;
          const vol = new Array(BUCKETS).fill(0);
          for (const d of data) {
            // distribute each bar's volume across the buckets it spans (high→low)
            const bLo = Math.max(0, Math.floor((d.low - lo) / step));
            const bHi = Math.min(BUCKETS - 1, Math.floor((d.high - lo) / step));
            const span = bHi - bLo + 1;
            const per = d.volume / span;
            for (let b = bLo; b <= bHi; b++) vol[b] += per;
          }
          const maxVol = Math.max(...vol, 1);
          let pocIdx = 0;
          for (let b = 1; b < BUCKETS; b++) if (vol[b] > vol[pocIdx]) pocIdx = b;
          const maxBarW = Math.min(180, w * 0.28);
          const group = document.createElementNS(SVGNS, 'g');
          group.setAttribute('pointer-events', 'none');
          for (let b = 0; b < BUCKETS; b++) {
            if (vol[b] <= 0) continue;
            const yTop = priceSeries.priceToCoordinate(lo + (b + 1) * step);
            const yBot = priceSeries.priceToCoordinate(lo + b * step);
            if (yTop == null || yBot == null) continue;
            const barH = Math.max(1, yBot - yTop - 1);
            const barW = (vol[b] / maxVol) * maxBarW;
            const rect = document.createElementNS(SVGNS, 'rect');
            rect.setAttribute('x', String(w - barW));
            rect.setAttribute('y', String(yTop + 0.5));
            rect.setAttribute('width', String(barW));
            rect.setAttribute('height', String(barH));
            rect.setAttribute('fill', b === pocIdx ? 'rgba(255,152,0,0.45)' : 'rgba(120,140,200,0.28)');
            group.appendChild(rect);
          }
          svg.appendChild(group);
        }
      }

      // Render text annotations as SVG
      const textDrawings = drawings.filter((d) => d.type === 'text');
      for (const drawing of textDrawings) {
        if (!drawing.text || drawing.points.length < 1) continue;
        const pt = drawing.points[0];
        const tx = chart.timeScale().timeToCoordinate(pt.time as any);
        const ty = priceSeries.priceToCoordinate(pt.price);
        if (tx == null || ty == null) continue;

        // Measure text to create background rect
        const measureText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        measureText.setAttribute('x', String(tx));
        measureText.setAttribute('y', String(ty));
        measureText.setAttribute('fill', drawing.color || '#ffffff');
        measureText.setAttribute('font-size', '13');
        measureText.setAttribute('font-family', 'Inter, system-ui, sans-serif');
        measureText.setAttribute('dominant-baseline', 'middle');
        measureText.setAttribute('pointer-events', 'none');
        measureText.textContent = drawing.text;
        svg.appendChild(measureText);
        const bbox = measureText.getBBox();
        svg.removeChild(measureText);

        const padding = 4;

        // Background rect
        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('x', String(bbox.x - padding));
        bgRect.setAttribute('y', String(bbox.y - padding));
        bgRect.setAttribute('width', String(bbox.width + padding * 2));
        bgRect.setAttribute('height', String(bbox.height + padding * 2));
        bgRect.setAttribute('rx', '3');
        bgRect.setAttribute('fill', 'rgba(19, 23, 34, 0.75)');
        bgRect.setAttribute('stroke', 'rgba(255, 255, 255, 0.15)');
        bgRect.setAttribute('stroke-width', '1');
        bgRect.setAttribute('pointer-events', 'none');
        svg.appendChild(bgRect);

        // Text element
        const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('x', String(tx));
        textEl.setAttribute('y', String(ty));
        textEl.setAttribute('fill', drawing.color || '#ffffff');
        textEl.setAttribute('font-size', '13');
        textEl.setAttribute('font-family', 'Inter, system-ui, sans-serif');
        textEl.setAttribute('dominant-baseline', 'middle');
        textEl.setAttribute('pointer-events', 'none');
        textEl.textContent = drawing.text;
        svg.appendChild(textEl);

        // Hit area for drag & double-click
        const hitRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        hitRect.setAttribute('x', String(bbox.x - padding));
        hitRect.setAttribute('y', String(bbox.y - padding));
        hitRect.setAttribute('width', String(bbox.width + padding * 2));
        hitRect.setAttribute('height', String(bbox.height + padding * 2));
        hitRect.setAttribute('fill', 'transparent');
        hitRect.setAttribute('cursor', 'move');
        hitRect.style.pointerEvents = 'all';

        // Double-click to edit text
        hitRect.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          setEditingTextId(drawing.id);
          setEditingTextValue(drawing.text || '');
        });

        // Mousedown to start drag
        hitRect.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          dragRef.current = {
            id: drawing.id,
            startX: e.clientX,
            startY: e.clientY,
            origTime: pt.time,
            origPrice: pt.price,
          };
        });

        svg.appendChild(hitRect);
      }

      // Ruler measurements
      const rulerDrawings = drawings.filter((d) => d.type === 'ruler');
      for (const drawing of rulerDrawings) {
        if (drawing.points.length < 2) continue;
        const p1 = drawing.points[0];
        const p2 = drawing.points[1];
        const rx1 = chart.timeScale().timeToCoordinate(p1.time as any);
        const rx2 = chart.timeScale().timeToCoordinate(p2.time as any);
        const ry1 = priceSeries.priceToCoordinate(p1.price);
        const ry2 = priceSeries.priceToCoordinate(p2.price);
        if (rx1 == null || rx2 == null || ry1 == null || ry2 == null) continue;

        // Dashed line between points
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(rx1));
        line.setAttribute('y1', String(ry1));
        line.setAttribute('x2', String(rx2));
        line.setAttribute('y2', String(ry2));
        line.setAttribute('stroke', '#ffeb3b');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-dasharray', '6 3');
        svg.appendChild(line);

        // Start and end dots
        for (const [cx, cy] of [[rx1, ry1], [rx2, ry2]]) {
          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('cx', String(cx));
          dot.setAttribute('cy', String(cy));
          dot.setAttribute('r', '4');
          dot.setAttribute('fill', '#ffeb3b');
          svg.appendChild(dot);
        }

        // Calculate measurement
        const priceDiff = p2.price - p1.price;
        const pctChange = ((priceDiff / p1.price) * 100).toFixed(2);
        // Calculate days between dates
        const d1 = typeof p1.time === 'string' ? new Date(p1.time) : new Date(Number(p1.time) * 1000);
        const d2 = typeof p2.time === 'string' ? new Date(p2.time) : new Date(Number(p2.time) * 1000);
        const daysDiff = Math.round(Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));

        const sign = priceDiff >= 0 ? '+' : '';
        const labelLines = [
          `${sign}${formatPrice(priceDiff, currency, locale)} (${sign}${pctChange}%)`,
          `${daysDiff} ${daysDiff === 1 ? 'Tag' : 'Tage'}`,
        ];

        const midX = (rx1 + rx2) / 2;
        const midY = Math.min(ry1, ry2) - 12;
        const labelColor = priceDiff >= 0 ? '#26a69a' : '#ef5350';

        // Background rect for label
        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const textWidth = Math.max(labelLines[0].length, labelLines[1].length) * 7 + 16;
        bgRect.setAttribute('x', String(midX - textWidth / 2));
        bgRect.setAttribute('y', String(midY - 24));
        bgRect.setAttribute('width', String(textWidth));
        bgRect.setAttribute('height', '32');
        bgRect.setAttribute('rx', '4');
        bgRect.setAttribute('fill', 'rgba(19, 23, 34, 0.9)');
        bgRect.setAttribute('stroke', labelColor);
        bgRect.setAttribute('stroke-width', '1');
        svg.appendChild(bgRect);

        // Label text
        for (let li = 0; li < labelLines.length; li++) {
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', String(midX));
          text.setAttribute('y', String(midY - 12 + li * 14));
          text.setAttribute('fill', li === 0 ? labelColor : '#9598a1');
          text.setAttribute('font-size', '11');
          text.setAttribute('font-family', 'Inter, system-ui, sans-serif');
          text.setAttribute('font-weight', li === 0 ? '600' : '400');
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          text.textContent = labelLines[li];
          svg.appendChild(text);
        }

        // Hit area for deletion
        const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        hitLine.setAttribute('x1', String(rx1));
        hitLine.setAttribute('y1', String(ry1));
        hitLine.setAttribute('x2', String(rx2));
        hitLine.setAttribute('y2', String(ry2));
        hitLine.setAttribute('stroke', 'transparent');
        hitLine.setAttribute('stroke-width', '12');
        hitLine.setAttribute('cursor', 'pointer');
        hitLine.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          if (onRemoveDrawingRef.current) onRemoveDrawingRef.current(drawing.id);
        });
        svg.appendChild(hitLine);
      }

      const lineDrawings = drawings.filter((d) => d.type === 'trendline' || d.type === 'fibonacci');
      for (const drawing of lineDrawings) {
        if (drawing.points.length < 2) continue;
        const p1 = drawing.points[0];
        const p2 = drawing.points[1];

        const x1 = chart.timeScale().timeToCoordinate(p1.time as any);
        const x2 = chart.timeScale().timeToCoordinate(p2.time as any);
        const y1 = priceSeries.priceToCoordinate(p1.price);
        const y2 = priceSeries.priceToCoordinate(p2.price);

        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;

        if (drawing.type === 'trendline') {
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', String(x1));
          line.setAttribute('y1', String(y1));
          line.setAttribute('x2', String(x2));
          line.setAttribute('y2', String(y2));
          line.setAttribute('stroke', drawing.color);
          line.setAttribute('stroke-width', '2');
          line.setAttribute('stroke-linecap', 'round');
          svg.appendChild(line);

          // Clickable hit area for deletion
          const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          hitLine.setAttribute('x1', String(x1));
          hitLine.setAttribute('y1', String(y1));
          hitLine.setAttribute('x2', String(x2));
          hitLine.setAttribute('y2', String(y2));
          hitLine.setAttribute('stroke', 'transparent');
          hitLine.setAttribute('stroke-width', '10');
          hitLine.setAttribute('cursor', 'pointer');
          hitLine.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (onRemoveDrawingRef.current) onRemoveDrawingRef.current(drawing.id);
          });
          svg.appendChild(hitLine);
        }

        if (drawing.type === 'fibonacci') {
          const highPrice = Math.max(p1.price, p2.price);
          const lowPrice = Math.min(p1.price, p2.price);
          const range = highPrice - lowPrice;

          for (let i = 0; i < FIB_LEVELS.length; i++) {
            const level = FIB_LEVELS[i];
            const price = highPrice - range * level;
            const yy = priceSeries.priceToCoordinate(price);
            if (yy == null) continue;

            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', String(Math.min(x1, x2)));
            line.setAttribute('y1', String(yy));
            line.setAttribute('x2', String(Math.max(x1, x2)));
            line.setAttribute('y2', String(yy));
            line.setAttribute('stroke', FIB_COLORS[i]);
            line.setAttribute('stroke-width', '1');
            line.setAttribute('stroke-dasharray', level === 0 || level === 1 ? 'none' : '4 2');
            svg.appendChild(line);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', String(Math.max(x1, x2) + 4));
            text.setAttribute('y', String(yy + 3));
            text.setAttribute('fill', FIB_COLORS[i]);
            text.setAttribute('font-size', '10');
            text.setAttribute('font-family', 'monospace');
            text.textContent = `${(level * 100).toFixed(1)}% (${formatPrice(price, currency, locale)})`;
            svg.appendChild(text);
          }

          // Dblclick to remove
          const hitRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          hitRect.setAttribute('x', String(Math.min(x1, x2)));
          hitRect.setAttribute('y', String(Math.min(y1, y2)));
          hitRect.setAttribute('width', String(Math.abs(x2 - x1)));
          hitRect.setAttribute('height', String(Math.abs(y2 - y1)));
          hitRect.setAttribute('fill', 'transparent');
          hitRect.setAttribute('cursor', 'pointer');
          hitRect.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (onRemoveDrawingRef.current) onRemoveDrawingRef.current(drawing.id);
          });
          svg.appendChild(hitRect);
        }
      }
    }

    updateSvgOverlay();
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateSvgOverlay);

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth });
      updateSvgOverlay();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      mainChartApi.current = null;
      priceSeriesRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, displayData, chartType, indicators, closes, times, dataMap, height, createChartOptions, chartColors, drawings, alertLevels, logScale, showVolumeProfile]);

  // Drag handler for text annotations
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!dragRef.current || !mainChartApi.current || !priceSeriesRef.current || !mainChartRef.current) return;
      const container = mainChartRef.current;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Convert pixel coordinates back to time/price
      const chart = mainChartApi.current;
      const ps = priceSeriesRef.current;
      try {
        const newPrice = ps.coordinateToPrice(y);
        // For time, we use the logical coordinate approach
        const logicalX = chart.timeScale().coordinateToLogical(x);
        if (logicalX == null || newPrice == null || isNaN(newPrice)) return;
        const timeCoord = chart.timeScale().logicalToCoordinate(logicalX);
        if (timeCoord == null) return;
        // We need the actual time value -- use coordinateToTime if available
        // lightweight-charts v4 doesn't have coordinateToTime, so we approximate
        // by finding the nearest data point
        const visibleRange = chart.timeScale().getVisibleRange();
        if (!visibleRange) return;
        // Find nearest time from the data
        let nearestTime = dragRef.current.origTime;
        let minDist = Infinity;
        for (const d of data) {
          const coord = chart.timeScale().timeToCoordinate(d.date as any);
          if (coord != null) {
            const dist = Math.abs(coord - x);
            if (dist < minDist) {
              minDist = dist;
              nearestTime = d.date as string;
            }
          }
        }
        // Update the drawing position visually by storing it
        dragRef.current = { ...dragRef.current, origTime: nearestTime, origPrice: newPrice };
      } catch {}
    }

    function handleMouseUp() {
      if (!dragRef.current) return;
      const drag = dragRef.current;
      dragRef.current = null;
      if (onUpdateDrawingRef.current) {
        onUpdateDrawingRef.current(drag.id, {
          points: [{ time: drag.origTime, price: drag.origPrice }],
        });
      }
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [data]);

  // Focus text input when pending text point appears
  useEffect(() => {
    if (pendingTextPoint && textInputRef.current) {
      setTextInputValue('');
      setTimeout(() => textInputRef.current?.focus(), 50);
    }
  }, [pendingTextPoint]);

  // Focus edit input when editing
  useEffect(() => {
    if (editingTextId && editInputRef.current) {
      setTimeout(() => editInputRef.current?.focus(), 50);
    }
  }, [editingTextId]);

  // Compute pixel position for the pending text input
  const pendingTextPixel = useMemo(() => {
    if (!pendingTextPoint || !mainChartApi.current || !priceSeriesRef.current) return null;
    try {
      const x = mainChartApi.current.timeScale().timeToCoordinate(pendingTextPoint.time as any);
      const y = priceSeriesRef.current.priceToCoordinate(pendingTextPoint.price);
      if (x != null && y != null) return { x, y };
    } catch {}
    return null;
  }, [pendingTextPoint]);

  // Compute pixel position for the editing text input
  const editingTextPixel = useMemo(() => {
    if (!editingTextId || !mainChartApi.current || !priceSeriesRef.current) return null;
    const drawing = drawings.find((d) => d.id === editingTextId);
    if (!drawing || drawing.points.length < 1) return null;
    try {
      const x = mainChartApi.current.timeScale().timeToCoordinate(drawing.points[0].time as any);
      const y = priceSeriesRef.current.priceToCoordinate(drawing.points[0].price);
      if (x != null && y != null) return { x, y };
    } catch {}
    return null;
  }, [editingTextId, drawings]);

  // RSI chart
  useEffect(() => {
    if (!rsiChartRef.current || !showRSI || closes.length < 15) return;

    const container = rsiChartRef.current;
    const chart = createChart(container, {
      ...createChartOptions(120),
      width: container.clientWidth,
      rightPriceScale: {
        borderColor: chartColors.border,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
    });
    rsiChartApi.current = chart;

    const rsi = calculateRSI(closes, 14);
    const series = chart.addLineSeries({
      color: '#e91e63',
      lineWidth: 2,
      priceLineVisible: false,
    });
    series.setData(rsi.map((value, i) => ({ time: times[i + 14] as any, value })));

    const overbought = chart.addLineSeries({
      color: 'rgba(239,83,80,0.4)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const oversold = chart.addLineSeries({
      color: 'rgba(38,166,154,0.4)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const rsiTimes = rsi.map((_, i) => times[i + 14]);
    overbought.setData(rsiTimes.map((time) => ({ time: time as any, value: 70 })));
    oversold.setData(rsiTimes.map((time) => ({ time: time as any, value: 30 })));

    chart.timeScale().fitContent();
    syncTimeScale(chart);

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      rsiChartApi.current = null;
    };
  }, [showRSI, closes, times, createChartOptions, chartColors]);

  // MACD chart
  useEffect(() => {
    if (!macdChartRef.current || !showMACD || closes.length < 35) return;

    const container = macdChartRef.current;
    const chart = createChart(container, {
      ...createChartOptions(140),
      width: container.clientWidth,
      rightPriceScale: {
        borderColor: chartColors.border,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
    });
    macdChartApi.current = chart;

    const { macd, signal, histogram, startIndex } = calculateMACD(closes);

    const macdSeries = chart.addLineSeries({
      color: '#2962ff',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    macdSeries.setData(
      macd.map((value, i) => ({ time: times[startIndex + i] as any, value }))
    );

    const signalSeries = chart.addLineSeries({
      color: '#ff9800',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    signalSeries.setData(
      signal.map((value, i) => ({ time: times[startIndex + i] as any, value }))
    );

    const histSeries = chart.addHistogramSeries({
      priceLineVisible: false,
      lastValueVisible: false,
    });
    histSeries.setData(
      histogram.map((value, i) => ({
        time: times[startIndex + i] as any,
        value,
        color: value >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)',
      }))
    );

    chart.timeScale().fitContent();
    syncTimeScale(chart);

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      macdChartApi.current = null;
    };
  }, [showMACD, closes, times, createChartOptions, chartColors]);

  // Stochastic chart
  useEffect(() => {
    if (!stochChartRef.current || !showStochastic || data.length < 17) return;

    const container = stochChartRef.current;
    const chart = createChart(container, {
      ...createChartOptions(120),
      width: container.clientWidth,
      rightPriceScale: {
        borderColor: chartColors.border,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
    });
    stochChartApi.current = chart;

    const { k, d, startIndex } = calculateStochastic(data);

    const kSeries = chart.addLineSeries({
      color: '#2962ff',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    kSeries.setData(k.map((v, i) => ({ time: times[startIndex + i] as any, value: v })));

    const dSeries = chart.addLineSeries({
      color: '#ff9800',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    dSeries.setData(d.map((v, i) => ({ time: times[startIndex + i] as any, value: v })));

    // Overbought/oversold lines
    const stochTimes = k.map((_, i) => times[startIndex + i]);
    const ob = chart.addLineSeries({
      color: 'rgba(239,83,80,0.4)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ob.setData(stochTimes.map((time) => ({ time: time as any, value: 80 })));
    const os = chart.addLineSeries({
      color: 'rgba(38,166,154,0.4)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    os.setData(stochTimes.map((time) => ({ time: time as any, value: 20 })));

    chart.timeScale().fitContent();
    syncTimeScale(chart);

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      stochChartApi.current = null;
    };
  }, [showStochastic, data, times, createChartOptions, chartColors]);

  // ATR chart
  useEffect(() => {
    if (!atrChartRef.current || !showATR || data.length < 16) return;

    const container = atrChartRef.current;
    const chart = createChart(container, {
      ...createChartOptions(120),
      width: container.clientWidth,
      rightPriceScale: {
        borderColor: chartColors.border,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
    });
    atrChartApi.current = chart;

    const { values, startIndex } = calculateATR(data);

    const series = chart.addLineSeries({
      color: '#ff5722',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    series.setData(values.map((v, i) => ({ time: times[startIndex + i] as any, value: v })));

    chart.timeScale().fitContent();
    syncTimeScale(chart);

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      atrChartApi.current = null;
    };
  }, [showATR, data, times, createChartOptions, chartColors]);

  // Williams %R chart
  useEffect(() => {
    if (!williamsChartRef.current || !showWilliamsR || data.length < 15) return;

    const container = williamsChartRef.current;
    const chart = createChart(container, {
      ...createChartOptions(120),
      width: container.clientWidth,
      rightPriceScale: {
        borderColor: chartColors.border,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
    });
    williamsChartApi.current = chart;

    const { values, startIndex } = calculateWilliamsR(data);

    const series = chart.addLineSeries({
      color: '#8e24aa',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    series.setData(values.map((v, i) => ({ time: times[startIndex + i] as any, value: v })));

    // -20/-80 reference lines
    const willTimes = values.map((_, i) => times[startIndex + i]);
    const ob = chart.addLineSeries({
      color: 'rgba(239,83,80,0.4)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ob.setData(willTimes.map((time) => ({ time: time as any, value: -20 })));
    const os = chart.addLineSeries({
      color: 'rgba(38,166,154,0.4)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    os.setData(willTimes.map((time) => ({ time: time as any, value: -80 })));

    chart.timeScale().fitContent();
    syncTimeScale(chart);

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      williamsChartApi.current = null;
    };
  }, [showWilliamsR, data, times, createChartOptions, chartColors]);

  // Sync time scales helper
  function syncTimeScale(subChart: IChartApi) {
    if (!mainChartApi.current) return;
    const mainTs = mainChartApi.current.timeScale();
    const subTs = subChart.timeScale();
    mainTs.subscribeVisibleLogicalRangeChange((range) => {
      if (range) subTs.setVisibleLogicalRange(range);
    });
    subTs.subscribeVisibleLogicalRangeChange((range) => {
      if (range) mainTs.setVisibleLogicalRange(range);
    });
  }

  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center bg-dark-800 rounded-lg text-txt-secondary"
        style={{ height }}
      >
        Keine Chartdaten verfügbar
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <div className="relative" style={{ cursor: drawingActive ? 'crosshair' : undefined }}>
        {/* OHLCV Legend Overlay */}
        <div
          ref={legendRef}
          className="absolute top-2 left-2 z-10 gap-2 items-center text-xs font-mono pointer-events-none"
          style={{ display: 'none' }}
        />
        {/* Drawing SVG Overlay */}
        <svg
          ref={svgRef}
          className="absolute top-0 left-0 z-[5]"
          style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
        />
        {/* Inline text input for new text annotation */}
        {pendingTextPoint && pendingTextPixel && (
          <div
            className="absolute z-[15]"
            style={{ left: pendingTextPixel.x, top: pendingTextPixel.y - 14 }}
          >
            <input
              ref={textInputRef}
              type="text"
              value={textInputValue}
              onChange={(e) => setTextInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && textInputValue.trim()) {
                  onConfirmText?.(textInputValue.trim());
                  setTextInputValue('');
                } else if (e.key === 'Escape') {
                  onCancelText?.();
                  setTextInputValue('');
                }
              }}
              onBlur={() => {
                if (textInputValue.trim()) {
                  onConfirmText?.(textInputValue.trim());
                } else {
                  onCancelText?.();
                }
                setTextInputValue('');
              }}
              placeholder="Text eingeben..."
              className="bg-dark-900/90 text-white text-xs px-2 py-1 rounded border border-accent/50 outline-none focus:border-accent min-w-[120px]"
              style={{ fontSize: 13, fontFamily: 'Inter, system-ui, sans-serif' }}
            />
          </div>
        )}
        {/* Inline text input for editing existing text annotation */}
        {editingTextId && editingTextPixel && (
          <div
            className="absolute z-[15]"
            style={{ left: editingTextPixel.x, top: editingTextPixel.y - 14 }}
          >
            <input
              ref={editInputRef}
              type="text"
              value={editingTextValue}
              onChange={(e) => setEditingTextValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && editingTextValue.trim()) {
                  onUpdateDrawing?.(editingTextId, { text: editingTextValue.trim() });
                  setEditingTextId(null);
                  setEditingTextValue('');
                } else if (e.key === 'Escape') {
                  setEditingTextId(null);
                  setEditingTextValue('');
                }
              }}
              onBlur={() => {
                if (editingTextValue.trim()) {
                  onUpdateDrawing?.(editingTextId, { text: editingTextValue.trim() });
                }
                setEditingTextId(null);
                setEditingTextValue('');
              }}
              className="bg-dark-900/90 text-white text-xs px-2 py-1 rounded border border-accent/50 outline-none focus:border-accent min-w-[120px]"
              style={{ fontSize: 13, fontFamily: 'Inter, system-ui, sans-serif' }}
            />
          </div>
        )}
        <div ref={mainChartRef} className="rounded-t-lg overflow-hidden" />
      </div>
      {showRSI && (
        <div className="relative">
          <span className="absolute top-1 left-2 text-[10px] text-txt-muted z-10">
            RSI (14)
          </span>
          <div ref={rsiChartRef} className="overflow-hidden" />
        </div>
      )}
      {showMACD && (
        <div className="relative">
          <span className="absolute top-1 left-2 text-[10px] text-txt-muted z-10">
            MACD (12, 26, 9)
          </span>
          <div ref={macdChartRef} className="overflow-hidden" />
        </div>
      )}
      {showStochastic && (
        <div className="relative">
          <span className="absolute top-1 left-2 text-[10px] text-txt-muted z-10">
            Stoch (14, 3)
          </span>
          <div ref={stochChartRef} className="overflow-hidden" />
        </div>
      )}
      {showATR && (
        <div className="relative">
          <span className="absolute top-1 left-2 text-[10px] text-txt-muted z-10">
            ATR (14)
          </span>
          <div ref={atrChartRef} className="overflow-hidden" />
        </div>
      )}
      {showWilliamsR && (
        <div className="relative">
          <span className="absolute top-1 left-2 text-[10px] text-txt-muted z-10">
            Williams %R (14)
          </span>
          <div ref={williamsChartRef} className="rounded-b-lg overflow-hidden" />
        </div>
      )}
    </div>
  );
});

export default StockChart;
