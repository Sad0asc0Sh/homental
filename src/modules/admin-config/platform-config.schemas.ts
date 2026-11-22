import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const bundleDiscountSchema = z
  .object({
    tiers: z
      .array(
        z.object({
          minServices: z.number().int().min(2).max(20),
          percent: z.number().min(0).max(50),
        }),
      )
      .min(1, 'حداقل یک سطح تخفیف پکیج لازم است.')
      .refine(
        (tiers) => new Set(tiers.map((t) => t.minServices)).size === tiers.length,
        'تعداد سرویس‌ها در سطوح تخفیف نباید تکراری باشد.',
      ),
  })
  .strict();

const urgencySchema = z
  .object({
    multipliers: z
      .object({
        SCHEDULED: z.number().min(1).max(3),
        SAME_DAY: z.number().min(1).max(3),
        EMERGENCY: z.number().min(1).max(3),
      })
      .refine(
        (m) => m.SCHEDULED <= m.SAME_DAY && m.SAME_DAY <= m.EMERGENCY,
        'ضریب فوریت باید به‌ترتیب عادی ≤ امروز ≤ اضطراری باشد.',
      ),
  })
  .strict();

const surgeSchema = z
  .object({
    minMultiplier: z.number().min(1).max(1.25),
    maxMultiplier: z.number().min(1).max(1.25, 'سقف ضریب شلوغی (Trust Cap) نمی‌تواند بیشتر از ۱.۲۵ باشد.'),
    balancedRatio: z.number().positive(),
    scarceRatio: z.number().positive(),
    surgeRadiusMeters: z.number().int().min(500).max(50_000),
  })
  .strict()
  .refine((s) => s.minMultiplier <= s.maxMultiplier, {
    message: 'حداقل ضریب شلوغی نمی‌تواند از حداکثر آن بیشتر باشد.',
  })
  .refine((s) => s.scarceRatio < s.balancedRatio, {
    message: 'نسبت کمبود (scarceRatio) باید کمتر از نسبت تعادل (balancedRatio) باشد.',
  });

const escrowSplitSchema = z
  .object({
    platformCommissionRate: z.number().min(0).max(1),
    warrantyReserveRate: z.number().min(0).max(1),
  })
  .strict()
  .refine((s) => s.platformCommissionRate + s.warrantyReserveRate <= 1, {
    message: 'مجموع نرخ کمیسیون و ذخیره گارانتی نمی‌تواند از ۱۰۰٪ (۱.۰) بیشتر باشد.',
  });

const dispatchOfferSchema = z
  .object({
    ttlSeconds: z.number().int().min(10).max(120),
    initialRadiusMeters: z.number().int().min(1000).max(50_000),
    radiusStepMeters: z.number().int().min(500).max(50_000),
    maxRadiusMeters: z.number().int().min(1000).max(100_000),
    maxRounds: z.number().int().min(1).max(10),
    maxParallelOffers: z.number().int().min(1).max(10),
    weights: z
      .object({
        proximity: z.number().min(0).max(1),
        skillMatch: z.number().min(0).max(1),
        rating: z.number().min(0).max(1),
        warrantyClaimRate: z.number().min(0).max(1),
      })
      .refine(
        (w) => Math.abs(w.proximity + w.skillMatch + w.rating + w.warrantyClaimRate - 1) <= 0.001,
        'مجموع وزن‌های امتیازدهی کارشناسان باید برابر با ۱.۰ باشد.',
      ),
  })
  .strict()
  .refine((d) => d.initialRadiusMeters <= d.maxRadiusMeters, {
    message: 'شعاع اولیه جستجو نمی‌تواند از حداکثر شعاع بیشتر باشد.',
  });

export const PLATFORM_CONFIG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  'pricing.bundleDiscount': bundleDiscountSchema,
  'pricing.urgency': urgencySchema,
  'pricing.surge': surgeSchema,
  'escrow.split': escrowSplitSchema,
  'dispatch.offer': dispatchOfferSchema,
};

export const PLATFORM_CONFIG_DEFAULTS: Record<string, Record<string, unknown>> = {
  'pricing.bundleDiscount': {
    tiers: [
      { minServices: 2, percent: 6 },
      { minServices: 3, percent: 10 },
    ],
  },
  'pricing.urgency': {
    multipliers: { SCHEDULED: 1.0, SAME_DAY: 1.12, EMERGENCY: 1.3 },
  },
  'pricing.surge': {
    minMultiplier: 1.0,
    maxMultiplier: 1.25,
    balancedRatio: 1.0,
    scarceRatio: 0.4,
    surgeRadiusMeters: 3000,
  },
  'escrow.split': {
    platformCommissionRate: 0.15,
    warrantyReserveRate: 0.05,
  },
  'dispatch.offer': {
    ttlSeconds: 30,
    initialRadiusMeters: 5000,
    radiusStepMeters: 7000,
    maxRadiusMeters: 20000,
    maxRounds: 3,
    maxParallelOffers: 3,
    weights: {
      proximity: 0.35,
      skillMatch: 0.25,
      rating: 0.2,
      warrantyClaimRate: 0.2,
    },
  },
};

export const MANAGED_CONFIG_KEYS = Object.keys(PLATFORM_CONFIG_SCHEMAS);

export function validatePlatformConfig(key: string, value: unknown): Record<string, unknown> {
  const schema = PLATFORM_CONFIG_SCHEMAS[key];
  if (!schema) {
    throw new BadRequestException({
      statusCode: 400,
      message: `کلید تنظیمات «${key}» معتبر نیست.`,
    });
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
      .join(' | ');
    throw new BadRequestException({
      statusCode: 400,
      message: `مقادیر تنظیمات «${key}» نامعتبر است: ${details}`,
    });
  }
  return parsed.data as Record<string, unknown>;
}
