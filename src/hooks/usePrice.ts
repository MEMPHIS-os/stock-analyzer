import { useCallback } from 'react';
import { useApp } from '../context';
import { formatPrice } from '../formatters';

/**
 * Hook that provides a price formatter that auto-converts currencies.
 * Usage: const { fp } = usePrice();
 *        fp(123.45, 'USD') → "113,21 €" (if displayCurrency=EUR)
 */
export function usePrice() {
  const { convertPrice, locale } = useApp();

  const fp = useCallback(
    (price: number | undefined | null, nativeCurrency: string = 'USD'): string => {
      if (price == null || isNaN(price)) return '—';
      const { value, currency } = convertPrice(price, nativeCurrency);
      return formatPrice(value, currency, locale);
    },
    [convertPrice, locale]
  );

  return { fp };
}
