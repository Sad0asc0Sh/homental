import { BadRequestException, GoneException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import type { PrismaService } from '@infra/prisma/prisma.service';
import { computeServicePackage, MANAGED_PRICING_VERSION, toSliderView } from '../pricing/managed-pricing';
import type { PricingService } from '../pricing/pricing.service';
import { jsonSnapshot } from './managed-order-economics';
import { OrdersService } from './orders.service';

const customer = { id: 'c1', phone: '+989120000020', role: UserRole.CUSTOMER, branchId: null } as AuthenticatedUser;
const technician = { id: 't1', phone: '+989120000010', role: UserRole.TECHNICIAN, branchId: 'b1' } as AuthenticatedUser;
const branchAdmin = { id: 'a1', phone: '+989120000002', role: UserRole.BRANCH_ADMIN, branchId: 'b1' } as AuthenticatedUser;
const otherBranchAdmin = { id: 'a2', phone: '+989120000003', role: UserRole.BRANCH_ADMIN, branchId: 'b2' } as AuthenticatedUser;
const superAdmin = { id: 'sa1', phone: '+989120000001', role: UserRole.SUPER_ADMIN, branchId: null } as AuthenticatedUser;

const servicePackage = computeServicePackage(400_000n, 0n, 100_000n, 1000n, 0n);
const amount = servicePackage.price;
const packageLine = {
  lineKey: 'service-package', titleFa: 'بسته اجرا', qty: 1, unit: 'EACH' as const,
  unitPrice: amount, lineTotal: amount,
};
const cannedEstimate = {
  customerView: {
    currency: 'TOMAN', estimatedMin: amount, estimatedMax: amount, netEstimated: amount,
    slider: toSliderView(servicePackage, 500),
    invoice: {
      total: amount,
      buckets: [{ bucket: 'SERVICE_PACKAGE', titleFa: packageLine.titleFa, subtotal: amount, lines: [packageLine] }],
    },
    summary: { totalHardware: 0n, bundleDiscountPercent: 0 },
    factors: {
      surge: { multiplier: 1, reasonFa: 'تعرفه عادی' },
      urgency: { urgency: 'SCHEDULED', multiplier: 1 },
    },
  },
  materials: [], labor: [],
  tasks: [{ serviceKey: 'ALARM', titleFa: 'دزدگیر اماکن', supplyMode: 'INSTALL_ONLY', rateCardId: 'rate1', rateCardVersion: 1 }],
  internalSplit: { servicePackage, shipments: [], meteredLabor: 0n, total: amount },
  bundleBps: 0, policyVersion: 'test-v1', packageLine,
} satisfies Awaited<ReturnType<PricingService['estimateManaged']>>;

type OrderRow = Record<string, unknown> & { id: string; state: string };

function buildService(orderFixture?: OrderRow) {
  let currentOrder: OrderRow | null =
    orderFixture ?? null;

  const prisma = {
    customerProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'cp1', userId: customer.id }) },
    address: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'addr1',
        customerId: 'cp1',
        cityId: 'city1',
        locationType: 'APARTMENT',
        lat: 36.3,
        lng: 59.6,
        city: { slug: 'mashhad' },
      }),
    },
    securityProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    branch: { findFirst: jest.fn().mockResolvedValue({ id: 'b1', isActive: true }), findUnique: jest.fn() },
    serviceDefinition: {
      findMany: jest.fn().mockResolvedValue([{ id: 'def-alarm', key: 'ALARM' }]),
    },
    serviceOrder: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> & { state: string } }) => {
        currentOrder = { id: 'o1', items: [], priceRevisions: [], ...data };
        return currentOrder;
      }),
      findUniqueOrThrow: jest.fn(async () => currentOrder),
      findUnique: jest.fn(async (_args?: { where: { id: string } }) =>
        currentOrder ? { ...currentOrder } : null,
      ),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; state: string }; data: Record<string, unknown> }) => {
        if (!currentOrder || currentOrder.id !== where.id || currentOrder.state !== where.state) {
          return { count: 0 };
        }
        currentOrder = { ...currentOrder, ...data, state: (data['state'] as string) ?? currentOrder.state };
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        currentOrder = { ...(currentOrder as OrderRow), ...data };
        return currentOrder;
      }),
    },
    orderItem: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: 'item1' })) },
    orderPriceRevision: {
      create: jest.fn().mockResolvedValue({ id: 'rev1' }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'rev1', status: 'DRAFT', pricingVersion: MANAGED_PRICING_VERSION, sliderBps: 0,
        internalSplitJson: jsonSnapshot({ ...cannedEstimate.internalSplit, offerVersions: {} }),
        addons: [{ ...packageLine, sellerOfferId: null }],
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    orderAddon: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    escrowPosition: { create: jest.fn().mockResolvedValue({}), findUnique: jest.fn() },
    dispatchOffer: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    orderStateTransition: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      createMany: jest.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => ({ count: data.length })),
    },
    technicianProfile: {
      findUnique: jest.fn().mockResolvedValue({ userId: 't1', status: 'APPROVED', branchId: 'b1' }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  } as unknown as PrismaService;

  const pricingService = { estimateManaged: jest.fn().mockResolvedValue(cannedEstimate) };
  const walletEscrowService = {
    holdEscrow: jest.fn().mockResolvedValue({ walletId: 'wallet1' }),
    refundEscrow: jest.fn().mockResolvedValue({}),
  };
  const notificationsService = { send: jest.fn().mockResolvedValue({}) };

  const service = new OrdersService(
    prisma,
    pricingService as unknown as PricingService,
    walletEscrowService as unknown as import('@modules/wallet-escrow/wallet-escrow.service').WalletEscrowService,
    notificationsService as unknown as import('@modules/notifications/notifications.service').NotificationsService,
    new EventEmitter2(),
  );
  return { service, prisma, pricingService, walletEscrowService, notificationsService, setCurrentOrder: (o: OrderRow | null) => { currentOrder = o; } };
}

function orderFixture(state: string, overrides: Record<string, unknown> = {}): OrderRow {
  return {
    id: 'o1',
    orderNumber: 'HM-2026-000001',
    customerId: customer.id,
    technicianId: null,
    branchId: 'b1',
    state,
    finalQuoteAmount: null,
    ...overrides,
  } as OrderRow;
}

describe('OrdersService — creation with pricing snapshot (ESTIMATED)', () => {
  it('persists pricing snapshot (BigInt-safe), per-item supplyMode, lat/lng and the DRAFT→ESTIMATED audit trail', async () => {
    const { service, prisma, pricingService } = buildService();

    const result = await service.create(customer, {
      addressId: 'addr1',
      urgency: 'SCHEDULED',
      supplyMode: 'FULL_PACKAGE',
      items: [{ serviceKey: 'ALARM', supplyMode: 'INSTALL_ONLY', config: { petImmune: true } }],
    });

    expect(result.order['orderNumber']).toMatch(/^HM-\d{4}-\d{6}$/);
    expect(pricingService.estimateManaged).toHaveBeenCalledWith(
      expect.objectContaining({
        citySlug: 'mashhad',
        lat: 36.3,
        lng: 59.6,
        urgency: 'SCHEDULED',
        supplyMode: 'FULL_PACKAGE',
      }),
      { cityId: 'city1', branchId: 'b1' },
    );

    const createData = (prisma.serviceOrder.create as jest.Mock).mock.calls[0][0].data;
    expect(createData['state']).toBe('ESTIMATED');
    expect(createData['locationType']).toBe('APARTMENT');
    expect(createData['lat']).toBe(36.3);
    expect(createData['branchId']).toBe('b1');
    expect(prisma.orderPriceRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'DRAFT',
        customerViewJson: expect.objectContaining({ netEstimated: amount.toString() }),
        technicianTermsJson: expect.objectContaining({ agreedPackageNet: servicePackage.technicianPackageNet.toString() }),
      }),
    });
    expect(prisma.orderAddon.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ revisionId: 'rev1', lineTotal: amount, bucket: 'SERVICE_PACKAGE' })],
    });
    expect(createData['surgeMultiplier']).toBe(1);
    expect(createData['bundleDiscountPercent']).toBe(0);

    const itemData = (prisma.orderItem.create as jest.Mock).mock.calls[0][0].data;
    expect(itemData).toMatchObject({
      serviceDefinitionId: 'def-alarm',
      supplyMode: 'INSTALL_ONLY',
      config: { petImmune: true },
    });

    const transitions = (prisma.orderStateTransition.createMany as jest.Mock).mock.calls[0][0].data;
    expect(transitions).toEqual([
      expect.objectContaining({ fromState: null, toState: 'DRAFT' }),
      expect.objectContaining({ fromState: 'DRAFT', toState: 'ESTIMATED' }),
    ]);
  });

  it('rejects an address the caller does not own', async () => {
    const { service, prisma } = buildService();
    (prisma.address.findUnique as jest.Mock).mockResolvedValue({
      id: 'addrX',
      customerId: 'someone-else',
      city: { slug: 'mashhad' },
      lat: 1,
      lng: 1,
      locationType: 'SHOP',
    });
    await expect(
      service.create(customer, { addressId: 'addrX', items: [{ serviceKey: 'ALARM' }] }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('OrdersService — role-scoped reads', () => {
  it('CUSTOMER sees only own orders', async () => {
    const { service, prisma } = buildService();
    await service.list(customer, { page: 1, limit: 10 });
    expect(prisma.serviceOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 'c1' } }),
    );
  });

  it('TECHNICIAN sees only assigned orders', async () => {
    const { service, prisma } = buildService();
    await service.list(technician, {});
    expect(prisma.serviceOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { technicianId: 't1' } }),
    );
  });

  it('unassigned BRANCH_ADMIN (branchId null) gets an empty list — never all branches', async () => {
    const { service, prisma } = buildService();
    const result = await service.list({ ...branchAdmin, branchId: null }, {});
    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    expect(prisma.serviceOrder.findMany).not.toHaveBeenCalled();
  });

  it('BRANCH_ADMIN of another branch cannot even see the order (404, no leak)', async () => {
    const { service } = buildService(orderFixture('ESTIMATED'));
    await expect(service.getOne(otherBranchAdmin, 'o1')).rejects.toThrow(NotFoundException);
  });

  it('SUPER_ADMIN sees everything', async () => {
    const { service, prisma } = buildService();
    await service.list(superAdmin, {});
    expect(prisma.serviceOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});

describe('OrdersService — order transitions', () => {
  it('funds the managed revision and records the hold when submitting before dispatch', async () => {
    const { service, prisma, notificationsService, walletEscrowService } = buildService(orderFixture('ESTIMATED', {
      pricingVersion: MANAGED_PRICING_VERSION, activeRevision: 1,
    }));
    await service.submit(customer, 'o1');
    expect(prisma.serviceOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', state: 'ESTIMATED' },
      data: { state: 'SEARCHING_EXPERT' },
    });
    expect(prisma.orderStateTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'o1',
        fromState: 'ESTIMATED',
        toState: 'SEARCHING_EXPERT',
        actorUserId: 'c1',
        actorRole: UserRole.CUSTOMER,
      }),
    });
    expect(walletEscrowService.holdEscrow).toHaveBeenCalledWith({
      customerUserId: 'c1', orderId: 'o1', amount, idempotencyKey: 'escrow:hold:o1',
    }, prisma);
    expect(prisma.escrowPosition.create).toHaveBeenCalledWith({
      data: { orderId: 'o1', payerWalletId: 'wallet1', heldAmount: amount, activeRevision: 1 },
    });
    expect(notificationsService.send).toHaveBeenCalledTimes(1);
  });

  it('assign-technician: verifies APPROVED technician of the order branch, sets technicianId, notifies both', async () => {
    const { service, prisma, notificationsService } = buildService(orderFixture('BRANCH_QUEUE'));
    (prisma.technicianProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 't1',
      status: 'APPROVED',
      branchId: 'b1',
    });

    const result = await service.assignTechnician(superAdmin, 'o1', { technicianUserId: 't1' });

    expect(result).toMatchObject({ state: 'EXPERT_ASSIGNED', technicianId: 't1' });
    expect(prisma.serviceOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', state: 'BRANCH_QUEUE' },
      data: { technicianId: 't1', state: 'EXPERT_ASSIGNED' },
    });
    expect(notificationsService.send).toHaveBeenCalledTimes(2);
  });

  it('assign-technician rejects a technician from ANOTHER branch', async () => {
    const { service, prisma } = buildService(orderFixture('BRANCH_QUEUE'));
    (prisma.technicianProfile.findUnique as jest.Mock).mockResolvedValue({
      userId: 'tX',
      status: 'APPROVED',
      branchId: 'b2',
    });
    await expect(
      service.assignTechnician(superAdmin, 'o1', { technicianUserId: 'tX' }),
    ).rejects.toThrow(/برای این شعبه/);
  });

  it('approve-quote holds escrow INSIDE the same transaction as the transition', async () => {
    const { service, prisma, walletEscrowService } = buildService(
      orderFixture('INSPECTING', { finalQuoteAmount: 2_000_000n }),
    );

    const result = await service.approveQuote(customer, 'o1');

    expect(result).toMatchObject({ state: 'QUOTE_APPROVED' });
    expect(walletEscrowService.holdEscrow).toHaveBeenCalledWith(
      {
        customerUserId: 'c1',
        orderId: 'o1',
        amount: 2_000_000n,
        idempotencyKey: 'escrow:hold:o1',
      },
      expect.anything(), // the transaction client
    );
    expect(prisma.serviceOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', state: 'INSPECTING' },
      data: { state: 'QUOTE_APPROVED' },
    });
  });

  it('approve-quote without a technician quote is rejected', async () => {
    const { service } = buildService(orderFixture('INSPECTING', { finalQuoteAmount: null }));
    await expect(service.approveQuote(customer, 'o1')).rejects.toThrow(BadRequestException);
  });

  it('continues a legacy search through approval of its existing quote to IN_PROGRESS', async () => {
    const { service } = buildService(orderFixture('SEARCHING_EXPERT', { finalQuoteAmount: 2_000_000n }));

    await service.branchQueue(branchAdmin, 'o1');
    const assigned = await service.assignTechnician(superAdmin, 'o1', { technicianUserId: 't1' });
    expect(assigned.state).toBe('EXPERT_ASSIGNED');
    await service.enRoute(technician, 'o1');
    await service.startInspection(technician, 'o1');
    await service.approveQuote(customer, 'o1');
    const final = await service.startWork(technician, 'o1');

    expect(final.state).toBe('IN_PROGRESS');
  });

  it('retires manual quoting', () => {
    const { service } = buildService();
    expect(() => service.quote()).toThrow(GoneException);
  });

  it('non-assigned technician cannot drive the order (404, no leak)', async () => {
    const { service } = buildService(orderFixture('EXPERT_ASSIGNED'));
    await expect(service.enRoute({ ...technician, id: 't-other' }, 'o1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('OrdersService — cancellation with escrow refund rules', () => {
  it('cancel from QUOTE_APPROVED atomically refunds the held escrow', async () => {
    const { service, prisma, walletEscrowService } = buildService(
      orderFixture('QUOTE_APPROVED', { finalQuoteAmount: 2_000_000n }),
    );

    const result = await service.cancel(customer, 'o1', { reason: 'تغییر برنامه' });

    expect(result).toMatchObject({ state: 'CANCELLED' });
    expect(walletEscrowService.refundEscrow).toHaveBeenCalledWith(
      {
        customerUserId: 'c1',
        orderId: 'o1',
        amount: 2_000_000n,
        idempotencyKey: 'escrow:refund:o1',
        reason: 'تغییر برنامه',
      },
      expect.anything(),
    );
    expect(prisma.serviceOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', state: 'QUOTE_APPROVED' },
      data: expect.objectContaining({
        state: 'CANCELLED',
        cancelReason: 'تغییر برنامه',
        cancelledByUserId: 'c1',
        cancelledAt: expect.any(Date),
      }),
    });
    expect(prisma.orderStateTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromState: 'QUOTE_APPROVED', toState: 'CANCELLED' }),
    });
  });

  it('cancel from ESTIMATED needs NO refund (escrow never held)', async () => {
    const { service, walletEscrowService } = buildService(orderFixture('ESTIMATED'));
    await service.cancel(customer, 'o1', {});
    expect(walletEscrowService.refundEscrow).not.toHaveBeenCalled();
  });

  it('cancel from IN_PROGRESS is rejected with 409 (work already started)', async () => {
    const { service, walletEscrowService } = buildService(orderFixture('IN_PROGRESS'));
    await expect(service.cancel(customer, 'o1', {})).rejects.toThrow(/مجاز نیست/);
    expect(walletEscrowService.refundEscrow).not.toHaveBeenCalled();
  });

  it('a non-owner customer cannot cancel someone else\'s order (404 — no leak)', async () => {
    const { service } = buildService(orderFixture('ESTIMATED', { customerId: 'someone-else' }));
    await expect(service.cancel(customer, 'o1', {})).rejects.toThrow(NotFoundException);
  });
});
