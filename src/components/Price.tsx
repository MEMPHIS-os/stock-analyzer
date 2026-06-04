import { memo } from 'react';
import { SplitFlap } from './SplitFlap';
import { useApp } from '../context';
import { usePrice } from '../hooks/usePrice';

interface PriceProps {
  /** Raw price in its native currency; converted via usePrice(). */
  value: number | undefined | null;
  /** Native currency of `value` (defaults to USD). */
  currency?: string;
  /** Split-flap tile height in px when the board mode is active. */
  size?: number;
  /** Colour tone for the split-flap glyphs. */
  tone?: 'neutral' | 'positive' | 'negative' | 'accent';
  /** Classes applied to the plain-text span (ignored in split-flap mode). */
  className?: string;
  /** Extra classes applied to the split-flap wrapper. */
  flapClassName?: string;
  /**
   * Opt into the classic split-flap board. The board only renders when this is
   * true AND the global "classic display" mode is enabled. It is reserved for a
   * few hero spots (ticker, the large detail-page price) — everywhere else
   * Price stays plain text so number sizing reads consistently.
   */
  board?: boolean;
}

/**
 * Renders a formatted, currency-converted price. Plain text by default; renders
 * a Solari split-flap board only at hero spots that pass `board` while the
 * global classic-display mode is on.
 */
function PriceBase({
  value,
  currency = 'USD',
  size = 15,
  tone = 'neutral',
  className = '',
  flapClassName = '',
  board = false,
}: PriceProps) {
  const { fp } = usePrice();
  const { splitFlapEnabled } = useApp();
  const text = fp(value, currency);

  if (board && splitFlapEnabled && value != null && !isNaN(value as number)) {
    return <SplitFlap value={text} size={size} tone={tone} className={flapClassName} />;
  }

  return <span className={className}>{text}</span>;
}

export const Price = memo(PriceBase);
