import { memo, useEffect, useRef, useState } from 'react';

interface FlapCharProps {
  char: string;
  flipDurationMs: number;
}

function FlapChar({ char, flipDurationMs }: FlapCharProps) {
  const [current, setCurrent] = useState(char);
  const [next, setNext] = useState<string | null>(null);
  const [flipping, setFlipping] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (char === current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setNext(char);
    setFlipping(true);
    timerRef.current = setTimeout(() => {
      setCurrent(char);
      setNext(null);
      setFlipping(false);
    }, flipDurationMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [char, current, flipDurationMs]);

  const isSeparator = current === ' ' || current === ',' || current === '.' || current === '€' || current === '$' || current === '%' || current === '+' || current === '-';

  return (
    <span
      className={`split-flap-char${isSeparator ? ' split-flap-char-sep' : ''}${flipping ? ' is-flipping' : ''}`}
      style={{ ['--flip-duration' as string]: `${flipDurationMs}ms` }}
    >
      {/* Top half (static) shows old char */}
      <span className="split-flap-half split-flap-top">
        <span className="split-flap-glyph">{current}</span>
      </span>
      {/* Bottom half (static) shows new char (or current if not flipping) */}
      <span className="split-flap-half split-flap-bottom">
        <span className="split-flap-glyph">{next ?? current}</span>
      </span>
      {/* Animated flap: top->bottom flip showing old char */}
      {flipping && next !== null && (
        <>
          <span className="split-flap-flap split-flap-flap-top">
            <span className="split-flap-glyph">{current}</span>
          </span>
          <span className="split-flap-flap split-flap-flap-bottom">
            <span className="split-flap-glyph">{next}</span>
          </span>
        </>
      )}
      {/* Hairline */}
      <span className="split-flap-hinge" />
    </span>
  );
}

interface SplitFlapProps {
  value: string;
  /** Optional minimum number of digit slots (left-padded with spaces). */
  minLength?: number;
  /** Color tone — drives the LED glow. */
  tone?: 'neutral' | 'positive' | 'negative' | 'accent';
  /** Render size in px (height). Width auto-scales. */
  size?: number;
  flipDurationMs?: number;
  className?: string;
  ariaLabel?: string;
}

function SplitFlapBase({
  value,
  minLength,
  tone = 'neutral',
  size = 18,
  flipDurationMs = 380,
  className = '',
  ariaLabel,
}: SplitFlapProps) {
  const padded = minLength && value.length < minLength
    ? value.padStart(minLength, ' ')
    : value;
  const chars = Array.from(padded);

  return (
    <span
      className={`split-flap split-flap-tone-${tone} ${className}`}
      style={{
        ['--flap-h' as string]: `${size}px`,
        ['--flap-w' as string]: `${Math.round(size * 0.62)}px`,
        ['--flap-fs' as string]: `${Math.round(size * 0.78)}px`,
      }}
      aria-label={ariaLabel ?? value}
      role="text"
    >
      {chars.map((c, i) => (
        <FlapChar key={i} char={c} flipDurationMs={flipDurationMs} />
      ))}
    </span>
  );
}

export const SplitFlap = memo(SplitFlapBase);
