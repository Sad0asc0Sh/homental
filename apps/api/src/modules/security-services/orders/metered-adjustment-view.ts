import { InternalServerErrorException } from '@nestjs/common';
import type { OrderAddon, OrderMeteredAdjustment } from '@prisma/client';
import { z } from 'zod';
import { MAX_QUANTITY_CM } from '../pricing/metered-quantity';

const readingsSchema = z.array(z.object({
  lineKey: z.string().min(1),
  actualCm: z.number().int().min(0).max(MAX_QUANTITY_CM),
  photoAssetId: z.string().min(1),
}));

export function parseMeterReadings(value: OrderMeteredAdjustment['readingsJson']) {
  const readings = readingsSchema.safeParse(value);
  if (!readings.success) throw new InternalServerErrorException('متراژ ثبت‌شده سفارش کامل نیست.');
  return readings.data;
}

export function meteredLineCm(line: Pick<OrderAddon, 'qty' | 'quantityCm'>) {
  return line.quantityCm ?? line.qty * 100;
}

export function toMeteredAdjustmentView(
  adjustment: OrderMeteredAdjustment,
  baseLines: Pick<OrderAddon, 'lineKey' | 'titleFa' | 'qty' | 'quantityCm'>[],
) {
  const { id, baseRevision, resultingRevision, status, deltaAmount, customerDecidedAt } = adjustment;
  const lines = new Map(baseLines.map((line) => [line.lineKey, line]));
  return {
    id, baseRevision, resultingRevision, status, deltaAmount: deltaAmount.toString(),
    customerDecidedAt: customerDecidedAt?.toISOString() ?? null,
    readings: parseMeterReadings(adjustment.readingsJson).map(({ lineKey, actualCm, photoAssetId }) => {
      const line = lines.get(lineKey);
      if (!line) throw new InternalServerErrorException('قلم متری نسخه سفارش یافت نشد.');
      return { lineKey, titleFa: line.titleFa, estimatedCm: meteredLineCm(line), actualCm, photoAssetId };
    }),
  };
}

export function toTechnicianMeteredAdjustmentView(adjustment: ReturnType<typeof toMeteredAdjustmentView>) {
  const { id, baseRevision, resultingRevision, status, customerDecidedAt, readings } = adjustment;
  return { id, baseRevision, resultingRevision, status, customerDecidedAt, readings };
}
