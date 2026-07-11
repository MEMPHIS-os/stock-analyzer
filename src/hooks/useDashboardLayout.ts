import { useState, useCallback, useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WidgetType =
  | 'portfolio'
  | 'marketOverview'
  | 'topGainers'
  | 'topLosers'
  | 'watchlistTable'
  | 'news'
  | 'earnings'
  | 'sectorPerformance'
  | 'miniHeatmap'
  | 'quickActions'
  | 'marketStatus';

export type WidgetSize = 'S' | 'M' | 'L' | 'XL';

export interface DashboardWidget {
  id: string; // id === type, one instance per type
  type: WidgetType;
  visible: boolean;
  order: number;
  size: WidgetSize;
}

export interface WidgetMeta {
  type: WidgetType;
  labelKey: string;
  descKey: string;
  allowedSizes: WidgetSize[];
  defaultSize: WidgetSize;
}

export interface DashboardPreset {
  id: 'classic' | 'trader' | 'investor' | 'macro' | 'minimal';
  nameKey: string;
  descKey: string;
  widgets: Array<{ type: WidgetType; size: WidgetSize }>;
}

// ---------------------------------------------------------------------------
// Widget metadata
// ---------------------------------------------------------------------------

const ALL_WIDGET_TYPES: WidgetType[] = [
  'portfolio',
  'marketOverview',
  'topGainers',
  'topLosers',
  'watchlistTable',
  'news',
  'earnings',
  'sectorPerformance',
  'miniHeatmap',
  'quickActions',
  'marketStatus',
];

function meta(type: WidgetType, allowedSizes: WidgetSize[], defaultSize: WidgetSize): WidgetMeta {
  return {
    type,
    labelKey: `dashboard.widget.${type}`,
    descKey: `dashboard.widgetDesc.${type}`,
    allowedSizes,
    defaultSize,
  };
}

export const WIDGET_META: Record<WidgetType, WidgetMeta> = {
  portfolio: meta('portfolio', ['M', 'L', 'XL'], 'XL'),
  marketOverview: meta('marketOverview', ['M', 'L', 'XL'], 'XL'),
  topGainers: meta('topGainers', ['S', 'M', 'L'], 'M'),
  topLosers: meta('topLosers', ['S', 'M', 'L'], 'M'),
  watchlistTable: meta('watchlistTable', ['M', 'L', 'XL'], 'L'),
  news: meta('news', ['S', 'M', 'L', 'XL'], 'M'),
  earnings: meta('earnings', ['S', 'M', 'L'], 'M'),
  sectorPerformance: meta('sectorPerformance', ['S', 'M', 'L'], 'S'),
  miniHeatmap: meta('miniHeatmap', ['L', 'XL'], 'XL'),
  quickActions: meta('quickActions', ['S', 'M'], 'S'),
  marketStatus: meta('marketStatus', ['S', 'M', 'L'], 'S'),
};

// Static class literals so Tailwind's JIT picks them up.
export const SIZE_SPANS: Record<WidgetSize, string> = {
  S: 'lg:col-span-4',
  M: 'lg:col-span-6',
  L: 'lg:col-span-8',
  XL: 'lg:col-span-12',
};

export const SIZE_COLS: Record<WidgetSize, number> = {
  S: 4,
  M: 6,
  L: 8,
  XL: 12,
};

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

function preset(
  id: DashboardPreset['id'],
  widgets: Array<{ type: WidgetType; size: WidgetSize }>,
): DashboardPreset {
  return {
    id,
    nameKey: `dashboard.preset.${id}`,
    descKey: `dashboard.presetDesc.${id}`,
    widgets,
  };
}

export const DASHBOARD_PRESETS: DashboardPreset[] = [
  preset('classic', [
    { type: 'portfolio', size: 'XL' },
    { type: 'marketOverview', size: 'XL' },
    { type: 'topGainers', size: 'M' },
    { type: 'topLosers', size: 'M' },
    { type: 'watchlistTable', size: 'L' },
    { type: 'sectorPerformance', size: 'S' },
    { type: 'news', size: 'M' },
    { type: 'earnings', size: 'M' },
    { type: 'miniHeatmap', size: 'XL' },
  ]),
  preset('trader', [
    { type: 'marketOverview', size: 'XL' },
    { type: 'topGainers', size: 'M' },
    { type: 'topLosers', size: 'M' },
    { type: 'watchlistTable', size: 'XL' },
    { type: 'miniHeatmap', size: 'L' },
    { type: 'marketStatus', size: 'S' },
    { type: 'news', size: 'M' },
  ]),
  preset('investor', [
    { type: 'portfolio', size: 'XL' },
    { type: 'watchlistTable', size: 'L' },
    { type: 'sectorPerformance', size: 'S' },
    { type: 'earnings', size: 'M' },
    { type: 'news', size: 'M' },
    { type: 'marketOverview', size: 'XL' },
  ]),
  preset('macro', [
    { type: 'marketOverview', size: 'XL' },
    { type: 'miniHeatmap', size: 'XL' },
    { type: 'sectorPerformance', size: 'M' },
    { type: 'marketStatus', size: 'M' },
    { type: 'news', size: 'L' },
    { type: 'quickActions', size: 'S' },
  ]),
  preset('minimal', [
    { type: 'marketOverview', size: 'XL' },
    { type: 'watchlistTable', size: 'XL' },
    { type: 'quickActions', size: 'S' },
  ]),
];

export function presetLayout(presetId: DashboardPreset['id']): DashboardWidget[] {
  const p = DASHBOARD_PRESETS.find((x) => x.id === presetId) ?? DASHBOARD_PRESETS[0];
  const widgets: DashboardWidget[] = p.widgets.map((w, i) => ({
    id: w.type,
    type: w.type,
    visible: true,
    order: i,
    size: w.size,
  }));
  const included = new Set<WidgetType>(p.widgets.map((w) => w.type));
  for (const type of ALL_WIDGET_TYPES) {
    if (!included.has(type)) {
      widgets.push({
        id: type,
        type,
        visible: false,
        order: widgets.length,
        size: WIDGET_META[type].defaultSize,
      });
    }
  }
  return widgets;
}

// ---------------------------------------------------------------------------
// Storage: validation, migration, persistence
// ---------------------------------------------------------------------------

export const STORAGE_KEY_V2 = 'stockanalyzer_dashboard_layout_v2';
export const STORAGE_KEY_V1 = 'stockanalyzer_dashboard_layout';
export const SETUP_SEEN_KEY = 'stockanalyzer_dashboard_setup_seen';

// Grid spans that Dashboard.tsx used per type before sizes existed (v1).
const V1_SIZES: Record<string, WidgetSize> = {
  portfolio: 'XL',
  marketOverview: 'XL',
  topGainers: 'M',
  topLosers: 'M',
  watchlistTable: 'L',
  sectorPerformance: 'S',
  news: 'M',
  earnings: 'M',
  miniHeatmap: 'XL',
};

function isWidgetType(value: unknown): value is WidgetType {
  return typeof value === 'string' && (ALL_WIDGET_TYPES as string[]).includes(value);
}

function isWidgetSize(value: unknown): value is WidgetSize {
  return value === 'S' || value === 'M' || value === 'L' || value === 'XL';
}

export function isValidStoredWidget(item: unknown): item is DashboardWidget {
  if (!item || typeof item !== 'object') return false;
  const w = item as Partial<DashboardWidget>;
  return (
    isWidgetType(w.type) &&
    typeof w.visible === 'boolean' &&
    typeof w.order === 'number' &&
    isWidgetSize(w.size)
  );
}

interface V1Widget {
  type: WidgetType;
  visible: boolean;
  order: number;
}

function isValidV1Widget(item: unknown): item is V1Widget {
  if (!item || typeof item !== 'object') return false;
  const w = item as Partial<V1Widget>;
  return (
    typeof w.type === 'string' &&
    w.type in V1_SIZES &&
    typeof w.visible === 'boolean' &&
    typeof w.order === 'number'
  );
}

/** Sort by order, append any missing types (hidden, default size), renumber. */
function normalizeLayout(widgets: DashboardWidget[]): DashboardWidget[] {
  const sorted = [...widgets].sort((a, b) => a.order - b.order);
  const present = new Set(sorted.map((w) => w.type));
  for (const type of ALL_WIDGET_TYPES) {
    if (!present.has(type)) {
      sorted.push({
        id: type,
        type,
        visible: false,
        order: sorted.length,
        size: WIDGET_META[type].defaultSize,
      });
    }
  }
  return sorted.map((w, i) => ({ ...w, order: i }));
}

export function loadV2Layout(): DashboardWidget[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const seen = new Set<WidgetType>();
    const widgets: DashboardWidget[] = [];
    for (const item of parsed) {
      if (!isValidStoredWidget(item) || seen.has(item.type)) continue;
      seen.add(item.type);
      const m = WIDGET_META[item.type];
      widgets.push({
        id: item.type,
        type: item.type,
        visible: item.visible,
        order: item.order,
        size: m.allowedSizes.includes(item.size) ? item.size : m.defaultSize,
      });
    }
    if (widgets.length === 0) return null;
    return normalizeLayout(widgets);
  } catch {
    return null;
  }
}

// Migrate from the v1 layout (no sizes). The v1 key is intentionally kept.
export function loadV1Layout(): DashboardWidget[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V1);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const seen = new Set<WidgetType>();
    const widgets: DashboardWidget[] = [];
    for (const item of parsed) {
      if (!isValidV1Widget(item) || seen.has(item.type)) continue;
      seen.add(item.type);
      widgets.push({
        id: item.type,
        type: item.type,
        visible: item.visible,
        order: item.order,
        size: V1_SIZES[item.type],
      });
    }
    if (widgets.length === 0) return null;
    return normalizeLayout(widgets);
  } catch {
    return null;
  }
}

export function loadLayout(): DashboardWidget[] {
  return loadV2Layout() ?? loadV1Layout() ?? presetLayout('classic');
}

function saveLayout(widgets: DashboardWidget[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(widgets));
  } catch {
    // storage full or unavailable – silently ignore
  }
}

/**
 * Move the widget `fromId` to the position of `toId` within the sorted list
 * and renumber the order values. Returns the input array untouched when
 * either id is unknown or both are the same (lets React bail out).
 */
export function reorderLayout(
  widgets: DashboardWidget[],
  fromId: string,
  toId: string,
): DashboardWidget[] {
  const fromIndex = widgets.findIndex((w) => w.id === fromId);
  const toIndex = widgets.findIndex((w) => w.id === toId);
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return widgets;
  const updated = [...widgets];
  const [moved] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, moved);
  return updated.map((w, i) => ({ ...w, order: i }));
}

function detectFirstRun(): boolean {
  try {
    return (
      localStorage.getItem(STORAGE_KEY_V2) === null &&
      localStorage.getItem(STORAGE_KEY_V1) === null &&
      localStorage.getItem(SETUP_SEEN_KEY) === null
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDashboardLayout() {
  const [widgets, setWidgets] = useState<DashboardWidget[]>(loadLayout);
  const [isFirstRun, setIsFirstRun] = useState<boolean>(detectFirstRun);

  // Persist only after the first mutation so an untouched first run leaves
  // no v2 layout behind (keeps the first-run detection intact on reload).
  // Guarded by reference equality against the initially loaded layout rather
  // than a "skip first effect run" ref: under React 18 StrictMode the mount
  // effect runs twice, which would otherwise write the v2 key on mere app
  // start and permanently defeat first-run detection in dev.
  const initialWidgets = useRef(widgets);
  useEffect(() => {
    if (widgets === initialWidgets.current) return;
    saveLayout(widgets);
  }, [widgets]);

  const addWidget = useCallback((type: WidgetType) => {
    setWidgets((prev) => {
      const target = prev.find((w) => w.type === type);
      if (!target) return prev;
      const rest = prev.filter((w) => w.type !== type);
      const next = [...rest, { ...target, visible: true, size: WIDGET_META[type].defaultSize }];
      return next.map((w, i) => ({ ...w, order: i }));
    });
  }, []);

  const removeWidget = useCallback((id: string) => {
    setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, visible: false } : w)));
  }, []);

  const setWidgetSize = useCallback((id: string, size: WidgetSize) => {
    setWidgets((prev) =>
      prev.map((w) =>
        w.id === id && WIDGET_META[w.type].allowedSizes.includes(size) ? { ...w, size } : w,
      ),
    );
  }, []);

  const reorderWidgets = useCallback((fromId: string, toId: string) => {
    setWidgets((prev) => reorderLayout(prev, fromId, toId));
  }, []);

  const applyPreset = useCallback((presetId: DashboardPreset['id']) => {
    setWidgets(presetLayout(presetId));
  }, []);

  const resetLayout = useCallback(() => {
    setWidgets(presetLayout('classic'));
  }, []);

  const dismissFirstRun = useCallback(() => {
    try {
      localStorage.setItem(SETUP_SEEN_KEY, '1');
    } catch {
      // storage unavailable – silently ignore
    }
    setIsFirstRun(false);
  }, []);

  return {
    widgets,
    addWidget,
    removeWidget,
    setWidgetSize,
    reorderWidgets,
    applyPreset,
    resetLayout,
    isFirstRun,
    dismissFirstRun,
  };
}
