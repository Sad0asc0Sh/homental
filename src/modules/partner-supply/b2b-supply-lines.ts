import { InternalServerErrorException } from '@nestjs/common';
import { z } from 'zod';

const money = z.string().regex(/^\d+$/).transform((value) => BigInt(value));

const supplyLines = z.array(z.object({
  lineKey: z.string().min(1),
  sellerOfferId: z.string().uuid(),
  sellerId: z.string().uuid(),
  sku: z.string().min(1),
  titleFa: z.string().min(1),
  unit: z.enum(['EACH', 'METER']),
  qty: z.number().int().positive(),
  partnerUnitPrice: money,
  lineTotal: money,
})).min(1);

export function parseB2BLines(value: unknown) {
  const result = supplyLines.safeParse(value);
  if (!result.success || result.data.some((line) => line.partnerUnitPrice * BigInt(line.qty) !== line.lineTotal) ||
      new Set(result.data.map((line) => line.sellerOfferId)).size !== result.data.length) {
    throw new InternalServerErrorException('اطلاعات اقلام سفارش تأمین ناقص است.');
  }
  return result.data;
}

export type B2BSupplyLine = ReturnType<typeof parseB2BLines>[number];

export function snapshotB2BLines(lines: B2BSupplyLine[]) {
  return lines.map((line) => ({ ...line, partnerUnitPrice: line.partnerUnitPrice.toString(), lineTotal: line.lineTotal.toString() }));
}
