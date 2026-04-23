import { useState } from 'react';
import { LayoutGrid, Columns, Square } from 'lucide-react';
import ChartCell from '../components/ChartCell';

type Layout = '1x1' | '2x1' | '2x2';

const LAYOUT_OPTIONS: { value: Layout; label: string; icon: typeof Square }[] = [
  { value: '1x1', label: 'Einzel', icon: Square },
  { value: '2x1', label: '2 Spalten', icon: Columns },
  { value: '2x2', label: '2x2 Raster', icon: LayoutGrid },
];

function getCellCount(layout: Layout): number {
  return layout === '1x1' ? 1 : layout === '2x1' ? 2 : 4;
}

export default function MultiChart() {
  const [layout, setLayout] = useState<Layout>('2x1');
  const [symbols, setSymbols] = useState<string[]>(['AAPL', 'MSFT', 'GOOGL', 'AMZN']);

  const cellCount = getCellCount(layout);

  const gridClass =
    layout === '1x1'
      ? 'grid-cols-1'
      : layout === '2x1'
      ? 'grid-cols-1 md:grid-cols-2'
      : 'grid-cols-1 md:grid-cols-2';

  const chartHeight = layout === '2x2' ? 320 : layout === '2x1' ? 450 : 600;

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Layout toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex gap-0.5 bg-dark-700 rounded-lg p-0.5">
          {LAYOUT_OPTIONS.map((lo) => (
            <button
              key={lo.value}
              onClick={() => setLayout(lo.value)}
              className={`p-1.5 rounded-md transition-colors ${
                layout === lo.value
                  ? 'bg-accent text-white'
                  : 'text-txt-secondary hover:text-txt-primary'
              }`}
              title={lo.label}
            >
              <lo.icon className="w-4 h-4" />
            </button>
          ))}
        </div>
        <span className="text-sm font-semibold text-txt-primary">Multi-Chart Ansicht</span>
        <span className="text-xs text-txt-muted">
          Klicke auf den Symbol-Namen um zu wechseln
        </span>
      </div>

      {/* Chart grid */}
      <div className={`grid ${gridClass} gap-2`}>
        {Array.from({ length: cellCount }).map((_, i) => (
          <ChartCell
            key={`${layout}-${i}`}
            defaultSymbol={symbols[i] || 'AAPL'}
            onSymbolChange={(sym) => {
              setSymbols((prev) => {
                const next = [...prev];
                next[i] = sym;
                return next;
              });
            }}
            height={chartHeight}
          />
        ))}
      </div>
    </div>
  );
}
