import { useState, useCallback } from 'react';

export type DrawingTool = 'none' | 'hline' | 'trendline' | 'fibonacci' | 'text' | 'ruler';

export interface Drawing {
  id: string;
  type: 'hline' | 'trendline' | 'fibonacci' | 'text' | 'ruler';
  points: { time: string; price: number }[];
  color: string;
  text?: string;
}

const DRAWING_COLORS = ['#2962ff', '#ff9800', '#e91e63', '#26a69a', '#7e57c2', '#ff5722'];
let colorIndex = 0;

function nextColor() {
  const color = DRAWING_COLORS[colorIndex % DRAWING_COLORS.length];
  colorIndex++;
  return color;
}

export function useDrawings(symbol: string) {
  const storageKey = `stockanalyzer_drawings_${symbol}`;

  const loadDrawings = (): Drawing[] => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) return JSON.parse(stored);
    } catch {}
    return [];
  };

  const [drawings, setDrawings] = useState<Drawing[]>(loadDrawings);
  const [activeTool, setActiveTool] = useState<DrawingTool>('none');
  const [pendingPoints, setPendingPoints] = useState<{ time: string; price: number }[]>([]);
  // For text tool: store the click position so the overlay can show an inline input
  const [pendingTextPoint, setPendingTextPoint] = useState<{ time: string; price: number } | null>(null);

  const save = useCallback(
    (updated: Drawing[]) => {
      localStorage.setItem(storageKey, JSON.stringify(updated));
    },
    [storageKey]
  );

  const addDrawing = useCallback(
    (drawing: Omit<Drawing, 'id'>) => {
      const newDrawing: Drawing = {
        ...drawing,
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      };
      setDrawings((prev) => {
        const updated = [...prev, newDrawing];
        save(updated);
        return updated;
      });
      return newDrawing;
    },
    [save]
  );

  const updateDrawing = useCallback(
    (id: string, changes: Partial<Omit<Drawing, 'id'>>) => {
      setDrawings((prev) => {
        const updated = prev.map((d) => (d.id === id ? { ...d, ...changes } : d));
        save(updated);
        return updated;
      });
    },
    [save]
  );

  const removeDrawing = useCallback(
    (id: string) => {
      setDrawings((prev) => {
        const updated = prev.filter((d) => d.id !== id);
        save(updated);
        return updated;
      });
    },
    [save]
  );

  const clearAll = useCallback(() => {
    setDrawings([]);
    save([]);
  }, [save]);

  const handleChartClick = useCallback(
    (time: string, price: number) => {
      if (activeTool === 'none') return;

      if (activeTool === 'hline') {
        addDrawing({
          type: 'hline',
          points: [{ time, price }],
          color: nextColor(),
        });
        setActiveTool('none');
        return;
      }

      if (activeTool === 'trendline') {
        const newPoints = [...pendingPoints, { time, price }];
        if (newPoints.length >= 2) {
          addDrawing({
            type: 'trendline',
            points: newPoints,
            color: nextColor(),
          });
          setPendingPoints([]);
          setActiveTool('none');
        } else {
          setPendingPoints(newPoints);
        }
        return;
      }

      if (activeTool === 'fibonacci') {
        const newPoints = [...pendingPoints, { time, price }];
        if (newPoints.length >= 2) {
          addDrawing({
            type: 'fibonacci',
            points: newPoints,
            color: nextColor(),
          });
          setPendingPoints([]);
          setActiveTool('none');
        } else {
          setPendingPoints(newPoints);
        }
        return;
      }

      if (activeTool === 'ruler') {
        const newPoints = [...pendingPoints, { time, price }];
        if (newPoints.length >= 2) {
          addDrawing({
            type: 'ruler',
            points: newPoints,
            color: '#ffeb3b',
          });
          setPendingPoints([]);
          setActiveTool('none');
        } else {
          setPendingPoints(newPoints);
        }
        return;
      }

      if (activeTool === 'text') {
        // Store the pending text click position; the overlay will show an inline input
        setPendingTextPoint({ time, price });
        return;
      }
    },
    [activeTool, pendingPoints, addDrawing]
  );

  const confirmTextDrawing = useCallback(
    (content: string) => {
      if (!pendingTextPoint || !content.trim()) {
        setPendingTextPoint(null);
        return;
      }
      addDrawing({
        type: 'text',
        points: [{ time: pendingTextPoint.time, price: pendingTextPoint.price }],
        color: '#ffffff',
        text: content.trim(),
      });
      setPendingTextPoint(null);
      setActiveTool('none');
    },
    [pendingTextPoint, addDrawing]
  );

  const cancelTextDrawing = useCallback(() => {
    setPendingTextPoint(null);
  }, []);

  const cancelDrawing = useCallback(() => {
    setActiveTool('none');
    setPendingPoints([]);
    setPendingTextPoint(null);
  }, []);

  return {
    drawings,
    activeTool,
    setActiveTool,
    pendingPoints,
    pendingTextPoint,
    handleChartClick,
    confirmTextDrawing,
    cancelTextDrawing,
    cancelDrawing,
    removeDrawing,
    updateDrawing,
    clearAll,
  };
}
