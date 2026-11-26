export const BPS = 10_000n;

export function ceilDivide(value: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) throw new RangeError('Divisor must be positive');
  return value / divisor + (value % divisor > 0n ? 1n : 0n);
}

/** Convert a nonnegative decimal rate to integer basis points, rounding half up. */
export function rateToBps(value: { toString(): string }): bigint {
  const [whole = '', fraction = '', extra] = value.toString().split('.');
  if (extra !== undefined || !/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) {
    throw new RangeError('Rate must be a nonnegative decimal');
  }
  return BigInt(whole) * BPS + BigInt(fraction.slice(0, 4).padEnd(4, '0')) +
    (fraction.charAt(4) >= '5' ? 1n : 0n);
}
