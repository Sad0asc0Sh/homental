import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import type { PrismaService } from '@infra/prisma/prisma.service';
import { CitiesBranchesService } from './cities-branches.service';

const branchAdmin = {
  id: 'admin1',
  phone: '+989120000002',
  role: 'BRANCH_ADMIN',
  branchId: 'b1',
} as AuthenticatedUser;

const superAdmin = {
  id: 'sa1',
  phone: '+989120000001',
  role: 'SUPER_ADMIN',
  branchId: null,
} as AuthenticatedUser;

const ownBranch = {
  id: 'b1',
  adminId: 'admin1',
  code: 'MSHD-C1',
  cityId: 'city1',
  nameFa: 'شعبه مرکزی',
  addressFa: 'بلوار وکیل‌آباد',
  phone: '+989120000002',
  lat: 36.31,
  lng: 59.56,
  serviceRadiusMeters: 15_000,
  hasPhysicalShowroom: true,
  commissionRateOverride: 0.1,
  warrantyReserveOverride: null,
  isActive: true,
};

interface TxMock {
  branch: { create: jest.Mock };
  wallet: { create: jest.Mock };
}

function buildService() {
  const tx: TxMock = {
    branch: { create: jest.fn().mockResolvedValue(ownBranch) },
    wallet: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    city: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'city1', slug: 'mashhad', isActive: true }),
    },
    branch: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ ...ownBranch }),
    },
    wallet: { create: jest.fn() },
    $transaction: jest.fn(async (fn: (tx: TxMock) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  return { service: new CitiesBranchesService(prisma), prisma, tx };
}

describe('CitiesBranchesService — BRANCH_ADMIN isolation (Part B #5)', () => {
  it('a branch admin CAN update operational fields of their own branch', async () => {
    const { service, prisma } = buildService();
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue(ownBranch);

    const result = await service.updateBranch(branchAdmin, 'b1', { phone: '+989150000000' });

    expect(prisma.branch.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { phone: '+989150000000', addressFa: undefined, serviceRadiusMeters: undefined },
    });
    expect(result).not.toHaveProperty('commissionRateOverride');
    expect(result).not.toHaveProperty('warrantyReserveOverride');
  });

  it('a branch admin CANNOT modify commissionRateOverride of their own branch', async () => {
    const { service, prisma } = buildService();
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue(ownBranch);

    await expect(
      service.updateBranch(branchAdmin, 'b1', { phone: 'x', commissionRateOverride: 0.02 }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.branch.update).not.toHaveBeenCalled();
  });

  it('a branch admin CANNOT touch warrantyReserveOverride / showroom flag / core fields', async () => {
    const { service, prisma } = buildService();
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue(ownBranch);
    await expect(
      service.updateBranch(branchAdmin, 'b1', { warrantyReserveOverride: 0.05 }),
    ).rejects.toThrow(/ابرادمین/);
    await expect(
      service.updateBranch(branchAdmin, 'b1', { hasPhysicalShowroom: false }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.updateBranch(branchAdmin, 'b1', { code: 'MSHD-HACK' }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.branch.update).not.toHaveBeenCalled();
  });

  it('a branch admin CANNOT manage a DIFFERENT branch at all', async () => {
    const { service, prisma } = buildService();
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue({
      ...ownBranch,
      id: 'b2',
      adminId: 'admin2',
    });

    await expect(
      service.updateBranch(branchAdmin, 'b2', { phone: 'x' }),
    ).rejects.toThrow(/شعبه خودتان/);
    expect(prisma.branch.update).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN can update every field including commission overrides', async () => {
    const { service, prisma } = buildService();
    (prisma.branch.findUnique as jest.Mock).mockResolvedValue(ownBranch);

    await service.updateBranch(superAdmin, 'b1', {
      commissionRateOverride: 0.05,
      warrantyReserveOverride: null,
      hasPhysicalShowroom: true,
    });

    expect(prisma.branch.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: expect.objectContaining({ commissionRateOverride: 0.05, warrantyReserveOverride: null }),
    });
  });

  it('a branch admin listing branches sees ONLY their own branch', async () => {
    const { service, prisma } = buildService();
    (prisma.branch.findMany as jest.Mock).mockResolvedValue([ownBranch]);
    const result = await service.listBranches(branchAdmin);
    expect(prisma.branch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b1', adminId: 'admin1' } }),
    );
    expect(result).toMatchObject([{ id: 'b1', code: 'MSHD-C1' }]);
    expect(result[0]).not.toHaveProperty('commissionRateOverride');
    expect(result[0]).not.toHaveProperty('warrantyReserveOverride');
  });

  it('createBranch provisions the BRANCH wallet in the same transaction', async () => {
    const { service, tx } = buildService();
    await service.createBranch({
      cityId: 'city1',
      code: 'MSHD-C2',
      nameFa: 'شعبه دوم',
      addressFa: 'بلوار امام رضا',
      lat: 36.28,
      lng: 59.61,
      hasPhysicalShowroom: true,
      commissionRateOverride: 0.1,
    });
    expect(tx.branch.create).toHaveBeenCalledTimes(1);
    expect(tx.wallet.create).toHaveBeenCalledWith({
      data: { ownerType: 'BRANCH', ownerId: 'b1', branchId: 'b1' },
    });
  });
});
