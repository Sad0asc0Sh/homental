import { parseDurationToMs } from './duration.util';

describe('parseDurationToMs', () => {
  it.each([
    ['15m', 900_000],
    ['30d', 2_592_000_000],
    ['120s', 120_000],
    ['2h', 7_200_000],
    ['1d', 86_400_000],
  ])('parses %s to %i ms', (input, expected) => {
    expect(parseDurationToMs(input)).toBe(expected);
  });

  it('rejects invalid durations', () => {
    expect(() => parseDurationToMs('15minutes')).toThrow(/Invalid duration/);
    expect(() => parseDurationToMs('0m')).toThrow(/Invalid duration/);
    expect(() => parseDurationToMs('')).toThrow(/Invalid duration/);
  });
});
