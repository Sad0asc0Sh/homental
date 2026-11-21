import { BadRequestException } from '@nestjs/common';
import { normalizeIranPhone } from './phone.util';

describe('normalizeIranPhone', () => {
  it.each([
    ['09123456789', '+989123456789'],
    ['9123456789', '+989123456789'],
    ['00989123456789', '+989123456789'],
    ['+989123456789', '+989123456789'],
    ['+98 912 345 6789', '+989123456789'],
    ['0912-345-6789', '+989123456789'],
    ['0-912-345-6789', '+989123456789'],
    ['(0)9123456789', '+989123456789'],
    ['09331234567', '+989331234567'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeIranPhone(input)).toBe(expected);
  });

  it.each([
    ['0912345678'], // too short
    ['091234567890'], // too long
    ['1234567890'], // not starting with 9
    ['08212345678'], // landline area code
    ['abc'], // garbage
    ['+981234567890'], // invalid after country code
  ])('rejects invalid number %s with a Persian 400', (input) => {
    expect(() => normalizeIranPhone(input)).toThrow(BadRequestException);
    try {
      normalizeIranPhone(input);
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as Record<string, unknown>;
      expect(body['message']).toContain('معتبر نیست');
    }
  });
});
