const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** Converts Latin digits to Persian digits. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

/** Converts Persian (`۰-۹`) and Arabic-Indic (`٠-٩`) digits to ASCII `0-9`. */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660));
}

/** Generates a UUID v4, falling back gracefully outside secure browser contexts. */
export function generateUuid(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 14500000 → «۱۴,۵۰۰,۰۰۰» (grouped, Persian digits). */
export function formatNumberFa(value: number | string): string {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(numeric)) return toPersianDigits(String(value));
  return toPersianDigits(numeric.toLocaleString('en-US'));
}

export function formatMeters(centimetres: number): string {
  return `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 }).format(centimetres / 100)} متر`;
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
  if (style === 'full' && typeof value === 'string' && /^-?\d+$/.test(value)) {
    return `${toPersianDigits(BigInt(value).toLocaleString('en-US'))} تومان`;
  }
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
