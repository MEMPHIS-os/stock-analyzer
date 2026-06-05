import { Minus, TrendingUp, Layers, Trash2, MousePointer, Type, Ruler, MoveUpRight, Square } from 'lucide-react';
import type { DrawingTool } from '../hooks/useDrawings';

interface DrawingToolbarProps {
  activeTool: DrawingTool;
  onSelectTool: (tool: DrawingTool) => void;
  onClearAll: () => void;
  drawingCount: number;
  pendingPointsCount: number;
}

const TOOLS: { value: DrawingTool; label: string; icon: typeof Minus; hint: string }[] = [
  { value: 'none', label: 'Auswahl', icon: MousePointer, hint: 'Kein Werkzeug' },
  { value: 'hline', label: 'H-Linie', icon: Minus, hint: '1 Klick: Horizontale Linie' },
  { value: 'trendline', label: 'Trend', icon: TrendingUp, hint: '2 Klicks: Trendlinie' },
  { value: 'ray', label: 'Strahl', icon: MoveUpRight, hint: '2 Klicks: verlängerte Linie (Ray)' },
  { value: 'rectangle', label: 'Zone', icon: Square, hint: '2 Klicks: Rechteck/Zone' },
  { value: 'fibonacci', label: 'Fib', icon: Layers, hint: '2 Klicks: Fibonacci-Retracement' },
  { value: 'text', label: 'Text', icon: Type, hint: '1 Klick: Textanmerkung' },
  { value: 'ruler', label: 'Messen', icon: Ruler, hint: '2 Klicks: Preisdifferenz messen' },
];

export default function DrawingToolbar({
  activeTool,
  onSelectTool,
  onClearAll,
  drawingCount,
  pendingPointsCount,
}: DrawingToolbarProps) {
  return (
    <div className="flex flex-col gap-1 bg-dark-700 rounded-lg p-1 border border-border/20">
      {TOOLS.map((tool) => (
        <button
          key={tool.value}
          onClick={() => onSelectTool(tool.value)}
          className={`p-2 rounded-md transition-colors relative group ${
            activeTool === tool.value
              ? 'bg-accent text-white'
              : 'text-txt-secondary hover:text-txt-primary hover:bg-dark-600'
          }`}
          title={tool.hint}
        >
          <tool.icon className="w-4 h-4" />
          {/* Tooltip */}
          <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded bg-dark-900 text-[10px] text-txt-primary whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 border border-border/30">
            {tool.label}
          </span>
        </button>
      ))}

      {drawingCount > 0 && (
        <>
          <div className="h-px bg-border/20 my-0.5" />
          <button
            onClick={onClearAll}
            className="p-2 rounded-md text-danger hover:bg-danger/10 transition-colors group relative"
            title="Alle Zeichnungen löschen"
          >
            <Trash2 className="w-4 h-4" />
            <span className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded bg-dark-900 text-[10px] text-txt-primary whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 border border-border/30">
              Alle löschen ({drawingCount})
            </span>
          </button>
        </>
      )}

      {pendingPointsCount > 0 && (
        <div className="text-[9px] text-accent text-center mt-1">
          {pendingPointsCount}/2 Punkte
        </div>
      )}
    </div>
  );
}
