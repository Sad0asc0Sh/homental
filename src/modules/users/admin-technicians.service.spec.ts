import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import type { PrismaService } from '@infra/prisma/prisma.service';
import { AdminTechniciansService } from './admin-technicians.service';

const branchAdminA = {
  id: 'adminA',
  phone: '+989120000002',
  role: UserRole.BRANCH_ADMIN,
  branchId: 'b1',
} as AuthenticatedUser;

const branchAdminB = {
  id: 'adminB',
  phone: '+989120000003',
  role: UserRole.BRANCH_ADMIN,
  branchId: 'b2',
} as AuthenticatedUser;

const superAdmin = {
  id: 'sa1',
  phone: '+989120000001',
  role: UserRole.SUPER_ADMIN,
  branchId: null,
} as AuthenticatedUser;

const activeBranch = { id: 'b1', code: 'MSHD-C1', isActive: true };

interface TxMock {
  user: { upsert: jest.Mock; findUnique: jest.Mock };
  technicianProfile: { upsert: jest.Mock };
  wallet: { upsert: jest.Mock };
}

function buildService() {
  const tx: TxMock = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null), // new user by default
      upsert: jest.fn().mockResolvedValue({
        id: 'u9',
        phone: '+989121111111',
        role: UserRole.TECHNICIAN,
        status: 'ACTIVE',
      }),
    },
    technicianProfile: {
      upsert: jest
        .fn()
        .mockResolvedValue({ id: 'tp9', userId: 'u9', branchId: 'b1', status: 'PENDING_APPROVAL' }),
    },
    wallet: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    branch: { findUnique: jest.fn().mockResolvedValue(activeBranch) },
    technicianProfile: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn(async (fn: (tx: TxMock) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  return { service: new AdminTechniciansService(prisma), prisma, tx };
}

describe('AdminTechniciansService — cross-branch isolation (Part B #4)', () => {
  it('BRANCH_ADMIN cannot register a technician for ANOTHER branch', async () => {
    const { service } = buildService();
    await expect(
      service.create(branchAdminA, {
        phone: '09121111111',
        branchId: 'b2', // not their branch
        skills: ['CCTV'],
      }),
    ).rejects.toThrow(/شعبه خودتان/);
  });

  it('BRANCH_ADMIN can register a technician for their own branch (profile PENDING_APPROVAL + wallet)', async () => {
    const { service, tx } = buildService();
    const result = await service.create(branchAdminA, {
      phone: '09121111111',
      firstName: 'امیر',
      branchId: 'b1',
      skills: ['CCTV', 'ALARM'],
    });

    expect(tx.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ role: UserRole.TECHNICIAN, status: 'ACTIVE' }),
      }),
    );
    expect(tx.technicianProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ branchId: 'b1', status: 'PENDING_APPROVAL' }),
      }),
    );
    expect(tx.wallet.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { ownerType: 'TECHNICIAN', ownerId: 'u9' },
      }),
    );
    expect(result.user.role).toBe(UserRole.TECHNICIAN);
  });

  it('SUPER_ADMIN can register technicians for any branch', async () => {
    const { service, tx } = buildService();
    await service.create(superAdmin, {
      phone: '09121111111',
      branchId: 'b2',
      skills: ['PARKING_JACK'],
    });
    expect(tx.technicianProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ branchId: 'b2' }),
      }),
    );
  });

  it('BRANCH_ADMIN cannot approve/suspend a technician of ANOTHER branch', async () => {
    const { service, prisma } = buildService();
    (prisma.technicianProfile.findUnique as jest.Mock).mockResolvedValue({
      id: 'tpX',
      branchId: 'b2', // foreign branch
    });

    await expect(
      service.update(branchAdminA, 'tpX', { status: 'APPROVED' }),
    ).rejects.toThrow(/تکنسین‌های شعبه خودتان/);
    expect(prisma.technicianProfile.update).not.toHaveBeenCalled();
  });

  it('BRANCH_ADMIN can update technicians of their own branch; list is branch-locked', async () => {
    const { service, prisma } = buildService();
    (prisma.technicianProfile.findUnique as jest.Mock).mockResolvedValue({
      id: 'tp1',
      branchId: 'b1',
    });
    await service.update(branchAdminA, 'tp1', { status: 'APPROVED', skills: ['CCTV'] });
    expect(prisma.technicianProfile.update).toHaveBeenCalledWith({
      where: { id: 'tp1' },
      data: { status: 'APPROVED', skills: ['CCTV'] },
    });

    await service.list(branchAdminB, { page: 1, limit: 10 });
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { branchId: 'b2' } }),
    );
  });

  // ── Part A hotfix #1: role overwrite & hijack protection ───────────────────

  it('rejects with 409 when the phone belongs to a SUPER_ADMIN (role overwrite)', async () => {
    const { service, tx } = buildService();
    (tx.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'sa1',
      phone: '+989120000001',
      role: UserRole.SUPER_ADMIN,
      technicianProfile: null,
    });

    await expect(
      service.create(branchAdminA, {
        phone: '09120000001',
        branchId: 'b1',
        skills: ['CCTV'],
      }),
    ).rejects.toThrow(/مدیر/);
    expect(tx.user.upsert).not.toHaveBeenCalled();
  });

  it('rejects with 409 when the phone belongs to another BRANCH_ADMIN', async () => {
    const { service, tx } = buildService();
    (tx.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'adminB',
      role: UserRole.BRANCH_ADMIN,
      technicianProfile: null,
    });
    await expect(
      service.create(branchAdminA, { phone: '09120000003', branchId: 'b1', skills: ['ALARM'] }),
    ).rejects.toThrow(/مدیر/);
    expect(tx.user.upsert).not.toHaveBeenCalled();
  });

  it('BRANCH_ADMIN cannot steal (re-branch) a technician of ANOTHER branch', async () => {
    const { service, tx } = buildService();
    (tx.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u2',
      role: UserRole.TECHNICIAN,
      technicianProfile: { id: 'tp2', branchId: 'b2' },
    });

    await expect(
      service.create(branchAdminA, { phone: '09122222222', branchId: 'b1', skills: ['CCTV'] }),
    ).rejects.toThrow(/انتقال تکنسین/);
    expect(tx.technicianProfile.upsert).not.toHaveBeenCalled();
  });

  it('only SUPER_ADMIN may transfer an existing technician across branches', async () => {
    const { service, tx } = buildService();
    (tx.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u2',
      role: UserRole.TECHNICIAN,
      technicianProfile: { id: 'tp2', branchId: 'b2' },
    });

    await service.create(superAdmin, {
      phone: '09122222222',
      branchId: 'b1',
      skills: ['CCTV'],
    });
    expect(tx.technicianProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ branchId: 'b1' }),
      }),
    );
  });

  // ── Part A hotfix #3: unassigned BRANCH_ADMIN sees NOTHING ─────────────────

  it('an unassigned BRANCH_ADMIN (branchId null) gets an empty list, never all technicians', async () => {
    const { service, prisma } = buildService();
    const unassigned: AuthenticatedUser = { ...branchAdminA, branchId: null };
    const result = await service.list(unassigned, { page: 1, limit: 10 });
    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 10 });
    expect(prisma.technicianProfile.findMany).not.toHaveBeenCalled();
  });
});
