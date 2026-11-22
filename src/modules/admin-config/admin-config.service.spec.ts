import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import type { PrismaService } from '@infra/prisma/prisma.service';
import { AdminConfigService } from './admin-config.service';

const adminActor: AuthenticatedUser = {
  id: 'super-1',
  phone: '+989120000001',
  role: UserRole.SUPER_ADMIN,
  branchId: null,
};

function buildAdminConfig(existingRows: Array<{ key: string; value: Record<string, unknown> }> = []) {
  const rows = existingRows.map((r) => ({ ...r, updatedAt: new Date(), updatedBy: 'seed' }));
  const prisma = {
    platformConfig: {
      findMany: jest.fn(async () => rows),
      upsert: jest.fn(async ({ where, update, create }: {
        where: { key: string };
        update: { value: Record<string, unknown>; updatedBy: string };
        create: { key: string; value: Record<string, unknown>; updatedBy: string };
      }) => {
        const idx = rows.findIndex((r) => r.key === where.key);
        if (idx >= 0) {
          rows[idx] = { key: where.key, value: update.value, updatedAt: new Date(), updatedBy: update.updatedBy };
          return rows[idx];
        }
        const created = { key: create.key, value: create.value, updatedAt: new Date(), updatedBy: create.updatedBy };
        rows.push(created);
        return created;
      }),
    },
  } as unknown as PrismaService;

  return { service: new AdminConfigService(prisma), prisma };
}

describe('AdminConfigService — PlatformConfig validation & updates', () => {
  it('merges persisted configs with defaults in listAll()', async () => {
    const { service } = buildAdminConfig([
      {
        key: 'escrow.split',
        value: { platformCommissionRate: 0.12, warrantyReserveRate: 0.05 },
      },
    ]);

    const list = await service.listAll();
    expect(list).toHaveLength(5);
    const escrow = list.find((c) => c.key === 'escrow.split');
    const surge = list.find((c) => c.key === 'pricing.surge');
    expect(escrow?.value).toEqual({ platformCommissionRate: 0.12, warrantyReserveRate: 0.05 });
    expect(surge?.value).toMatchObject({ maxMultiplier: 1.25 });
  });

  it('accepts valid updates across all 5 managed config keys', async () => {
    const { service } = buildAdminConfig();

    await expect(
      service.updateByKey(adminActor, 'pricing.surge', {
        minMultiplier: 1.0,
        maxMultiplier: 1.2,
        balancedRatio: 1.0,
        scarceRatio: 0.5,
        surgeRadiusMeters: 4000,
      }),
    ).resolves.toMatchObject({ key: 'pricing.surge' });

    await expect(
      service.updateByKey(adminActor, 'escrow.split', {
        platformCommissionRate: 0.14,
        warrantyReserveRate: 0.05,
      }),
    ).resolves.toMatchObject({ key: 'escrow.split' });

    await expect(
      service.updateByKey(adminActor, 'pricing.urgency', {
        multipliers: { SCHEDULED: 1.0, SAME_DAY: 1.15, EMERGENCY: 1.3 },
      }),
    ).resolves.toMatchObject({ key: 'pricing.urgency' });

    await expect(
      service.updateByKey(adminActor, 'pricing.bundleDiscount', {
        tiers: [
          { minServices: 2, percent: 6 },
          { minServices: 3, percent: 12 },
        ],
      }),
    ).resolves.toMatchObject({ key: 'pricing.bundleDiscount' });

    await expect(
      service.updateByKey(adminActor, 'dispatch.offer', {
        ttlSeconds: 30,
        initialRadiusMeters: 5000,
        radiusStepMeters: 7000,
        maxRadiusMeters: 20000,
        maxRounds: 3,
        maxParallelOffers: 3,
        weights: { proximity: 0.4, skillMatch: 0.25, rating: 0.2, warrantyClaimRate: 0.15 },
      }),
    ).resolves.toMatchObject({ key: 'dispatch.offer' });
  });

  it('rejects pricing.surge when maxMultiplier exceeds 1.25 trust cap', async () => {
    const { service } = buildAdminConfig();
    await expect(
      service.updateByKey(adminActor, 'pricing.surge', {
        minMultiplier: 1.0,
        maxMultiplier: 1.3,
        balancedRatio: 1.0,
        scarceRatio: 0.4,
        surgeRadiusMeters: 3000,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects escrow.split when commission + reserve exceeds 100%', async () => {
    const { service } = buildAdminConfig();
    await expect(
      service.updateByKey(adminActor, 'escrow.split', {
        platformCommissionRate: 0.7,
        warrantyReserveRate: 0.35,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects dispatch.offer when weights do not sum to 1.0', async () => {
    const { service } = buildAdminConfig();
    await expect(
      service.updateByKey(adminActor, 'dispatch.offer', {
        ttlSeconds: 30,
        initialRadiusMeters: 5000,
        radiusStepMeters: 7000,
        maxRadiusMeters: 20000,
        maxRounds: 3,
        maxParallelOffers: 3,
        weights: { proximity: 0.5, skillMatch: 0.5, rating: 0.2, warrantyClaimRate: 0.2 },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects unknown config keys', async () => {
    const { service } = buildAdminConfig();
    await expect(
      service.updateByKey(adminActor, 'unknown.key', { foo: 'bar' }),
    ).rejects.toThrow(BadRequestException);
  });
});
