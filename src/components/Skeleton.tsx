import { memo } from 'react';

// Base shimmer skeleton block
export const SkeletonBlock = memo(function SkeletonBlock({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`skeleton-shimmer rounded ${className}`}
      style={style}
    />
  );
});

// Text line skeleton (random width for natural look)
export const SkeletonText = memo(function SkeletonText({
  lines = 1,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  const widths = ['w-full', 'w-5/6', 'w-4/6', 'w-3/4', 'w-2/3'];
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`skeleton-shimmer h-3 rounded ${
            i === lines - 1 && lines > 1 ? widths[i % widths.length] : 'w-full'
          }`}
        />
      ))}
    </div>
  );
});

// Card skeleton for dashboard
export const SkeletonCard = memo(function SkeletonCard() {
  return (
    <div className="card bg-dark-800 p-4 space-y-3">
      <SkeletonBlock className="h-3 w-24" />
      <SkeletonBlock className="h-7 w-32" />
      <SkeletonBlock className="h-3 w-20" />
    </div>
  );
});

// Watchlist item skeleton
export const SkeletonWatchlistItem = memo(function SkeletonWatchlistItem() {
  return (
    <div className="flex items-center gap-2 px-2 py-2.5 border-b border-border/10">
      <SkeletonBlock className="w-3.5 h-3.5 rounded" />
      <div className="flex-1 space-y-1.5">
        <SkeletonBlock className="h-3.5 w-14" />
        <SkeletonBlock className="h-2.5 w-24" />
      </div>
      <SkeletonBlock className="w-[60px] h-[24px] rounded" />
      <div className="text-right space-y-1">
        <SkeletonBlock className="h-3 w-16 ml-auto" />
        <SkeletonBlock className="h-2.5 w-12 ml-auto" />
      </div>
    </div>
  );
});

// Table row skeleton
export const SkeletonTableRow = memo(function SkeletonTableRow({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="border-b border-dark-700">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="py-3 px-3">
          <SkeletonBlock className={`h-3.5 ${i === 0 ? 'w-20' : 'w-16'}`} />
        </td>
      ))}
    </tr>
  );
});

// Chart skeleton
export const SkeletonChart = memo(function SkeletonChart({ height = 480 }: { height?: number }) {
  return (
    <div
      className="skeleton-shimmer rounded-lg"
      style={{ height }}
    />
  );
});

// Stock overview skeleton (for detail page)
export const SkeletonStockOverview = memo(function SkeletonStockOverview() {
  return (
    <div className="animate-fade-in">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <SkeletonBlock className="h-7 w-20" />
            <SkeletonBlock className="h-4 w-32" />
          </div>
          <div className="flex items-baseline gap-3">
            <SkeletonBlock className="h-9 w-36" />
            <SkeletonBlock className="h-5 w-20" />
            <SkeletonBlock className="h-5 w-16" />
          </div>
        </div>
        <div className="flex gap-2">
          <SkeletonBlock className="h-8 w-24 rounded-lg" />
          <SkeletonBlock className="h-8 w-24 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-dark-700/50 rounded-lg px-3 py-2 space-y-1.5">
            <SkeletonBlock className="h-2.5 w-16" />
            <SkeletonBlock className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
});
