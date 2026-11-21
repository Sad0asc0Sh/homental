import { BadRequestException } from '@nestjs/common';

/** Canonical Iranian mobile: 10 national digits starting with 9. */
const IRAN_MOBILE_REGEX = /^9\d{9}$/;

/**
 * Normalizes Iranian mobile numbers to canonical E.164: `+989XXXXXXXXX`.
 * Accepts `0912…`, `912…`, `0098912…`, `+98912…` (spaces/dashes/parens are
 * stripped first). Invalid numbers raise a Persian 400.
 */
export function normalizeIranPhone(raw: string): string {
  const cleaned = raw.replace(/[().\-\s]/g, '').replace(/^\+/, '');
  let digits = cleaned;
  if (digits.startsWith('00')) digits = digits.slice(2); // 00 international prefix
  if (digits.startsWith('0')) digits = digits.slice(1); // national trunk prefix
  if (digits.startsWith('98')) digits = digits.slice(2); // country code without +
  if (!IRAN_MOBILE_REGEX.test(digits)) {
    throw new BadRequestException({
      statusCode: 400,
      message: 'شماره موبایل واردشده معتبر نیست. مثال صحیح: ۰۹۱۲۳۴۵۶۷۸۹ یا +989123456789',
    });
  }
  return `+98${digits}`;
}
