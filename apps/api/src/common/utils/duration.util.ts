const UNIT_MS: Record<'s' | 'm' | 'h' | 'd', number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parses durations like `15m`, `30d`, `120s`, `2h` into milliseconds. */
export function parseDurationToMs(duration: string): number {
  const match = /^([1-9]\d*)(s|m|h|d)$/.exec(duration);
  const amount = match?.[1];
  const unit = match?.[2];
  if (!amount || !unit) {
    throw new Error(`Invalid duration "${duration}" — expected e.g. 15m, 30d, 120s, 2h`);
  }
  return Number(amount) * UNIT_MS[unit as keyof typeof UNIT_MS];
}
