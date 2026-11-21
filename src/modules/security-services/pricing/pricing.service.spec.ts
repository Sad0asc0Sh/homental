import { SupplyMode, UrgencyLevel } from '@prisma/client';
import type { PrismaService } from '@infra/prisma/prisma.service';
import { serviceDefinitions } from '../../../../prisma/seed';
import { JsonLogicEvaluator } from '../shared/json-logic.evaluator';
import type { DynamicFactorsService } from './dynamic-factors.service';
import { PricingSchemaInterpreter } from './pricing-schema.interpreter';
import { PricingService } from './pricing.service';

const seedDefinitions = serviceDefinitions.map((definition) => ({
  ...definition,
  version: 1,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  id: `def-${definition.key}`,
}));

interface FactorsStubOptions {
  surgeMultiplier?: number;
  urgencyMultiplier?: number;
  bundlePercent?: number;
}

function buildService(factorsOptions: FactorsStubOptions = {}) {
  const prisma = {
    serviceDefinition: { findMany: jest.fn().mockResolvedValue(seedDefinitions) },
  } as unknown as PrismaService;
  const factors = {
    getSurge: jest.fn().mockResolvedValue({
      multiplier: factorsOptions.surgeMultiplier ?? 1.0,
      activeTechs: 4,
      pendingOrders: 4,
      reasonFa: 'تعرفه عادی',
    }),
    getUrgency: jest
      .fn()
      .mockResolvedValue({ urgency: UrgencyLevel.SCHEDULED, multiplier: factorsOptions.urgencyMultiplier ?? 1.0 }),
    getBundleDiscountPercent: jest
      .fn()
      .mockResolvedValue(factorsOptions.bundlePercent ?? 0),
  } as unknown as DynamicFactorsService;
  const service = new PricingService(
    prisma,
    new PricingSchemaInterpreter(new JsonLogicEvaluator()),
    factors,
  );
  return { service, prisma, factors };
}

describe('PricingService — seeded schema flow (all BigInt Toman)', () => {
  it('estimates a single ALARM with defaults (no discount)', async () => {
    const { service } = buildService();
    const result = await service.estimate({
      items: [{ serviceKey: 'ALARM', config: {} }],
    });

    expect(result.currency).toBe('TOMAN');
    expect(result.summary.totalHardware).toBe(15_960_000n);
    expect(result.summary.totalBaseLabor).toBe(1_550_000n);
    expect(result.summary.totalBaseDispatch).toBe(180_000n);
    expect(result.summary.dynamicLaborAndDispatch).toBe(1_730_000n);
    expect(result.summary.bundleDiscountPercent).toBe(0);
    expect(result.netEstimated).toBe(17_690_000n);
  });

  it('Invariant 2 — hardware NEVER moves between SCHEDULED and EMERGENCY; labor+dispatch scale', async () => {
    const { service: scheduled } = buildService({ surgeMultiplier: 1.0, urgencyMultiplier: 1.0 });
    const { service: emergency } = buildService({ surgeMultiplier: 1.25, urgencyMultiplier: 1.3 });

    const items = [{ serviceKey: 'ALARM', config: { petImmune: true } }];
    const calm = await scheduled.estimate({ urgency: UrgencyLevel.SCHEDULED, items });
    const peak = await emergency.estimate({ urgency: UrgencyLevel.EMERGENCY, items });

    expect(peak.summary.totalHardware).toBe(calm.summary.totalHardware); // identical hardware
    expect(calm.summary.totalHardware).toBe(16_560_000n);
    expect(peak.summary.dynamicLaborAndDispatch).toBeGreaterThan(
      calm.summary.dynamicLaborAndDispatch,
    );
    // combined factor 1.25 × 1.3 = 1.625 applied ONLY to 1,730,000 labor+dispatch
    expect(calm.summary.dynamicLaborAndDispatch).toBe(1_730_000n);
    expect(peak.summary.dynamicLaborAndDispatch).toBe(2_811_250n);
  });

  it('Invariant 7 — mixed bundle: INSTALL_ONLY CCTV drops hardware, keeps ALARM hardware, still grants 6%', async () => {
    const { service } = buildService({ bundlePercent: 6 });
    const result = await service.estimate({
      supplyMode: SupplyMode.FULL_PACKAGE,
      items: [
        { serviceKey: 'CCTV', supplyMode: SupplyMode.INSTALL_ONLY, config: { cameraCount: 4, remoteView: true } },
        { serviceKey: 'ALARM', config: {} },
      ],
    });

    const cctv = result.items.find((item) => item.serviceKey === 'CCTV');
    const alarm = result.items.find((item) => item.serviceKey === 'ALARM');
    expect(cctv?.hardwareDropped).toBe(true);
    expect(cctv?.hardwareSubtotal).toBe(0n);
    expect(cctv?.laborSubtotal).toBe(2_720_000n); // labor intact
    expect(alarm?.hardwareDropped).toBe(false);
    expect(alarm?.hardwareSubtotal).toBe(15_960_000n);

    expect(result.summary.totalHardware).toBe(15_960_000n); // ALARM hardware only
    expect(result.summary.totalBaseLabor).toBe(4_270_000n); // 2.72M + 1.55M
    expect(result.summary.totalBaseDispatch).toBe(360_000n);
    expect(result.summary.bundleDiscountPercent).toBe(6); // 2 distinct services
    // raw = 15,960,000 + 4,630,000 = 20,590,000 → 6% = 1,235,400
    expect(result.summary.bundleDiscountAmount).toBe(1_235_400n);
    expect(result.netEstimated).toBe(19_354_600n);
  });

  it('grants the 10% tier for a 3-service bundle', async () => {
    const { service, factors } = buildService({ bundlePercent: 10 });
    const result = await service.estimate({
      items: [
        { serviceKey: 'CCTV', config: {} },
        { serviceKey: 'ALARM', config: {} },
        { serviceKey: 'ELECTRIC_SHUTTER', config: {} },
      ],
    });
    expect(factors.getBundleDiscountPercent).toHaveBeenCalledWith(3);
    expect(result.summary.bundleDiscountPercent).toBe(10);
    // raw = 102,410,000 hardware + 8,070,000 labor+dispatch = 110,480,000 → 10% = 11,048,000
    expect(result.summary.bundleDiscountAmount).toBe(11_048_000n);
    expect(result.netEstimated).toBe(99_432_000n);
  });

  it('rounds estimatedMin/Max cleanly to the nearest 100,000 Toman', async () => {
    const { service } = buildService();
    const result = await service.estimate({
      items: [{ serviceKey: 'CCTV', config: { cameraCount: 4, remoteView: true } }],
    });
    // hardware 29,900,000 + labor/dispatch 2,900,000 → net 32,800,000
    // min ×0.9 = 29,520,000 → 29,500,000 ; max ×1.12 = 36,736,000 → 36,700,000
    expect(result.summary.totalHardware).toBe(29_900_000n);
    expect(result.netEstimated).toBe(32_800_000n);
    expect(result.estimatedMin).toBe(29_500_000n);
    expect(result.estimatedMax).toBe(36_700_000n);
    expect(result.estimatedMin).toBeLessThanOrEqual(result.netEstimated);
    expect(result.estimatedMax).toBeGreaterThanOrEqual(result.netEstimated);
  });

  it('rejects duplicate serviceKeys with a Persian 400', async () => {
    const { service } = buildService();
    await expect(
      service.estimate({
        items: [
          { serviceKey: 'ALARM', config: {} },
          { serviceKey: 'ALARM', config: {} },
        ],
      }),
    ).rejects.toThrow(/فقط یک‌بار/);
  });

  it('rejects unknown or inactive service keys with a Persian 400', async () => {
    const { service } = buildService();
    await expect(service.estimate({ items: [{ serviceKey: 'GOLD_ALARM' }] })).rejects.toThrow(
      /فعال نیست/,
    );
  });
});
