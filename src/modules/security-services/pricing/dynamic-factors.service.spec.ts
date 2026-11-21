import type { PrismaService } from '@infra/prisma/prisma.service';
import type { RedisService } from '@infra/redis/redis.service';
import { DynamicFactorsService } from './dynamic-factors.service';

function buildService(options?: {
  configValue?: unknown;
  nearbyTechs?: number;
  onlineTechs?: number;
  pendingOrders?: number;
  redisError?: boolean;
}) {
  const prisma = {
    platformConfig: {
      // Return the value wrapped in a DB row shape ({ value }), like Prisma.
      findUnique: jest.fn().mockResolvedValue(
        options?.configValue !== undefined ? { value: options.configValue } : null,
      ),
    },
    serviceOrder: { count: jest.fn().mockResolvedValue(options?.pendingOrders ?? 0) },
  } as unknown as PrismaService;
  const redis = {
    findNearbyTechs: options?.redisError
      ? jest.fn().mockRejectedValue(new Error('Connection is closed'))
      : jest.fn().mockResolvedValue(Array.from({ length: options?.nearbyTechs ?? 0 }, () => ({}))),
    countOnlineTechs: options?.redisError
      ? jest.fn().mockRejectedValue(new Error('Connection is closed'))
      : jest.fn().mockResolvedValue(options?.onlineTechs ?? 0),
  } as unknown as RedisService;
  return { service: new DynamicFactorsService(prisma, redis), prisma, redis };
}

describe('DynamicFactorsService — surge (Snapp-like supply/demand, trust cap 1.25)', () => {
  it('balanced supply/demand → 1.0 «تعرفه عادی»', async () => {
    const { service } = buildService({ nearbyTechs: 4, pendingOrders: 4 }); // ratio 1.0
    const surge = await service.getSurge({ lat: 36.3, lng: 59.6 });
    expect(surge.multiplier).toBe(1.0);
    expect(surge.reasonFa).toBe('تعرفه عادی');
  });

  it('light scarcity produces a small surge strictly inside the cap', async () => {
    const { service } = buildService({ nearbyTechs: 4, pendingOrders: 3 }); // ratio 0.75
    const surge = await service.getSurge({ lat: 36.3, lng: 59.6 });
    expect(surge.multiplier).toBeGreaterThan(1.0);
    expect(surge.multiplier).toBeLessThan(1.25);
    expect(surge.reasonFa).toBe('تقاضای بالا در محدوده');
  });

  it('extreme scarcity hits the 1.25 trust cap with the Persian cap reason', async () => {
    const { service } = buildService({ nearbyTechs: 10, pendingOrders: 1 }); // ratio 0.1 ≤ 0.4
    const surge = await service.getSurge({ lat: 36.3, lng: 59.6 });
    expect(surge.multiplier).toBe(1.25);
    expect(surge.reasonFa).toBe('اوج تقاضا (سقف ضریب 1.25)');
  });

  it('zero active technicians clamps to the cap (division guard)', async () => {
    const { service } = buildService({ nearbyTechs: 0, pendingOrders: 7 });
    const surge = await service.getSurge({ lat: 36.3, lng: 59.6 });
    expect(surge.multiplier).toBe(1.25);
  });

  it('counts techs via GEO radius when coordinates exist, else city-wide', async () => {
    const { service, redis } = buildService({ onlineTechs: 3, pendingOrders: 0 });
    await service.getSurge({ citySlug: 'mashhad' });
    expect(redis.countOnlineTechs).toHaveBeenCalledWith('mashhad');

    const { service: withCoords, redis: redisWithCoords } = buildService({
      nearbyTechs: 2,
      pendingOrders: 0,
    });
    await withCoords.getSurge({ citySlug: 'mashhad', lat: 36.3, lng: 59.6 });
    expect(redisWithCoords.findNearbyTechs).toHaveBeenCalledWith(
      'mashhad',
      36.3,
      59.6,
      3000,
      100,
    );
  });

  it('degrades gracefully to 1.0 when Redis is unreachable (guest quote never crashes)', async () => {
    const { service, prisma } = buildService({ redisError: true, pendingOrders: 5 });
    const surge = await service.getSurge({ citySlug: 'mashhad', lat: 36.3, lng: 59.6 });
    expect(surge.multiplier).toBe(1.0);
    expect(surge.redisDegraded).toBe(true);
    expect(surge.pendingOrders).toBe(5);
    expect(prisma.serviceOrder.count).toHaveBeenCalled();
  });

  it('scopes pending orders by city when citySlug is provided', async () => {
    const { service, prisma } = buildService({ pendingOrders: 0 });
    await service.getSurge({ citySlug: 'mashhad', lat: 36.3, lng: 59.6 });
    expect(prisma.serviceOrder.count).toHaveBeenCalledWith({
      where: {
        state: { in: ['SEARCHING_EXPERT', 'BRANCH_QUEUE'] },
        address: { city: { slug: 'mashhad' } },
      },
    });
  });
});

describe('DynamicFactorsService — urgency & bundle (PlatformConfig-driven, safe defaults)', () => {
  it('maps urgency levels from config; missing key falls back safely to 1.0', async () => {
    const { service } = buildService();
    expect((await service.getUrgency('SCHEDULED')).multiplier).toBe(1.0);
    expect((await service.getUrgency('SAME_DAY')).multiplier).toBe(1.12);
    expect((await service.getUrgency('EMERGENCY')).multiplier).toBe(1.3);
  });

  it('bundle discount tiers: 1 → 0%, 2 → 6%, 3 → 10%, 5 → 10%', async () => {
    const { service } = buildService();
    expect(await service.getBundleDiscountPercent(1)).toBe(0);
    expect(await service.getBundleDiscountPercent(2)).toBe(6);
    expect(await service.getBundleDiscountPercent(3)).toBe(10);
    expect(await service.getBundleDiscountPercent(5)).toBe(10);
  });

  it('uses live PlatformConfig values when the key exists (zero magic numbers)', async () => {
    const { service } = buildService({
      configValue: { multipliers: { SCHEDULED: 1.0, SAME_DAY: 1.2, EMERGENCY: 1.5 } },
    });
    expect((await service.getUrgency('EMERGENCY')).multiplier).toBe(1.5);
  });
});
