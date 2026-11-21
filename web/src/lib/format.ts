const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** Converts Latin digits to Persian digits. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

/** 14500000 → «۱۴,۵۰۰,۰۰۰» (grouped, Persian digits). */
export function formatNumberFa(value: number | string): string {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return toPersianDigits(String(value));
  return toPersianDigits(numeric.toLocaleString('en-US'));
}

/**
 * Money formatting (Toman):
 *  - compact: 14,500,000 → «۱۴.۵ میلیون تومان» (used in the sticky bar)
 *  - full:    14,500,000 → «۱۴,۵۰۰,۰۰۰ تومان» (used in breakdowns)
 */
export function formatToman(
  value: number | string,
  style: 'compact' | 'full' = 'compact',
): string {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return '—';
  if (style === 'full') return `${formatNumberFa(numeric)} تومان`;
  if (numeric >= 1_000_000) {
    const millions = numeric / 1_000_000;
    const rounded = Math.round(millions * 10) / 10;
    const text = Number.isInteger(rounded)
      ? toPersianDigits(rounded)
      : toPersianDigits(rounded.toFixed(1).replace('.', '٫'));
    return `${text} میلیون تومان`;
  }
  return `${formatNumberFa(numeric)} تومان`;
}
