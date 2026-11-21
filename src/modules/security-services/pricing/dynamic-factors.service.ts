import { Injectable, Logger } from '@nestjs/common';
import { UrgencyLevel } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RedisService } from '@infra/redis/redis.service';

export interface SurgeFactor {
  multiplier: number;
  activeTechs: number;
  pendingOrders: number;
  reasonFa: string;
  /** true when Redis was unreachable and the trust-min multiplier was used. */
  redisDegraded?: boolean;
}

export interface UrgencyFactor {
  urgency: UrgencyLevel;
  multiplier: number;
}

interface SurgeConfig {
  minMultiplier: number;
  maxMultiplier: number;
  balancedRatio: number;
  scarceRatio: number;
  surgeRadiusMeters: number;
}

interface UrgencyConfig {
  multipliers: Record<string, number>;
}

interface BundleConfig {
  tiers: Array<{ minServices: number; percent: number }>;
}

/**
 * Safe typed defaults — used when a PlatformConfig key is missing.
 * Live values win (zero magic numbers in business logic, Invariant 2).
 */
const DEFAULT_SURGE: SurgeConfig = {
  minMultiplier: 1.0,
  maxMultiplier: 1.25, // trust cap
  balancedRatio: 1.0,
  scarceRatio: 0.4,
  surgeRadiusMeters: 3000,
};

const DEFAULT_URGENCY: UrgencyConfig = {
  multipliers: { SCHEDULED: 1.0, SAME_DAY: 1.12, EMERGENCY: 1.3 },
};

const DEFAULT_BUNDLE: BundleConfig = {
  tiers: [
    { minServices: 2, percent: 6 },
    { minServices: 3, percent: 10 },
  ],
};

const PENDING_DISPATCH_STATES = ['SEARCHING_EXPERT', 'BRANCH_QUEUE'] as const;
const DEFAULT_CITY_SLUG = 'mashhad';

/**
 * Snapp-like dynamic factors, all read from `PlatformConfig`:
 *  - Surge: supply/demand from Redis GEO technicians vs pending orders,
 *    clamped hard between min (1.0) and the 1.25 trust cap. Redis outages
 *    degrade gracefully to multiplier 1.0 so guest quotes never crash.
 *  - Urgency: SCHEDULED/SAME_DAY/EMERGENCY map — labor + dispatch ONLY.
 *  - Bundle: highest qualifying discount tier by distinct service count.
 */
@Injectable()
export class DynamicFactorsService {
  private readonly logger = new Logger(DynamicFactorsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  private async getConfig<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key } });
    return (row?.value as T | undefined) ?? fallback;
  }

  async getSurge(params: { citySlug?: string; lat?: number; lng?: number }): Promise<SurgeFactor> {
    const config = { ...DEFAULT_SURGE, ...(await this.getConfig<SurgeConfig>('pricing.surge', DEFAULT_SURGE)) };
    // Resolve the city ONCE so Redis GEO and Postgres stay consistent even
    // when the caller omitted citySlug (defaults to the pilot city).
    const citySlug = params.citySlug ?? DEFAULT_CITY_SLUG;

    const pendingOrders = await this.prisma.serviceOrder.count({
      where: {
        state: { in: [...PENDING_DISPATCH_STATES] },
        address: { city: { slug: citySlug } },
      },
    });

    let activeTechs: number;
    try {
      activeTechs =
        typeof params.lat === 'number' && typeof params.lng === 'number'
          ? (
              await this.redis.findNearbyTechs(
                citySlug,
                params.lat,
                params.lng,
                config.surgeRadiusMeters,
                100,
              )
            ).length
          : await this.redis.countOnlineTechs(citySlug);
    } catch (error: unknown) {
      this.logger.warn(
        `Surge degraded to 1.0 (Redis unreachable): ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        multiplier: config.minMultiplier,
        activeTechs: 0,
        pendingOrders,
        reasonFa: 'تعرفه عادی',
        redisDegraded: true,
      };
    }

    const multiplier = this.computeSurgeMultiplier(activeTechs, pendingOrders, config);
    return {
      multiplier,
      activeTechs,
      pendingOrders,
      reasonFa: this.surgeReasonFa(multiplier, config),
    };
  }

  /**
   * Supply/Demand surge (Part A hotfix — the previous implementation inverted
   * the clamp and charged max surge on an idle market). The ratio is
   * `activeTechs / pendingOrders`, matching the seed config comment:
   *   ratio ≥ balanced (1.0) → plenty of supply → min multiplier (calm)
   *   ratio ≤ scarce (0.4)  → heavy load     → max multiplier (trust cap)
   * Zero pending orders is always calm; demand with zero online technicians
   * is the most scarce situation → cap.
   */
  private computeSurgeMultiplier(activeTechs: number, pendingOrders: number, config: SurgeConfig): number {
    if (pendingOrders <= 0) return config.minMultiplier;
    if (activeTechs <= 0) return config.maxMultiplier;

    const supplyDemandRatio = activeTechs / pendingOrders;
    if (supplyDemandRatio >= config.balancedRatio) return config.minMultiplier;
    if (supplyDemandRatio <= config.scarceRatio) return config.maxMultiplier;

    const scarcity =
      (config.balancedRatio - supplyDemandRatio) / (config.balancedRatio - config.scarceRatio);
    const multiplier = config.minMultiplier + (config.maxMultiplier - config.minMultiplier) * scarcity;
    const clamped = Math.min(config.maxMultiplier, Math.max(config.minMultiplier, multiplier));
    return Math.round(clamped * 100) / 100;
  }

  private surgeReasonFa(multiplier: number, config: SurgeConfig): string {
    if (multiplier >= config.maxMultiplier) {
      return `اوج تقاضا (سقف ضریب ${config.maxMultiplier})`;
    }
    if (multiplier > config.minMultiplier) {
      return 'تقاضای بالا در محدوده';
    }
    return 'تعرفه عادی';
  }

  async getUrgency(urgency: UrgencyLevel): Promise<UrgencyFactor> {
    const config = { ...DEFAULT_URGENCY, ...(await this.getConfig<UrgencyConfig>('pricing.urgency', DEFAULT_URGENCY)) };
    const multiplier = Number(config.multipliers[urgency] ?? DEFAULT_URGENCY.multipliers[urgency]);
    return { urgency, multiplier };
  }

  async getBundleDiscountPercent(distinctServiceCount: number): Promise<number> {
    const config = { ...DEFAULT_BUNDLE, ...(await this.getConfig<BundleConfig>('pricing.bundleDiscount', DEFAULT_BUNDLE)) };
    const qualifying = [...config.tiers]
      .sort((a, b) => b.minServices - a.minServices)
      .find((tier) => distinctServiceCount >= tier.minServices);
    return qualifying?.percent ?? 0;
  }
}
