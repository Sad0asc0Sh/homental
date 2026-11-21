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

describe('DynamicFactorsService — surge (supply/demand, Part A hotfix scenarios)', () => {
  it('0 pending orders, 10 active techs → 1.0 «تعرفه عادی» (idle market is NEVER surged)', async () => {
    const { service } = buildService({ nearbyTechs: 10, pendingOrders: 0 });
    const surge = await service.getSurge({ lat: 36.3, lng: 59.6 });
    expect(surge.multiplier).toBe(1.0);
    expect(surge.reasonFa).toBe('تعرفه عادی');
  });

  it('5 pending, 10 techs (supply/demand 2.0) → 1.0', async () => {
    const { service } = buildService({ nearbyTechs: 10, pendingOrders: 5 });
    const surge = await service.getSurge({ lat: 36.3, lng: 59.6 });
    expect(surge.multiplier).toBe(1.0);
    expect(surge.reasonFa).toBe('تعرفه عادی');
  });

  it('10 pending, 7 techs (supply/demand 0.7) → 1.13 (linear scarcity midpoint)', async () => {
    const { service } = buildService({ nearbyTechs: 7, pendingOrders: 10 });
    const surge = await service.getSurge({ lat: 36.3, lng: 59.6 });
    // scarcity = (1.0 − 0.7) / (1.0 − 0.4) = 0.5 → 1 + 0.25 × 0.5 = 1.125 → 1.13
    expect(surge.multiplier).toBe(1.13);
    expect(surge.reasonFa).toBe('تقاضای بالا در محدوده');
  });

  it('10 pending, 4 techs (supply/demand 0.4) → 1.25 trust cap', async () => {
    const { service } = buildService({ nearbyTechs: 4, pendingOrders: 10 });
    const surge = await service.getSurge({ lat: 36.3, lng: 59.6 });
    expect(surge.multiplier).toBe(1.25);
    expect(surge.reasonFa).toBe('اوج تقاضا (سقف ضریب 1.25)');
  });

  it('5 pending, 0 active techs → 1.25 trust cap (unmet demand)', async () => {
    const { service } = buildService({ nearbyTechs: 0, pendingOrders: 5 });
    const surge = await service.getSurge({ lat: 36.3, lng: 59.6 });
    expect(surge.multiplier).toBe(1.25);
  });

  it('never exceeds the 1.25 trust cap for ANY input combination', async () => {
    const { service } = buildService({ nearbyTechs: 1, pendingOrders: 3 }); // s/d = 0.33 ≤ 0.4
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

  it('city-scope consistency: omitted citySlug scopes BOTH Redis and Postgres to the pilot city', async () => {
    const { service, prisma, redis } = buildService({ nearbyTechs: 2, pendingOrders: 1 });
    await service.getSurge({ lat: 36.3, lng: 59.6 }); // no citySlug → resolved to 'mashhad'
    expect(redis.findNearbyTechs).toHaveBeenCalledWith('mashhad', 36.3, 59.6, 3000, 100);
    expect(prisma.serviceOrder.count).toHaveBeenCalledWith({
      where: {
        state: { in: ['SEARCHING_EXPERT', 'BRANCH_QUEUE'] },
        address: { city: { slug: 'mashhad' } },
      },
    });
  });

  it('degrades gracefully to 1.0 when Redis is unreachable (guest quote never crashes)', async () => {
    const { service, prisma } = buildService({ redisError: true, pendingOrders: 5 });
    const surge = await service.getSurge({ citySlug: 'mashhad', lat: 36.3, lng: 59.6 });
    expect(surge.multiplier).toBe(1.0);
    expect(surge.redisDegraded).toBe(true);
    expect(surge.pendingOrders).toBe(5);
    expect(prisma.serviceOrder.count).toHaveBeenCalled();
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
