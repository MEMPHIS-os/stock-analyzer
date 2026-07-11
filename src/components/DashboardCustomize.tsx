import { useEffect, type DragEvent, type ReactNode } from 'react';
import {
  Check,
  GripVertical,
  LayoutDashboard,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import type {
  DashboardPreset,
  DashboardWidget,
  WidgetMeta,
  WidgetSize,
  WidgetType,
} from '../hooks/useDashboardLayout';

type TFn = (key: string) => string;

// ─── PresetPreview ───

const PREVIEW_SPANS: Record<WidgetSize, string> = {
  S: 'col-span-4',
  M: 'col-span-6',
  L: 'col-span-8',
  XL: 'col-span-12',
};

const PREVIEW_HEIGHTS: Record<WidgetType, string> = {
  portfolio: 'h-5',
  marketOverview: 'h-4',
  topGainers: 'h-4',
  topLosers: 'h-4',
  watchlistTable: 'h-5',
  news: 'h-4',
  earnings: 'h-4',
  sectorPerformance: 'h-4',
  miniHeatmap: 'h-5',
  quickActions: 'h-3',
  marketStatus: 'h-3',
};

const PREVIEW_TONES = ['bg-accent/40', 'bg-accent/25', 'bg-accent/30', 'bg-accent/20'];

export function PresetPreview({ preset }: { preset: DashboardPreset }) {
  return (
    <div className="grid grid-cols-12 gap-1 w-full rounded-lg bg-dark-700/30 p-1.5">
      {preset.widgets.map((w, i) => (
        <div
          key={w.type}
          className={`${PREVIEW_SPANS[w.size]} ${PREVIEW_HEIGHTS[w.type]} ${PREVIEW_TONES[i % PREVIEW_TONES.length]} rounded-sm`}
        />
      ))}
    </div>
  );
}

// ─── CustomizeToolbar ───

interface CustomizeToolbarProps {
  presets: DashboardPreset[];
  onApplyPreset: (id: DashboardPreset['id']) => void;
  onOpenGallery: () => void;
  onReset: () => void;
  onDone: () => void;
  t: TFn;
}

export function CustomizeToolbar({
  presets,
  onApplyPreset,
  onOpenGallery,
  onReset,
  onDone,
  t,
}: CustomizeToolbarProps) {
  return (
    <div className="sticky top-0 z-30 animate-slide-up">
      <div
        className="rounded-2xl shadow-depth-lg px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2.5"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          border: '1px solid var(--glass-border)',
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-accent/10 shrink-0">
            <SlidersHorizontal className="w-4 h-4 text-accent" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-txt-primary leading-tight">
              {t('dashboard.customize')}
            </div>
            <div className="text-[11px] text-txt-muted leading-snug truncate">
              {t('dashboard.customizeHint')}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {presets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => onApplyPreset(preset.id)}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-dark-700/40 text-txt-secondary ring-1 ring-border/10 hover:text-accent hover:bg-accent/10 hover:ring-accent/30 transition-all duration-200"
              title={t(preset.descKey)}
            >
              {t(preset.nameKey)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <button
            onClick={onOpenGallery}
            className="btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium"
            title={t('dashboard.addWidget')}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">{t('dashboard.addWidget')}</span>
          </button>
          <button
            onClick={onReset}
            className="btn-ghost flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium"
            title={t('dashboard.reset')}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('dashboard.reset')}</span>
          </button>
          <button
            onClick={onDone}
            className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold"
          >
            <Check className="w-4 h-4" />
            {t('dashboard.customizeDone')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── WidgetChrome ───

interface WidgetChromeProps {
  widget: DashboardWidget;
  meta: WidgetMeta;
  onRemove: () => void;
  onSizeChange: (size: WidgetSize) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: (e: DragEvent<HTMLDivElement>) => void;
  isDragging: boolean;
  isDragOver: boolean;
  t: TFn;
  children: ReactNode;
}

export function WidgetChrome({
  widget,
  meta,
  onRemove,
  onSizeChange,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  isDragOver,
  t,
  children,
}: WidgetChromeProps) {
  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', widget.id);
    onDragStart(e);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onDragOver(e);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    onDrop(e);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={onDragEnd}
      className={`relative rounded-2xl border-2 border-dashed p-2 transition-all duration-200 ${
        isDragOver
          ? 'border-accent/70 ring-2 ring-accent bg-accent/5'
          : 'border-accent/30 hover:border-accent/50'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 mb-2 rounded-xl bg-dark-700/40 ring-1 ring-border/10 cursor-grab active:cursor-grabbing select-none">
        <GripVertical className="w-4 h-4 text-txt-muted shrink-0" />
        <span className="text-xs font-semibold text-txt-primary truncate">
          {t(meta.labelKey)}
        </span>
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <div className="flex items-center rounded-lg bg-dark-600/40 p-0.5">
            {meta.allowedSizes.map((size) => {
              const active = widget.size === size;
              return (
                <button
                  key={size}
                  onClick={() => onSizeChange(size)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all duration-150 ${
                    active
                      ? 'bg-accent/20 text-accent shadow-glow-sm'
                      : 'text-txt-secondary hover:text-txt-primary'
                  }`}
                  title={t(`dashboard.size.${size}`)}
                >
                  {size}
                </button>
              );
            })}
          </div>
          <button
            onClick={onRemove}
            className="p-1 rounded-lg text-txt-secondary hover:text-danger hover:bg-danger/10 transition-colors duration-150"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="pointer-events-none opacity-70 select-none">{children}</div>
    </div>
  );
}

// ─── WidgetGallery ───

interface WidgetGalleryProps {
  hidden: WidgetMeta[];
  onAdd: (type: WidgetType) => void;
  onClose: () => void;
  t: TFn;
}

export function WidgetGallery({ hidden, onAdd, onClose, t }: WidgetGalleryProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center animate-backdrop-in"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-depth-lg w-full max-w-lg animate-scale-in mx-4 overflow-hidden flex flex-col max-h-[85vh]"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          border: '1px solid var(--glass-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--glass-border)' }}>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-accent/10">
              <Plus className="w-5 h-5 text-accent" />
            </div>
            <h2 className="text-base font-bold text-txt-primary tracking-tight">
              {t('dashboard.gallery.title')}
            </h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 min-h-0">
          {hidden.length === 0 ? (
            <div className="py-10 text-center text-txt-secondary">
              <LayoutDashboard className="w-10 h-10 text-txt-muted/20 mx-auto mb-3" />
              <p className="text-sm font-medium">{t('dashboard.gallery.empty')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {hidden.map((meta) => (
                <button
                  key={meta.type}
                  onClick={() => onAdd(meta.type)}
                  className="flex items-start gap-3 p-3.5 rounded-xl border border-border/10 text-left hover:border-accent/40 hover:bg-accent/5 transition-all duration-200 group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-txt-primary group-hover:text-accent transition-colors">
                      {t(meta.labelKey)}
                    </div>
                    <div className="text-[11px] text-txt-muted leading-snug mt-0.5">
                      {t(meta.descKey)}
                    </div>
                  </div>
                  <div className="p-1.5 rounded-lg bg-accent/10 group-hover:bg-accent/20 transition-colors shrink-0">
                    <Plus className="w-4 h-4 text-accent" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── FirstRunSetup ───

interface FirstRunSetupProps {
  presets: DashboardPreset[];
  onApplyPreset: (id: DashboardPreset['id']) => void;
  onCustom: () => void;
  onSkip: () => void;
  t: TFn;
}

export function FirstRunSetup({ presets, onApplyPreset, onCustom, onSkip, t }: FirstRunSetupProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSkip]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center animate-backdrop-in"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <div
        className="rounded-2xl shadow-depth-lg w-full max-w-2xl animate-scale-in mx-4 overflow-hidden flex flex-col max-h-[90vh]"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          border: '1px solid var(--glass-border)',
        }}
      >
        <div className="px-6 pt-6 pb-4 text-center shrink-0">
          <div className="inline-flex p-2.5 rounded-2xl bg-accent/10 ring-1 ring-accent/20 shadow-glow-sm mb-3">
            <Sparkles className="w-6 h-6 text-accent" />
          </div>
          <h2 className="text-xl font-bold text-txt-primary tracking-tight">
            {t('dashboard.firstRun.title')}
          </h2>
          <p className="text-sm text-txt-secondary mt-1">{t('dashboard.firstRun.subtitle')}</p>
        </div>

        <div className="px-6 overflow-y-auto flex-1 min-h-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 stagger-children">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => onApplyPreset(preset.id)}
                className="flex flex-col gap-2.5 p-3.5 rounded-xl border border-border/10 text-left hover:border-accent/40 hover:bg-accent/5 hover:shadow-glow-sm transition-all duration-200 group"
              >
                <PresetPreview preset={preset} />
                <div>
                  <div className="text-sm font-bold text-txt-primary group-hover:text-accent transition-colors">
                    {t(preset.nameKey)}
                  </div>
                  <div className="text-[11px] text-txt-muted leading-snug mt-0.5">
                    {t(preset.descKey)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 px-6 py-4 mt-2 border-t shrink-0" style={{ borderColor: 'var(--glass-border)' }}>
          <button
            onClick={onCustom}
            className="btn-ghost flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium"
          >
            <Wrench className="w-3.5 h-3.5" />
            {t('dashboard.firstRun.custom')}
          </button>
          <button
            onClick={onSkip}
            className="px-3.5 py-2 rounded-xl text-xs font-medium text-txt-muted hover:text-txt-primary hover:bg-dark-600/40 transition-all duration-200"
          >
            {t('dashboard.firstRun.skip')}
          </button>
        </div>
      </div>
    </div>
  );
}
