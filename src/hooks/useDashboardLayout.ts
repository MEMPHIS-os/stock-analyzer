import { useState, useCallback, useEffect } from 'react';

export interface DashboardWidget {
  id: string;
  type:
    | 'portfolio'
    | 'marketOverview'
    | 'topGainers'
    | 'topLosers'
    | 'watchlistTable'
    | 'news'
    | 'earnings'
    | 'sectorPerformance'
    | 'miniHeatmap';
  visible: boolean;
  order: number;
}

const STORAGE_KEY = 'stockanalyzer_dashboard_layout';

const WIDGET_LABELS: Record<DashboardWidget['type'], string> = {
  portfolio: 'Portfolio',
  marketOverview: 'Marktübersicht',
  topGainers: 'Top Gewinner',
  topLosers: 'Top Verlierer',
  watchlistTable: 'Watchlist',
  news: 'Markt-News',
  earnings: 'Anstehende Earnings',
  sectorPerformance: 'Sektor-Performance',
  miniHeatmap: 'Sektor-Heatmap',
};

function defaultLayout(): DashboardWidget[] {
  // Order matters for the dashboard grid: half-width pairs (gainers/losers,
  // watchlist/sectors, news/earnings) sit next to each other by default.
  const types: DashboardWidget['type'][] = [
    'portfolio',
    'marketOverview',
    'topGainers',
    'topLosers',
    'watchlistTable',
    'sectorPerformance',
    'news',
    'earnings',
    'miniHeatmap',
  ];
  return types.map((type, i) => ({
    id: type,
    type,
    visible: true,
    order: i,
  }));
}

function loadLayout(): DashboardWidget[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: DashboardWidget[] = JSON.parse(stored);
      // Ensure all widget types exist (in case new ones were added)
      const defaults = defaultLayout();
      const existingTypes = new Set(parsed.map((w) => w.type));
      const maxOrder = Math.max(...parsed.map((w) => w.order), -1);
      let nextOrder = maxOrder + 1;
      for (const def of defaults) {
        if (!existingTypes.has(def.type)) {
          parsed.push({ ...def, order: nextOrder++ });
        }
      }
      // Remove any types that no longer exist
      const validTypes = new Set(defaults.map((d) => d.type));
      return parsed
        .filter((w) => validTypes.has(w.type))
        .sort((a, b) => a.order - b.order);
    }
  } catch {}
  return defaultLayout();
}

function saveLayout(widgets: DashboardWidget[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
}

export function getWidgetLabel(type: DashboardWidget['type']): string {
  return WIDGET_LABELS[type] || type;
}

export function useDashboardLayout() {
  const [widgets, setWidgets] = useState<DashboardWidget[]>(loadLayout);

  useEffect(() => {
    saveLayout(widgets);
  }, [widgets]);

  const toggleWidget = useCallback((id: string) => {
    setWidgets((prev) =>
      prev.map((w) => (w.id === id ? { ...w, visible: !w.visible } : w))
    );
  }, []);

  const reorderWidgets = useCallback((fromIndex: number, toIndex: number) => {
    setWidgets((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      // Recalculate order values
      return updated.map((w, i) => ({ ...w, order: i }));
    });
  }, []);

  const resetLayout = useCallback(() => {
    setWidgets(defaultLayout());
  }, []);

  return {
    widgets,
    toggleWidget,
    reorderWidgets,
    resetLayout,
  };
}
