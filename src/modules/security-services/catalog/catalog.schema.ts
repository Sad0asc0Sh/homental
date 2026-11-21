import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Structural Zod validation for admin-submitted JSONB documents.
 * Deliberately permissive about EXTRA fields (passthrough) but strict about
 * the parts the engines depend on (Invariant 14: schemas are data contracts).
 */
export const uiSchemaZod = z
  .object({
    $schema: z.string().min(1),
    titleFa: z.string().min(1),
    steps: z
      .array(
        z
          .object({
            id: z.string().min(1),
            titleFa: z.string().min(1),
            fields: z
              .array(
                z
                  .object({
                    id: z.string().min(1),
                    type: z.enum(['STEPPER', 'CHIPS', 'SWITCH']),
                    labelFa: z.string().min(1),
                  })
                  .passthrough(),
              )
              .min(1),
          })
          .passthrough(),
      )
      .min(1),
    goalCards: z
      .object({
        titleFa: z.string().min(1),
        cards: z.array(z.object({ id: z.string().min(1), titleFa: z.string().min(1) }).passthrough()),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const pricingSchemaZod = z
  .object({
    $schema: z.string().min(1),
    currency: z.literal('TOMAN'),
    variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    hardware: z.object({
      lineItems: z
        .array(
          z
            .object({
              ref: z.string().min(1),
              labelFa: z.string().min(1),
              qty: z.unknown(),
              unitPrice: z.number().int().nonnegative().optional(),
              unitPriceByOption: z
                .object({ variable: z.string(), options: z.record(z.string(), z.number().int()) })
                .optional(),
              unitPriceLogic: z.unknown().optional(),
            })
            .passthrough(),
        )
        .min(1),
    }),
    labor: z
      .object({
        base: z.object({ labelFa: z.string(), amount: z.number().int().nonnegative() }),
        perUnit: z.array(z.unknown()),
        complexity: z.array(z.unknown()),
      })
      .passthrough(),
    dispatch: z
      .object({ base: z.object({ labelFa: z.string(), amount: z.number().int().nonnegative() }) })
      .passthrough(),
    multipliersApplyTo: z.array(z.enum(['labor', 'dispatch'])),
    range: z.object({ minAdjustPct: z.number(), maxAdjustPct: z.number() }),
  })
  .passthrough();

export function parseCatalogDocument<T>(schema: z.ZodType<T>, value: unknown, labelFa: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new BadRequestException({ statusCode: 400, message: `${labelFa} معتبر نیست:\n${details}` });
  }
  return result.data;
}
