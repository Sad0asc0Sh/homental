import { z } from 'zod';

export const dispatchPrioritySchema = z.object({
  priorityThresholdBps: z.number().int().min(0).max(2500),
  topMinRating: z.number().min(0).max(5),
  topMinReviews: z.number().int().nonnegative(),
});

export const DEFAULT_DISPATCH_PRIORITY = {
  priorityThresholdBps: 500,
  topMinRating: 4.7,
  topMinReviews: 20,
};

const dispatchPriorityOverrides = dispatchPrioritySchema.partial();

export function dispatchPriorityPolicy(value: unknown) {
  const parsed = dispatchPriorityOverrides.safeParse(value);
  return parsed.success ? { ...DEFAULT_DISPATCH_PRIORITY, ...parsed.data } : DEFAULT_DISPATCH_PRIORITY;
}
