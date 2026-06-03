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
}

/**
 * Renders a formatted, currency-converted price. When the global
 * "classic display board" (split-flap) mode is enabled it renders a Solari
 * board; otherwise it falls back to plain text with the given className.
 */
function PriceBase({
  value,
  currency = 'USD',
  size = 15,
  tone = 'neutral',
  className = '',
  flapClassName = '',
}: PriceProps) {
  const { fp } = usePrice();
  const { splitFlapEnabled } = useApp();
  const text = fp(value, currency);

  if (splitFlapEnabled && value != null && !isNaN(value as number)) {
    return <SplitFlap value={text} size={size} tone={tone} className={flapClassName} />;
  }

  return <span className={className}>{text}</span>;
}

export const Price = memo(PriceBase);
