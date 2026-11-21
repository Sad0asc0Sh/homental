import { BadRequestException, Injectable } from '@nestjs/common';
import type { ServiceDefinition, ServiceKey } from '@prisma/client';
import { SupplyMode, UrgencyLevel } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { DynamicFactorsService } from './dynamic-factors.service';
import { PricingSchemaInterpreter } from './pricing-schema.interpreter';
import type {
  AppliedComplexity,
  HardwareLine,
  InterpretationResult,
  LaborLine,
} from './pricing-schema.interpreter';

export interface EstimateItemInput {
  serviceKey: string;
  supplyMode?: SupplyMode;
  config?: Record<string, unknown>;
}

export interface EstimateInput {
  citySlug?: string;
  lat?: number;
  lng?: number;
  urgency?: UrgencyLevel;
  supplyMode?: SupplyMode;
  items: EstimateItemInput[];
}

export interface EstimateItemBreakdown {
  serviceKey: string;
  titleFa: string;
  supplyMode: SupplyMode;
  hardwareDropped: boolean;
  hardwareLines: HardwareLine[];
  hardwareSubtotal: bigint;
  laborLines: LaborLine[];
  appliedComplexities: AppliedComplexity[];
  laborSubtotal: bigint;
  dispatchFee: bigint;
  itemBaseSubtotal: bigint;
}

export interface PricingEstimateResult {
  currency: 'TOMAN';
  estimatedMin: bigint;
  estimatedMax: bigint;
  netEstimated: bigint;
  summary: {
    totalHardware: bigint;
    totalBaseLabor: bigint;
    totalBaseDispatch: bigint;
    dynamicLaborAndDispatch: bigint;
    bundleDiscountPercent: number;
    bundleDiscountAmount: bigint;
  };
  factors: {
    surge: { multiplier: number; activeTechs: number; pendingOrders: number; reasonFa: string };
    urgency: { urgency: UrgencyLevel; multiplier: number };
  };
  items: EstimateItemBreakdown[];
}

function roundTo100k(value: bigint): bigint {
  return BigInt(Math.round(Number(value) / 100_000)) * 100_000n;
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly interpreter: PricingSchemaInterpreter,
    private readonly factors: DynamicFactorsService,
  ) {}

  async estimate(input: EstimateInput): Promise<PricingEstimateResult> {
    // 0) Bundle hygiene — one line per service per order (OrderItem @@unique).
    const keys = input.items.map((item) => item.serviceKey);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'هر سرویس فقط یک‌بار می‌تواند در هر درخواست قیمت بیاید.',
      });
    }

    // 1) Load active definitions — pricingSchema documents are the only source.
    const definitions = await this.prisma.serviceDefinition.findMany({
      where: { isActive: true, key: { in: keys as ServiceKey[] } },
    });
    const byKey = new Map<string, ServiceDefinition>(definitions.map((d) => [d.key, d]));
    for (const key of new Set(keys)) {
      if (!byKey.has(key)) {
        throw new BadRequestException({
          statusCode: 400,
          message: `سرویس «${key}» فعال نیست یا تعریف نشده است.`,
        });
      }
    }

    // 2) Interpret every item (per-item supplyMode overrides the order-level).
    const interpretations: Array<InterpretationResult & { titleFa: string }> = input.items.map(
      (item) => {
        const definition = byKey.get(item.serviceKey) as ServiceDefinition;
        const effectiveSupplyMode = item.supplyMode ?? input.supplyMode ?? SupplyMode.FULL_PACKAGE;
        return {
          ...this.interpreter.interpret({
            serviceKey: item.serviceKey,
            pricingSchema: definition.pricingSchema,
            config: item.config ?? {},
            supplyMode: effectiveSupplyMode,
          }),
          titleFa: definition.titleFa,
        };
      },
    );

    // 3) Hardware vs dynamic-cost totals (Invariant 2: hardware is untouchable).
    const totalHardware = interpretations.reduce((sum, item) => sum + item.hardwareSubtotal, 0n);
    const totalBaseLabor = interpretations.reduce((sum, item) => sum + item.laborSubtotal, 0n);
    const totalBaseDispatch = interpretations.reduce((sum, item) => sum + item.dispatchFee, 0n);

    const surge = await this.factors.getSurge({
      citySlug: input.citySlug,
      lat: input.lat,
      lng: input.lng,
    });
    const urgency = await this.factors.getUrgency(input.urgency ?? UrgencyLevel.SCHEDULED);
    const combinedFactor = surge.multiplier * urgency.multiplier;
    const dynamicLaborAndDispatch = BigInt(
      Math.round(Number(totalBaseLabor + totalBaseDispatch) * combinedFactor),
    );

    // 4) Bundle discount on the raw total (hardware + dynamic costs).
    const rawTotal = totalHardware + dynamicLaborAndDispatch;
    const bundleDiscountPercent = await this.factors.getBundleDiscountPercent(
      interpretations.length,
    );
    const bundleDiscountAmount = (rawTotal * BigInt(bundleDiscountPercent)) / 100n;
    const netEstimated = rawTotal - bundleDiscountAmount;

    // 5) Realistic range from the selected services' own range documents.
    const minAdjustPct = Math.min(...interpretations.map((item) => item.range.minAdjustPct));
    const maxAdjustPct = Math.max(...interpretations.map((item) => item.range.maxAdjustPct));
    const estimatedMin = roundTo100k((netEstimated * BigInt(100 + minAdjustPct)) / 100n);
    const estimatedMax = roundTo100k((netEstimated * BigInt(100 + maxAdjustPct)) / 100n);

    const items: EstimateItemBreakdown[] = interpretations.map((item) => ({
      serviceKey: item.serviceKey,
      titleFa: item.titleFa,
      supplyMode: item.supplyMode,
      hardwareDropped: item.hardwareDropped,
      hardwareLines: item.hardwareLines,
      hardwareSubtotal: item.hardwareSubtotal,
      laborLines: item.laborLines,
      appliedComplexities: item.appliedComplexities,
      laborSubtotal: item.laborSubtotal,
      dispatchFee: item.dispatchFee,
      itemBaseSubtotal: item.hardwareSubtotal + item.laborSubtotal + item.dispatchFee,
    }));

    return {
      currency: 'TOMAN',
      estimatedMin,
      estimatedMax,
      netEstimated,
      summary: {
        totalHardware,
        totalBaseLabor,
        totalBaseDispatch,
        dynamicLaborAndDispatch,
        bundleDiscountPercent,
        bundleDiscountAmount,
      },
      factors: {
        surge: {
          multiplier: surge.multiplier,
          activeTechs: surge.activeTechs,
          pendingOrders: surge.pendingOrders,
          reasonFa: surge.reasonFa,
        },
        urgency: { urgency: urgency.urgency, multiplier: urgency.multiplier },
      },
      items,
    };
  }
}
