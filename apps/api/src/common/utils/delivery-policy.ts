import type { DeliveryMode } from '@prisma/client';
import { z } from 'zod';

export const deliveryPolicySchema = z.object({
  bikeMaxGrams: z.number().int().positive(),
  bikeMaxCm3: z.number().int().positive(),
  bikeToman: z.string().regex(/^\d+$/),
  carToman: z.string().regex(/^\d+$/),
});

type DeliveryPolicy = z.infer<typeof deliveryPolicySchema>;

export function classifyShipment(
  policy: DeliveryPolicy,
  load: { weight: bigint; volume: bigint; bulky: boolean },
): { deliveryMode: DeliveryMode; freightCost: bigint } {
  const bike = !load.bulky && load.weight <= BigInt(policy.bikeMaxGrams) && load.volume <= BigInt(policy.bikeMaxCm3);
  return { deliveryMode: bike ? 'BIKE' : 'CAR', freightCost: BigInt(bike ? policy.bikeToman : policy.carToman) };
}
