import { describe, it, expect, beforeEach } from 'vitest';
import {
  isValidStoredWidget,
  loadLayout,
  loadV1Layout,
  loadV2Layout,
  presetLayout,
  reorderLayout,
  DASHBOARD_PRESETS,
  WIDGET_META,
  STORAGE_KEY_V1,
  STORAGE_KEY_V2,
  type DashboardWidget,
  type WidgetType,
} from './useDashboardLayout';

// Tests run in a node environment — provide a minimal in-memory localStorage
// (same approach the storage-backed hooks are tested with).
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const storage = new MemoryStorage();
(globalThis as { localStorage?: unknown }).localStorage = storage;

const ALL_TYPES: WidgetType[] = [
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

const byType = (widgets: DashboardWidget[], type: WidgetType): DashboardWidget => {
  const w = widgets.find((x) => x.type === type);
  if (!w) throw new Error(`widget ${type} missing`);
  return w;
};

beforeEach(() => {
  storage.clear();
});

describe('isValidStoredWidget (localStorage guard)', () => {
  it('accepts a well-formed stored widget', () => {
    expect(
      isValidStoredWidget({ id: 'news', type: 'news', visible: true, order: 3, size: 'M' })
    ).toBe(true);
  });

  it('rejects non-objects and null', () => {
    expect(isValidStoredWidget(null)).toBe(false);
    expect(isValidStoredWidget(undefined)).toBe(false);
    expect(isValidStoredWidget('news')).toBe(false);
    expect(isValidStoredWidget(42)).toBe(false);
    expect(isValidStoredWidget({})).toBe(false);
  });

  it('rejects unknown widget types, sizes and wrongly-typed fields', () => {
    const valid = { id: 'news', type: 'news', visible: true, order: 0, size: 'M' };
    expect(isValidStoredWidget({ ...valid, type: 'cryptoTicker' })).toBe(false);
    expect(isValidStoredWidget({ ...valid, size: 'XXL' })).toBe(false);
    expect(isValidStoredWidget({ ...valid, visible: 'yes' })).toBe(false);
    expect(isValidStoredWidget({ ...valid, order: '0' })).toBe(false);
  });
});

describe('loadV2Layout (validation + normalization)', () => {
  it('returns null when the key is missing, corrupt or not an array', () => {
    expect(loadV2Layout()).toBeNull();
    storage.setItem(STORAGE_KEY_V2, '{not json');
    expect(loadV2Layout()).toBeNull();
    storage.setItem(STORAGE_KEY_V2, '{"a":1}');
    expect(loadV2Layout()).toBeNull();
    storage.setItem(STORAGE_KEY_V2, '[]');
    expect(loadV2Layout()).toBeNull();
  });

  it('drops corrupt entries and unknown types, keeps valid ones', () => {
    storage.setItem(
      STORAGE_KEY_V2,
      JSON.stringify([
        { id: 'news', type: 'news', visible: true, order: 0, size: 'L' },
        { id: 'bogus', type: 'bogus', visible: true, order: 1, size: 'M' },
        null,
        'garbage',
        { type: 'earnings' },
      ])
    );
    const layout = loadV2Layout();
    expect(layout).not.toBeNull();
    expect(byType(layout!, 'news')).toMatchObject({ visible: true, size: 'L' });
    // every known type exists exactly once, nothing else
    expect(layout!.map((w) => w.type).sort()).toEqual([...ALL_TYPES].sort());
  });

  it('ignores duplicate entries for the same type (first wins)', () => {
    storage.setItem(
      STORAGE_KEY_V2,
      JSON.stringify([
        { id: 'news', type: 'news', visible: true, order: 0, size: 'L' },
        { id: 'news', type: 'news', visible: false, order: 1, size: 'S' },
      ])
    );
    const layout = loadV2Layout()!;
    const news = layout.filter((w) => w.type === 'news');
    expect(news).toHaveLength(1);
    expect(news[0]).toMatchObject({ visible: true, size: 'L' });
  });

  it('falls back to the default size when the stored size is not allowed', () => {
    // miniHeatmap only allows L/XL
    storage.setItem(
      STORAGE_KEY_V2,
      JSON.stringify([{ id: 'miniHeatmap', type: 'miniHeatmap', visible: true, order: 0, size: 'S' }])
    );
    expect(byType(loadV2Layout()!, 'miniHeatmap').size).toBe(
      WIDGET_META.miniHeatmap.defaultSize
    );
  });

  it('appends missing types hidden with their default size and renumbers order', () => {
    storage.setItem(
      STORAGE_KEY_V2,
      JSON.stringify([
        { id: 'news', type: 'news', visible: true, order: 7, size: 'M' },
        { id: 'portfolio', type: 'portfolio', visible: true, order: 2, size: 'XL' },
      ])
    );
    const layout = loadV2Layout()!;
    // sorted by stored order, then appended types
    expect(layout[0].type).toBe('portfolio');
    expect(layout[1].type).toBe('news');
    expect(layout.map((w) => w.order)).toEqual(layout.map((_, i) => i));
    const quick = byType(layout, 'quickActions');
    expect(quick.visible).toBe(false);
    expect(quick.size).toBe(WIDGET_META.quickActions.defaultSize);
  });
});

describe('loadV1Layout (v1 → v2 migration)', () => {
  const v1 = (type: string, visible: boolean, order: number) => ({ type, visible, order });

  it('keeps visible/order and maps the fixed v1 sizes per type', () => {
    storage.setItem(
      STORAGE_KEY_V1,
      JSON.stringify([
        v1('miniHeatmap', true, 0),
        v1('portfolio', true, 1),
        v1('topGainers', false, 2),
        v1('watchlistTable', true, 3),
        v1('sectorPerformance', true, 4),
        v1('news', true, 5),
      ])
    );
    const layout = loadV1Layout()!;
    expect(byType(layout, 'portfolio')).toMatchObject({ visible: true, size: 'XL' });
    expect(byType(layout, 'miniHeatmap')).toMatchObject({ visible: true, size: 'XL' });
    expect(byType(layout, 'watchlistTable')).toMatchObject({ visible: true, size: 'L' });
    expect(byType(layout, 'sectorPerformance')).toMatchObject({ visible: true, size: 'S' });
    expect(byType(layout, 'topGainers')).toMatchObject({ visible: false, size: 'M' });
    expect(byType(layout, 'news')).toMatchObject({ visible: true, size: 'M' });
    // order preserved: miniHeatmap before portfolio
    expect(layout.findIndex((w) => w.type === 'miniHeatmap')).toBeLessThan(
      layout.findIndex((w) => w.type === 'portfolio')
    );
  });

  it('adds the new v2-only widgets hidden', () => {
    storage.setItem(STORAGE_KEY_V1, JSON.stringify([v1('portfolio', true, 0)]));
    const layout = loadV1Layout()!;
    expect(byType(layout, 'quickActions').visible).toBe(false);
    expect(byType(layout, 'marketStatus').visible).toBe(false);
  });

  it('rejects v1 entries with unknown types or bad shapes', () => {
    storage.setItem(
      STORAGE_KEY_V1,
      JSON.stringify([v1('portfolio', true, 0), v1('quickActions', true, 1), null, { type: 5 }])
    );
    const layout = loadV1Layout()!;
    // quickActions did not exist in v1 → the stored entry is invalid, so it
    // is appended as a hidden default instead of being taken over as visible.
    expect(byType(layout, 'quickActions').visible).toBe(false);
    expect(byType(layout, 'portfolio').visible).toBe(true);
  });

  it('does not delete the v1 key during migration', () => {
    storage.setItem(STORAGE_KEY_V1, JSON.stringify([v1('portfolio', true, 0)]));
    loadV1Layout();
    loadLayout();
    expect(storage.getItem(STORAGE_KEY_V1)).not.toBeNull();
  });
});

describe('loadLayout (precedence)', () => {
  it('prefers v2 over v1, and falls back to the classic preset', () => {
    // no keys → classic
    expect(loadLayout()).toEqual(presetLayout('classic'));

    storage.setItem(
      STORAGE_KEY_V1,
      JSON.stringify([{ type: 'portfolio', visible: false, order: 0 }])
    );
    expect(byType(loadLayout(), 'portfolio').visible).toBe(false);

    storage.setItem(
      STORAGE_KEY_V2,
      JSON.stringify([{ id: 'portfolio', type: 'portfolio', visible: true, order: 0, size: 'M' }])
    );
    expect(byType(loadLayout(), 'portfolio')).toMatchObject({ visible: true, size: 'M' });
  });
});

describe('presetLayout (applyPreset semantics)', () => {
  it('sets order, visibility and size exactly from the preset definition', () => {
    for (const preset of DASHBOARD_PRESETS) {
      const layout = presetLayout(preset.id);
      // all 11 widgets present, orders are 0..n contiguous
      expect(layout).toHaveLength(ALL_TYPES.length);
      expect(layout.map((w) => w.order)).toEqual(layout.map((_, i) => i));
      preset.widgets.forEach((pw, i) => {
        const w = layout[i];
        expect(w.type).toBe(pw.type);
        expect(w.visible).toBe(true);
        expect(w.size).toBe(pw.size);
        expect(w.id).toBe(pw.type);
      });
      // types not in the preset are hidden with their default size
      const included = new Set(preset.widgets.map((pw) => pw.type));
      for (const w of layout) {
        if (!included.has(w.type)) {
          expect(w.visible).toBe(false);
          expect(w.size).toBe(WIDGET_META[w.type].defaultSize);
        }
      }
    }
  });

  it('classic preset matches the documented default layout', () => {
    const layout = presetLayout('classic');
    const visible = layout.filter((w) => w.visible).map((w) => `${w.type}:${w.size}`);
    expect(visible).toEqual([
      'portfolio:XL',
      'marketOverview:XL',
      'topGainers:M',
      'topLosers:M',
      'watchlistTable:L',
      'sectorPerformance:S',
      'news:M',
      'earnings:M',
      'miniHeatmap:XL',
    ]);
  });
});

describe('reorderLayout', () => {
  const layout = presetLayout('classic');

  it('moves a widget to the target position and renumbers order', () => {
    // classic starts: portfolio, marketOverview, topGainers, ...
    const next = reorderLayout(layout, 'topGainers', 'portfolio');
    expect(next.slice(0, 3).map((w) => w.type)).toEqual([
      'topGainers',
      'portfolio',
      'marketOverview',
    ]);
    expect(next.map((w) => w.order)).toEqual(next.map((_, i) => i));
  });

  it('moves forward as well as backward', () => {
    const next = reorderLayout(layout, 'portfolio', 'topGainers');
    expect(next.slice(0, 3).map((w) => w.type)).toEqual([
      'marketOverview',
      'topGainers',
      'portfolio',
    ]);
  });

  it('returns the input unchanged for unknown ids or a self-drop', () => {
    expect(reorderLayout(layout, 'portfolio', 'portfolio')).toBe(layout);
    expect(reorderLayout(layout, 'nope', 'portfolio')).toBe(layout);
    expect(reorderLayout(layout, 'portfolio', 'nope')).toBe(layout);
  });

  it('does not mutate the input array', () => {
    const before = layout.map((w) => ({ ...w }));
    reorderLayout(layout, 'topGainers', 'portfolio');
    expect(layout).toEqual(before);
  });
});
