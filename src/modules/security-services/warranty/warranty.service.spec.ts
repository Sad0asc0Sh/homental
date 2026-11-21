import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import type { PrismaService } from '@infra/prisma/prisma.service';
import type { RealtimeService } from '@infra/realtime/realtime.service';
import type { NotificationsService } from '@modules/notifications/notifications.service';
import type { AppConfigService } from '@config/app-config.service';
import type { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';
import { WarrantyService } from './warranty.service';

const technician = { id: 't1', phone: '+989120000010', role: UserRole.TECHNICIAN, branchId: 'b1' } as AuthenticatedUser;
const customer = { id: 'c1', phone: '+989120000020', role: UserRole.CUSTOMER, branchId: null } as AuthenticatedUser;
const branchAdmin = { id: 'a1', phone: '+989120000002', role: UserRole.BRANCH_ADMIN, branchId: 'b1' } as AuthenticatedUser;

const defAlarm = { id: 'def-alarm', key: 'ALARM', titleFa: 'دزدگیر اماکن', warrantyMonths: 12 };
const defCctv = { id: 'def-cctv', key: 'CCTV', titleFa: 'دوربین مداربسته', warrantyMonths: 18 };

function buildService(options?: {
  orderState?: string;
  supplyMode?: string;
  withSerials?: boolean;
  finalQuoteAmount?: bigint | null;
}) {
  const orderState = options?.orderState ?? 'IN_PROGRESS';
  const supplyMode = options?.supplyMode ?? 'FULL_PACKAGE';
  const withSerials = options?.withSerials ?? false;

  const orderRow = {
    id: 'o1',
    orderNumber: 'HM-2026-000001',
    customerId: 'c1',
    technicianId: 't1',
    branchId: 'b1',
    state: orderState,
    supplyMode,
    finalQuoteAmount: options?.finalQuoteAmount ?? 2_000_000n,
    handoverOtpHash: null as string | null,
    handoverOtpExpiresAt: null as Date | null,
    handoverAttempts: 0,
    privacyChecklistSignedAt: null as Date | null,
    completedAt: null as Date | null,
  };

  const items = [
    {
      id: 'item-1',
      orderId: 'o1',
      supplyMode: null as string | null, // inherits order.supplyMode
      serviceDefinition: defAlarm,
      hardwareUnits: withSerials
        ? [{ id: 'hu-1', orderItemId: 'item-1', serialNumber: 'SN-ALARM-1' }]
        : [],
    },
    {
      id: 'item-2',
      orderId: 'o1',
      supplyMode: 'INSTALL_ONLY' as string | null, // customer's own CCTV
      serviceDefinition: defCctv,
      hardwareUnits: [],
    },
  ];

  const warranties: Array<Record<string, unknown>> = [];
  const claims: Array<Record<string, unknown>> = [];
  const technicianRow = {
    userId: 't1',
    completedJobs: 0,
    rating: 4.9,
    ratingCount: 210,
    warrantyClaimRate: 0.01,
  };

  const prisma = {
    serviceOrder: {
      // Always emulate the items include (serviceDefinition + hardwareUnits)
      // used by reloadOrder — plain reads simply ignore the extra keys.
      findUnique: jest.fn().mockImplementation(() => ({ ...orderRow, items: [...items] })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(orderRow, data);
        return { ...orderRow };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; state: string }; data: Record<string, unknown> }) => {
        if (orderRow.id !== where.id || orderRow.state !== where.state) return { count: 0 };
        Object.assign(orderRow, data);
        return { count: 1 };
      }),
    },
    orderItem: { findMany: jest.fn().mockResolvedValue(items.map(({ id }) => ({ id }))) },
    hardwareUnit: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    orderStateTransition: { create: jest.fn().mockResolvedValue({}) },
    warranty: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'w1', claims: [], ...data };
        warranties.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = warranties.find((w) => w['id'] === where.id);
        return row ? { ...row, order: { ...orderRow } } : null;
      }),
      findMany: jest.fn(async () => warranties.map((w) => ({ ...w, order: { ...orderRow, completedAt: new Date() }, claims: claims.filter((c) => c['warrantyId'] === w['id']) }))),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = warranties.find((w) => w['id'] === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
    warrantyClaim: {
      findUnique: jest.fn(async ({ where, include }: { where?: { id: string }; include?: Record<string, object> } = {}) => {
        const row = claims.find((c) => c['id'] === where?.id);
        if (!row) return null;
        const result: Record<string, unknown> = { ...row };
        if (include?.['warranty']) {
          const warranty = warranties.find((w) => w['id'] === row['warrantyId']);
          result['warranty'] = {
            ...warranty,
            order: { ...orderRow },
          };
        }
        return result;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `claim-${claims.length + 1}`, ...data };
        claims.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = claims.find((c) => c['id'] === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      count: jest.fn(async ({ where }: { where?: { status?: { in?: string[] }; warrantyId?: string } } = {}) =>
        claims.filter((c) => {
          if (where?.warrantyId && c['warrantyId'] !== where.warrantyId) return false;
          if (where?.status?.in && !where.status.in.includes(c['status'] as string)) return false;
          return true;
        }).length,
      ),
      findMany: jest.fn().mockResolvedValue([]),
    },
    technicianProfile: {
      findUnique: jest.fn(async () => ({ ...technicianRow })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const completedJobs = (data['completedJobs'] as { increment?: number } | undefined)?.increment;
        if (completedJobs) technicianRow.completedJobs += completedJobs;
        if (typeof data['warrantyClaimRate'] === 'number') {
          technicianRow.warrantyClaimRate = data['warrantyClaimRate'];
        }
        if (typeof data['rating'] === 'number') technicianRow.rating = data['rating'];
        if (data['ratingCount']) technicianRow.ratingCount += 1;
        return { ...technicianRow };
      }),
    },
    customerProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'cp1', userId: 'c1' }) },
    review: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  } as unknown as PrismaService;

  const walletEscrowService = {
    releaseEscrowAndSplit: jest.fn().mockResolvedValue({
      platformCommission: 100_000n,
      warrantyReserve: 50_000n,
      technicianPayout: 850_000n,
      commissionRate: 0.1,
      reserveRate: 0.05,
    }),
    holdEscrow: jest.fn(),
    refundEscrow: jest.fn(),
  } as unknown as WalletEscrowService;
  const notificationsService = { send: jest.fn().mockResolvedValue({}) } as unknown as NotificationsService;
  const realtimeService = { emitToOrder: jest.fn(), emitToUser: jest.fn() } as unknown as RealtimeService;
  const config = { isProduction: false, otpDevEcho: true } as unknown as AppConfigService;
  const redis = {
    rateLimit: jest.fn().mockResolvedValue({ allowed: true, remaining: 0, retryAfterMs: 60_000 }),
  } as unknown as import('@infra/redis/redis.service').RedisService;

  const service = new WarrantyService(
    prisma,
    walletEscrowService,
    notificationsService,
    realtimeService,
    config,
    redis,
  );
  return {
    service,
    prisma,
    walletEscrowService,
    notificationsService,
    realtimeService,
    redis,
    warranties,
    claims,
    technicianRow,
    orderRow,
    items,
  };
}

describe('WarrantyService — handover gate (Invariant 9)', () => {
  it('rejects handover when a FULL_PACKAGE item has NO registered serials', async () => {
    const { service } = buildService({ withSerials: false });
    await expect(
      service.requestHandover(technician, 'o1', { defaultPasswordsChanged: true, technicianAccessRevoked: true }),
    ).rejects.toThrow(/شماره سریال/);
  });

  it('INSTALL_ONLY items do NOT require serials (customer\'s own hardware)', async () => {
    const { service, orderRow } = buildService({ withSerials: false, supplyMode: 'INSTALL_ONLY' });
    const result = await service.requestHandover(technician, 'o1', {
      defaultPasswordsChanged: true,
      technicianAccessRevoked: true,
    });
    expect(result.state).toBe('HANDOVER_OTP_PENDING');
    void orderRow;
  });

  it('rejects an unchecked privacy checklist with the mandatory Persian 400', async () => {
    const { service } = buildService({ withSerials: true });
    await expect(
      service.requestHandover(technician, 'o1', { defaultPasswordsChanged: true, technicianAccessRevoked: false }),
    ).rejects.toThrow(/تأیید تغییر رمزهای پیش‌فرض/);
    await expect(
      service.requestHandover(technician, 'o1', { defaultPasswordsChanged: false, technicianAccessRevoked: true }),
    ).rejects.toThrow(BadRequestException);
  });

  it('success stores a hashed OTP, resets attempts, transitions state and SMSes the customer', async () => {
    const { service, notificationsService, orderRow } = buildService({ withSerials: true });
    const result = await service.requestHandover(technician, 'o1', {
      defaultPasswordsChanged: true,
      technicianAccessRevoked: true,
    });

    expect(result.state).toBe('HANDOVER_OTP_PENDING');
    expect(result.devHandoverOtp).toMatch(/^\d{6}$/); // OTP_DEV_ECHO in non-production
    expect(orderRow.handoverOtpHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(orderRow.handoverAttempts).toBe(0);
    expect(orderRow.privacyChecklistSignedAt).toBeInstanceOf(Date);
    expect(orderRow.state).toBe('HANDOVER_OTP_PENDING');
    expect(notificationsService.send).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'c1', type: 'HANDOVER_OTP', channel: 'SMS' }),
    );
  });
});

describe('WarrantyService — complete handover (atomic warranty + escrow)', () => {
  async function requestFirst(service: WarrantyService) {
    return service.requestHandover(technician, 'o1', {
      defaultPasswordsChanged: true,
      technicianAccessRevoked: true,
    });
  }

  it('wrong OTP ×3 locks the handover with the Persian support message', async () => {
    const { service, orderRow } = buildService({ withSerials: true });
    const { devHandoverOtp } = await requestFirst(service);
    const wrongOtp = devHandoverOtp === '000000' ? '111111' : '000000';

    await expect(service.completeHandover(technician, 'o1', { otp: wrongOtp })).rejects.toThrow(/نادرست/);
    await expect(service.completeHandover(technician, 'o1', { otp: wrongOtp })).rejects.toThrow(/نادرست/);
    await expect(service.completeHandover(technician, 'o1', { otp: wrongOtp })).rejects.toThrow(/سقف مجاز/);
    expect(orderRow.handoverAttempts).toBe(3);
  });

  it('valid OTP → ATOMIC completion: warranty WR-…, escrow split (10% showroom override), completedJobs++', async () => {
    const {
      service,
      walletEscrowService,
      notificationsService,
      realtimeService,
      warranties,
      technicianRow,
      orderRow,
      prisma,
    } = buildService({ withSerials: true });
    const { devHandoverOtp } = await requestFirst(service);

    const result = await service.completeHandover(technician, 'o1', { otp: devHandoverOtp as string });

    expect(result.state).toBe('COMPLETED_WARRANTY_ACTIVE');
    // Escrow released with the order's branch (10% showroom commission + 5% reserve).
    expect(walletEscrowService.releaseEscrowAndSplit).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'o1',
        customerUserId: 'c1',
        technicianUserId: 't1',
        branchId: 'b1',
        totalAmount: 2_000_000n,
        idempotencyKey: 'escrow:release:o1',
      }),
      expect.anything(),
    );
    // Digital warranty with per-item coverage (min warrantyMonths = 12).
    expect(result.warranty.policyNumber).toMatch(/^WR-\d{4}-\d{6}$/);
    expect(result.warranty.coverageMonths).toBe(12);
    expect(result.warranty.warrantyReserveAmount).toBe(50_000n);
    expect(result.warranty.status).toBe('ACTIVE');
    expect(warranties).toHaveLength(1);
    // Optimistic terminal transition + audit metadata.
    expect(prisma.serviceOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', state: 'HANDOVER_OTP_PENDING' },
      data: expect.objectContaining({ state: 'COMPLETED_WARRANTY_ACTIVE', completedAt: expect.any(Date) }),
    });
    expect(prisma.orderStateTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromState: 'HANDOVER_OTP_PENDING',
        toState: 'COMPLETED_WARRANTY_ACTIVE',
        metadata: { otpVerified: true, privacyChecklistSigned: true },
      }),
    });
    expect(technicianRow.completedJobs).toBe(1);
    expect(orderRow.completedAt).toBeInstanceOf(Date);
    expect(notificationsService.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'WARRANTY_ACTIVATED', userId: 'c1' }),
    );
    expect(realtimeService.emitToOrder).toHaveBeenCalledWith(
      'o1',
      'WARRANTY_ACTIVATED',
      expect.objectContaining({ orderId: 'o1' }),
    );
  });

  it('expired OTP is rejected', async () => {
    const { service, orderRow } = buildService({ withSerials: true });
    const { devHandoverOtp } = await requestFirst(service);
    orderRow.handoverOtpExpiresAt = new Date(Date.now() - 1000);
    await expect(service.completeHandover(technician, 'o1', { otp: devHandoverOtp as string })).rejects.toThrow(
      /منقضی/,
    );
  });

  it('expired-OTP recovery: resend issues a FRESH code without deadlocking the order (Part A fix #3)', async () => {
    const { service, orderRow, notificationsService } = buildService({ withSerials: true });
    const expired = await requestFirst(service);
    orderRow.handoverOtpExpiresAt = new Date(Date.now() - 1000);
    await expect(service.completeHandover(technician, 'o1', { otp: expired.devHandoverOtp as string })).rejects.toThrow(
      /منقضی/,
    );

    const resend = await service.resendHandoverOtp(technician, 'o1');
    expect(resend).toMatchObject({ orderId: 'o1', resent: true });
    expect(resend.devHandoverOtp).toMatch(/^\d{6}$/);
    expect(resend.devHandoverOtp).not.toBe(expired.devHandoverOtp);
    expect(orderRow.handoverOtpExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(notificationsService.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'HANDOVER_OTP', channel: 'SMS', userId: 'c1', titleFa: 'کد جدید تحویل سفارش' }),
    );

    // The fresh code completes the handover — no deadlock.
    const result = await service.completeHandover(technician, 'o1', { otp: resend.devHandoverOtp as string });
    expect(result.state).toBe('COMPLETED_WARRANTY_ACTIVE');
  });

  it('resend is rate-limited to 1/minute with a Persian 429', async () => {
    const { service, redis } = buildService({ withSerials: true });
    await service.requestHandover(technician, 'o1', {
      defaultPasswordsChanged: true,
      technicianAccessRevoked: true,
    });
    await service.resendHandoverOtp(technician, 'o1');
    (redis.rateLimit as jest.Mock).mockResolvedValue({ allowed: false, remaining: 0, retryAfterMs: 45_000 });

    await expect(service.resendHandoverOtp(technician, 'o1')).rejects.toThrow(/بیش از حد مجاز/);
  });
});

describe('WarrantyService — claims & technician claim-rate feedback loop', () => {
  it('customer claim → IN_CLAIM; admin approval recomputes warrantyClaimRate and restores ACTIVE', async () => {
    const { service, orderRow, claims, warranties, technicianRow } = buildService({ withSerials: true });
    await service.requestHandover(technician, 'o1', {
      defaultPasswordsChanged: true,
      technicianAccessRevoked: true,
    });
    // Force a KNOWN OTP for deterministic completion.
    const { scryptSync, randomBytes } = await import('node:crypto');
    const otp = '123456';
    const salt = randomBytes(16).toString('hex');
    orderRow.handoverOtpHash = `${salt}:${scryptSync(otp, salt, 32).toString('hex')}`;
    orderRow.handoverOtpExpiresAt = new Date(Date.now() + 600_000);
    orderRow.handoverAttempts = 0;
    orderRow.state = 'HANDOVER_OTP_PENDING';

    const result = await service.completeHandover(technician, 'o1', { otp });
    expect(result.state).toBe('COMPLETED_WARRANTY_ACTIVE');
    expect(technicianRow.completedJobs).toBe(1);

    const claim = await service.createClaim(customer, 'w1', { descriptionFa: 'سنسور درب کار نمی‌کند.' });
    expect(claims[0]).toMatchObject({ status: 'OPEN', warrantyId: 'w1' });
    expect(claim.warrantyStatus).toBe('IN_CLAIM');

    const updated = await service.updateClaim(branchAdmin, 'claim-1', {
      status: 'APPROVED',
      resolutionNoteFa: 'تعویض سنسور تحت گارانتی.',
    });
    expect(updated.warrantyStatus).toBe('ACTIVE');
    // 1 approved claim / 1 completed job = 1.0 claim rate — feeds dispatch scoring.
    expect(technicianRow.warrantyClaimRate).toBe(1);
    expect((warranties[0] as Record<string, unknown>)['status']).toBe('ACTIVE');
  });

  it('BRANCH_ADMIN of another branch cannot touch the claim (404, no leak)', async () => {
    const { service } = buildService({ withSerials: true });
    await expect(
      service.updateClaim({ ...branchAdmin, branchId: 'b-other' }, 'claim-404', {
        status: 'REJECTED',
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
