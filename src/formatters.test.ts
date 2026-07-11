import { describe, it, expect } from 'vitest';
import { normalizeCurrency, formatPrice } from './formatters';

// Reference formatter with the exact options formatPrice uses, so assertions
// stay robust against locale-specific spacing (NBSP etc.).
const ref = (value: number, currency: string, intlLocale: string) =>
  new Intl.NumberFormat(intlLocale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

describe('normalizeCurrency', () => {
  it('converts pence-quoted GBp to pounds (factor 100)', () => {
    expect(normalizeCurrency(12345, 'GBp')).toEqual({ value: 123.45, currency: 'GBP' });
  });

  it('converts the GBX alias identically', () => {
    expect(normalizeCurrency(50, 'GBX')).toEqual({ value: 0.5, currency: 'GBP' });
  });

  it('leaves GBP (already pounds) untouched — no double division', () => {
    expect(normalizeCurrency(123.45, 'GBP')).toEqual({ value: 123.45, currency: 'GBP' });
  });

  it('leaves other currencies untouched', () => {
    expect(normalizeCurrency(99.5, 'USD')).toEqual({ value: 99.5, currency: 'USD' });
    expect(normalizeCurrency(1500, 'JPY')).toEqual({ value: 1500, currency: 'JPY' });
    expect(normalizeCurrency(-42.1, 'EUR')).toEqual({ value: -42.1, currency: 'EUR' });
  });

  it('is idempotent: normalizing an already-normalized result is a no-op', () => {
    const once = normalizeCurrency(12345, 'GBp');
    expect(normalizeCurrency(once.value, once.currency)).toEqual(once);
  });
});

describe('formatPrice', () => {
  it('renders GBp values divided by 100 as GBP', () => {
    expect(formatPrice(12345, 'GBp', 'en')).toBe(ref(123.45, 'GBP', 'en-US'));
    expect(formatPrice(12345, 'GBp', 'de')).toBe(ref(123.45, 'GBP', 'de-DE'));
  });

  it('renders GBX values divided by 100 as GBP', () => {
    expect(formatPrice(50, 'GBX', 'en')).toBe(ref(0.5, 'GBP', 'en-US'));
  });

  it('renders plain GBP values unchanged (single division only)', () => {
    expect(formatPrice(123.45, 'GBP', 'en')).toBe(ref(123.45, 'GBP', 'en-US'));
  });

  it('renders USD/EUR values unchanged', () => {
    expect(formatPrice(99.5, 'USD', 'en')).toBe(ref(99.5, 'USD', 'en-US'));
    expect(formatPrice(99.5, 'EUR', 'de')).toBe(ref(99.5, 'EUR', 'de-DE'));
  });

  it('returns the em dash for null/undefined/NaN', () => {
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(undefined)).toBe('—');
    expect(formatPrice(NaN, 'GBp')).toBe('—');
  });
});
