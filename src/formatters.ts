// Cache Intl.NumberFormat instances for performance
const _fmtCache = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(currency: string, intlLocale: string): Intl.NumberFormat {
  const key = `${intlLocale}:${currency}`;
  let fmt = _fmtCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(intlLocale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    _fmtCache.set(key, fmt);
  }
  return fmt;
}

/**
 * Normalise pence-quoted currencies: Yahoo reports LSE listings as 'GBp'
 * (or 'GBX') with prices in pence, which Intl would render as pounds.
 */
export function normalizeCurrency(
  value: number,
  currency: string,
): { value: number; currency: string } {
  if (currency === 'GBp' || currency === 'GBX') {
    return { value: value / 100, currency: 'GBP' };
  }
  return { value, currency };
}

export function formatPrice(
  value: number | undefined | null,
  currency: string = 'USD',
  locale: 'de' | 'en' = 'en',
): string {
  if (value == null || isNaN(value)) return '—';
  const norm = normalizeCurrency(value, currency);
  const intlLocale = locale === 'de' ? 'de-DE' : 'en-US';
  return getCurrencyFormatter(norm.currency, intlLocale).format(norm.value);
}

export function formatChange(value: number | undefined | null): string {
  if (value == null || isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

export function formatPercent(value: number | undefined | null): string {
  if (value == null || isNaN(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatLargeNumber(value: number | undefined | null): string {
  if (value == null || isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toFixed(2);
}

export function formatVolume(value: number | undefined | null): string {
  if (value == null || isNaN(value)) return '—';
  return formatLargeNumber(value);
}

export function formatRatio(value: number | undefined | null): string {
  if (value == null || isNaN(value)) return '—';
  return value.toFixed(2);
}

export function formatMarginPercent(value: number | undefined | null): string {
  if (value == null || isNaN(value)) return '—';
  return `${(value * 100).toFixed(2)}%`;
}

export function formatDate(dateStr: string | number | Date): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatTimeAgo(dateStr: string | number): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Gerade eben';
  if (diffMin < 60) return `Vor ${diffMin} Min.`;
  if (diffHrs < 24) return `Vor ${diffHrs} Std.`;
  if (diffDays < 7) return `Vor ${diffDays} Tag${diffDays > 1 ? 'en' : ''}`;
  return formatDate(dateStr);
}
