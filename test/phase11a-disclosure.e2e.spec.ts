import { ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { Prisma, UserRole, type OrderAddon, type OrderMeteredAdjustment, type OrderState } from '@prisma/client';
import { randomUUID, scryptSync } from 'node:crypto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { BigIntSerializerInterceptor } from '@common/interceptors/bigint-serializer.interceptor';
import type { AuthenticatedRequest, AuthenticatedUser } from '@common/types/authenticated-user';
import { AppConfigService } from '@config/app-config.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RealtimeEvent, RealtimeService, type RealtimeEventName } from '@infra/realtime/realtime.service';
import { RedisService } from '@infra/redis/redis.service';
import { AdminCitiesBranchesController } from '@modules/cities-branches/admin-cities-branches.controller';
import { CitiesBranchesService } from '@modules/cities-branches/cities-branches.service';
import { NotificationsService, type SendNotificationInput } from '@modules/notifications/notifications.service';
import { DispatchController } from '@modules/security-services/dispatch/dispatch.controller';
import { DispatchService } from '@modules/security-services/dispatch/dispatch.service';
import { OrdersController } from '@modules/security-services/orders/orders.controller';
import { OrdersService } from '@modules/security-services/orders/orders.service';
import { MANAGED_PRICING_VERSION } from '@modules/security-services/pricing/managed-pricing';
import { PricingService } from '@modules/security-services/pricing/pricing.service';
import { AdminWarrantyClaimsController } from '@modules/security-services/warranty/admin-warranty-claims.controller';
import { WarrantyController } from '@modules/security-services/warranty/warranty.controller';
import { WarrantyService } from '@modules/security-services/warranty/warranty.service';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';

const branchId = randomUUID();
const orderId = randomUUID();
const actor = (role: UserRole, actorBranchId: string | null = null): AuthenticatedUser => ({
  id: randomUUID(), role, branchId: actorBranchId, phone: '+989120000001',
});
const actors = {
  customer: actor('CUSTOMER'), technician: actor('TECHNICIAN', branchId), seller: actor('SELLER'),
  branch: actor('BRANCH_ADMIN', branchId), admin: actor('SUPER_ADMIN'),
};
type ActorName = keyof typeof actors;

const privateAmounts = {
  commission: '860000', commissionRate: 0.1, commissionBps: 1000, platformCommission: '860000', warrantyReserveAmount: '240000',
};
const privateFields = new Set([
  ...Object.keys(privateAmounts), 'internalSplitJson', 'commissionRateOverride', 'warrantyReserveOverride',
]);

function findPrivateFields(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((entry: unknown, index) => findPrivateFields(entry, `${path}[${index}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, entry]: [string, unknown]) => {
    const fieldPath = `${path}.${key}`;
    return privateFields.has(key) ? [fieldPath] : findPrivateFields(entry, fieldPath);
  });
}

const otp = '483275';
const salt = 'phase11a-test';
const otpHash = `${salt}:${scryptSync(otp, salt, 32).toString('hex')}`;
const agreedPackageNet = '3595000';
const guaranteeWithMeteredLabor = 3_645_000n;
const warrantyId = randomUUID();

function fixtures() {
  const now = new Date();
  const sellerId = randomUUID();
  const sellerOfferId = randomUUID();
  const fulfillmentId = randomUUID();
  const revisionId = randomUUID();
  const itemId = randomUUID();
  const addon = {
    id: randomUUID(), lineKey: 'CCTV:camera', revisionId, orderItemId: itemId, fulfillmentId, sellerOfferId,
    rateCardId: null, sku: 'CAM-01', titleFa: 'دوربین', unit: 'EACH', qty: 1, quantityCm: null,
    unitPrice: 1_000_000n, lineTotal: 1_000_000n, bucket: 'FIXED', kind: 'MATERIAL',
    sellerOffer: { sellerId },
  } satisfies OrderAddon & { sellerOffer: { sellerId: string } };
  const addons = [
    addon,
    { ...addon, id: randomUUID(), lineKey: 'service-package', titleFa: 'بسته اجرا', bucket: 'SERVICE_PACKAGE',
      kind: 'LABOR', unitPrice: 4_800_000n, lineTotal: 4_800_000n, sku: null, orderItemId: null,
      fulfillmentId: null, sellerOfferId: null, sellerOffer: null },
    { ...addon, id: randomUUID(), lineKey: 'CCTV:metered-labor', titleFa: 'اجرت متری', bucket: 'METERED',
      kind: 'LABOR', unit: 'METER', quantityCm: 100, unitPrice: 50_000n, lineTotal: 50_000n, sku: null, fulfillmentId: null,
      sellerOfferId: null, sellerOffer: null },
  ] satisfies (OrderAddon & { sellerOffer: { sellerId: string } | null })[];
  const revision = {
    id: revisionId, revision: 1, status: 'FUNDED', pricingVersion: MANAGED_PRICING_VERSION,
    customerViewJson: { slider: {
      sliderBps: 500, minDeltaBps: -1500, maxDeltaBps: 2500, priorityThresholdBps: 500,
      packageBaseAmount: '4800000', dispatchAudience: 'TOP', ...privateAmounts,
    }, invoice: { buckets: [
      { bucket: 'FIXED', titleFa: 'تجهیزات', ...privateAmounts },
      { bucket: 'SERVICE_PACKAGE', titleFa: 'بسته اجرا' },
      { bucket: 'METERED', titleFa: 'برآورد متری' },
    ] } },
    technicianTermsJson: { agreedPackageNet, meteredLabor: '50000', serialLineKeys: [addon.lineKey],
      tasks: [{ serviceKey: 'CCTV', details: [{ labelFa: 'تعداد دوربین', value: 1, ...privateAmounts }] }],
      ...privateAmounts },
    internalSplitJson: {
      servicePackage: { price: '4800000', technicianPackageNet: agreedPackageNet, ...privateAmounts,
        reserve: '240000', freight: '80000', allowance: '25000' },
      shipments: [{ sellerId, sellerUserId: actors.seller.id, deliveryMode: 'BIKE', freightCost: '80000',
        grossGoods: '1000000', ownAppFee: '20000', netReceivable: '980000' }],
      meteredLabor: '50000', total: '5850000', offerVersions: { [sellerOfferId]: 1 },
    },
    addons,
  };
  const branch = {
    id: branchId, adminId: actors.branch.id, nameFa: 'شعبه مشهد', code: 'MSHD-C1', phone: '05112345678',
    commissionRateOverride: new Prisma.Decimal('0.10'), warrantyReserveOverride: new Prisma.Decimal('0.05'),
  };
  const adjustment: OrderMeteredAdjustment = {
    id: randomUUID(), orderId, baseRevision: 1, resultingRevision: 1, status: 'APPROVED',
    submittedByUserId: actors.technician.id, deltaAmount: 0n, idempotencyKey: null, customerDecidedAt: now,
    readingsJson: [{ lineKey: 'CCTV:metered-labor', actualCm: 100, photoAssetId: 'photo-of-measurement', ...privateAmounts }],
    createdAt: now, updatedAt: now,
  };
  const order = {
    id: orderId, orderNumber: 'HM-2026-300001', state: 'HANDOVER_OTP_PENDING' as OrderState, activeRevision: 1,
    pricingVersion: MANAGED_PRICING_VERSION, branchId, customerId: actors.customer.id, technicianId: actors.technician.id,
    locationType: 'APARTMENT', urgency: 'SCHEDULED', supplyMode: 'FULL_PACKAGE',
    lat: new Prisma.Decimal('36.30'), lng: new Prisma.Decimal('59.61'),
    address: { titleFa: 'خانه', fullAddressFa: 'مشهد', city: { slug: 'mashhad' } },
    handoverOtpHash: otpHash, handoverOtpExpiresAt: new Date(now.getTime() + 600_000), handoverAttempts: 0,
    privacyChecklistSignedAt: now, finalQuoteAmount: 5_850_000n, pricing: { netEstimated: '5850000', ...privateAmounts },
    items: [{ id: itemId, supplyMode: 'FULL_PACKAGE', pricingSnapshot: privateAmounts,
      serviceDefinition: { key: 'CCTV', titleFa: 'دوربین مداربسته', warrantyMonths: 18 },
      hardwareUnits: [{ orderAddonId: addon.id, serialNumber: 'CAM-TEST-1234' }] }],
    priceRevisions: [revision], escrowPosition: { status: 'OPEN' }, meteredAdjustments: [adjustment],
    stateTransitions: [{ toState: 'HANDOVER_OTP_PENDING', metadata: privateAmounts }],
    transactions: [{ type: 'PLATFORM_COMMISSION', metadata: privateAmounts }],
  };
  const fulfillment = { id: fulfillmentId, sellerId, deliveryMode: 'BIKE', lines: [addon], order };
  const claim = { id: randomUUID(), status: 'OPEN', photos: privateAmounts };
  const warranty = {
    id: warrantyId, orderId, order, policyNumber: 'WR-2026-300001', status: 'ACTIVE',
    startDate: now, endDate: new Date(now.getTime() + 86_400_000), coverageMonths: 18,
    coverage: [{ serviceKey: 'CCTV', warrantyMonths: 18, serials: ['CAM-TEST-1234'], ...privateAmounts }],
    warrantyReserveAmount: 240_000n, claims: [claim],
  };
  const profile = {
    id: randomUUID(), userId: actors.technician.id, branchId, skills: ['CCTV'], rating: 4.9, ratingCount: 20,
    warrantyClaimRate: 0.01,
  };
  let savedWarranty: Prisma.WarrantyCreateArgs['data'] | undefined;
  const models = {
    $queryRaw: jest.fn(async () => [{ state: order.state }]),
    serviceOrder: {
      findUnique: jest.fn(async () => order), findMany: jest.fn(async () => [order]), count: jest.fn(async () => 1),
      updateMany: jest.fn(async ({ data }: { data: { state: OrderState } }) => {
        order.state = data.state;
        return { count: 1 };
      }),
    },
    orderStateTransition: { create: jest.fn() },
    supplyFulfillment: {
      findFirst: jest.fn(async () => fulfillment), findMany: jest.fn(async () => [fulfillment]),
      count: jest.fn(async () => 1),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    orderPriceRevision: { findUnique: jest.fn(async () => revision) },
    orderMeteredAdjustment: {
      findFirst: jest.fn(async ({ where }: { where: { status?: OrderMeteredAdjustment['status'] } }) =>
        !where.status || adjustment.status === where.status ? adjustment : null),
    },
    sellerOffer: { updateMany: jest.fn(async () => ({ count: 1 })) },
    warranty: {
      create: jest.fn(async ({ data }: { data: Prisma.WarrantyCreateArgs['data'] }) => {
        savedWarranty = data;
        return { ...warranty, ...data };
      }),
      findMany: jest.fn(async () => [warranty]), findUnique: jest.fn(async () => ({ ...warranty, ...savedWarranty })),
    },
    warrantyClaim: { findMany: jest.fn(async () => [{ ...claim, warranty }]) },
    walletTransaction: { findFirst: jest.fn(async () => ({ amount: guaranteeWithMeteredLabor, metadata: privateAmounts })) },
    customerProfile: { findUnique: jest.fn(async () => ({ userId: actors.customer.id })) },
    branch: {
      findMany: jest.fn(async () => [branch]), findUnique: jest.fn(async () => branch),
      update: jest.fn(async ({ data }: { data: Prisma.BranchUpdateArgs['data'] }) => ({ ...branch, phone: data.phone })),
    },
    platformConfig: { findUnique: jest.fn(async () => null) },
    technicianProfile: {
      findMany: jest.fn(async () => [profile]), findUnique: jest.fn(async () => profile),
      findFirst: jest.fn(async () => profile), update: jest.fn(),
    },
    dispatchOffer: {
      findFirst: jest.fn(async () => null), findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn(async () => 0), updateMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async ({ data }: { data: Prisma.DispatchOfferCreateArgs['data'] }) => ({
        id: randomUUID(), isBranchInvite: false, ...data, order, ...privateAmounts,
      })),
    },
  };
  const prisma = { ...models, $transaction: <T>(callback: (db: typeof models) => Promise<T>) => callback(models) };
  const split = { technicianPayout: guaranteeWithMeteredLabor, warrantyReserve: 240_000n, ...privateAmounts };
  return {
    models, order, prisma, adjustment,
    realtime: { emitToUser: jest.fn<void, [string, RealtimeEventName, Record<string, unknown>]>(), emitToOrder: jest.fn() },
    notifications: { send: jest.fn<Promise<void>, [SendNotificationInput]>().mockResolvedValue(undefined) },
    redis: {
      findNearbyTechs: jest.fn(async () => [{ techId: profile.id, distanceMeters: 500 }]),
      orderLockKey: jest.fn(() => `dispatch:order:lock:${orderId}`),
    },
    wallet: { settleManagedOrder: jest.fn(async () => split), releaseEscrowAndSplit: jest.fn(async () => split) },
  };
}

describe('Managed economics disclosure over HTTP and realtime', () => {
  let app: INestApplication;
  let baseUrl: string;
  let data: ReturnType<typeof fixtures>;

  beforeEach(async () => {
    data = fixtures();
    const module = await Test.createTestingModule({
      controllers: [OrdersController, WarrantyController, DispatchController,
        AdminCitiesBranchesController, AdminWarrantyClaimsController],
      providers: [OrdersService, WarrantyService, DispatchService, CitiesBranchesService, EventEmitter2,
        { provide: PrismaService, useValue: data.prisma },
        { provide: RedisService, useValue: data.redis },
        { provide: RealtimeService, useValue: data.realtime },
        { provide: NotificationsService, useValue: data.notifications },
        { provide: WalletEscrowService, useValue: data.wallet },
        { provide: PricingService, useValue: {} },
        { provide: AppConfigService, useValue: {} },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        request.user = Object.entries(actors).find(([name]) => name === request.get('x-test-actor'))?.[1];
        return request.user !== undefined;
      },
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new BigIntSerializerInterceptor());
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterEach(async () => { await app?.close(); });

  async function request(as: ActorName, path: string, method = 'GET', body?: object): Promise<unknown> {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method, headers: { 'x-test-actor': as, 'content-type': 'application/json', connection: 'close' },
      body: body && JSON.stringify(body),
    });
    const payload: unknown = await response.json();
    expect({ status: response.status, payload }).toEqual({ status: method === 'POST' ? 201 : 200, payload });
    return payload;
  }

  it.each([
    ['customer', { id: orderId, invoice: { total: '5850000' }, escrowStatus: 'OPEN', slider: { sliderBps: 500 } }],
    ['technician', { id: orderId, agreedPackageNet, estimatedNet: '3645000' }],
    ['branch', { id: orderId, branchId }],
  ] as const)('keeps the %s order detail and list clear of internal economics', async (role, view) => {
    const detail = await request(role, `/orders/${orderId}`);
    const list = await request(role, '/orders');
    expect(detail).toMatchObject(view);
    expect(list).toMatchObject({ items: [view], total: 1 });
    expect(findPrivateFields([detail, list])).toEqual([]);
  });

  it('shows pending metered photo references without private fields and keeps evidence out of branch views', async () => {
    Object.assign(data.adjustment, { status: 'PENDING_APPROVAL', resultingRevision: null, deltaAmount: 25_000n,
      readingsJson: [{ lineKey: 'CCTV:metered-labor', actualCm: 150, photoAssetId: 'photo-of-measurement', ...privateAmounts }] });
    const path = `/orders/${orderId}`;
    const [customer, technician, branch] = await Promise.all([
      request('customer', path), request('technician', path), request('branch', path),
    ]);
    const evidence = {
      status: 'PENDING_APPROVAL', readings: [{
        lineKey: 'CCTV:metered-labor', titleFa: 'اجرت متری', estimatedCm: 100, actualCm: 150, photoAssetId: 'photo-of-measurement',
      }],
    };
    expect(customer).toMatchObject({ pendingAdjustment: { ...evidence, deltaAmount: '25000' } });
    expect(technician).toMatchObject({ pendingAdjustment: evidence });
    expect(technician).not.toHaveProperty('pendingAdjustment.deltaAmount');
    expect(branch).not.toHaveProperty('pendingAdjustment');
    expect(findPrivateFields([customer, technician, branch])).toEqual([]);
  });

  it('returns only the seller’s own line prices, fee, proceeds and settlement status', async () => {
    const detail = await request('seller', `/orders/${orderId}`);
    const list = await request('seller', '/orders');
    expect(detail).toEqual({
      fulfillmentId: expect.any(String), deliveryMode: 'BIKE',
      lines: [{ sku: 'CAM-01', titleFa: 'دوربین', unit: 'EACH', qty: 1, partnerUnitPrice: '1000000', lineTotal: '1000000' }],
      grossGoods: '1000000', ownAppFee: '20000', netReceivable: '980000', settlementStatus: 'OPEN',
    });
    expect(list).toMatchObject({ items: [detail], total: 1 });
    expect(findPrivateFields([detail, list])).toEqual([]);
    expect(data.models.supplyFulfillment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { orderId, seller: { userId: actors.seller.id } },
    }));
  });

  it('keeps managed settlement details available to the super-admin response', async () => {
    const admin = await request('admin', `/orders/${orderId}`);
    expect(admin).toMatchObject({ internalSplitJson: { servicePackage: privateAmounts } });
  });

  it.each(['managed', 'legacy'])('keeps %s complete-handover and its replay free of internal economics', async (version) => {
    if (version === 'legacy') data.order.pricingVersion = 1;
    const path = `/orders/${orderId}/complete-handover`;
    const completion = await request('technician', path, 'POST', { otp });
    expect(completion).toEqual({
      orderId, state: 'COMPLETED_WARRANTY_ACTIVE', warrantyPolicyNumber: expect.stringMatching(/^WR-/),
      coverageMonths: 18, guaranteedNetPayout: '3645000',
    });
    const replay = await request('technician', path, 'POST', { otp });
    expect(replay).toEqual(completion);
    expect(findPrivateFields([completion, replay])).toEqual([]);
    const settle = version === 'legacy' ? data.wallet.releaseEscrowAndSplit : data.wallet.settleManagedOrder;
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it('serves warranty cards without reserve data in warranty rows, coverage, nested orders or claims', async () => {
    const warranties = await request('customer', '/warranties/me');
    expect(warranties).toMatchObject([{
      id: warrantyId, coverageMonths: 18, coverage: [{ serviceKey: 'CCTV', serials: ['CAM-TEST-1234'] }],
      order: { id: orderId }, claims: [{ status: 'OPEN' }],
    }]);
    expect(findPrivateFields(warranties)).toEqual([]);
  });

  it.each([false, true])('allows only offer data for realtime, persisted notification and polling (branch invite %s)', async (invite) => {
    data.order.state = invite ? 'BRANCH_QUEUE' : 'SEARCHING_EXPERT';
    if (invite) {
      const receipt = await request('branch', `/orders/${orderId}/invite-technician`, 'POST', {
        technicianUserId: actors.technician.id,
      });
      expect(receipt).toEqual({ orderId, offerId: expect.any(String), expiresAt: expect.any(String) });
      expect(findPrivateFields(receipt)).toEqual([]);
    } else {
      expect(await app.get(DispatchService).startSearch(orderId)).toMatchObject({ offersCreated: 1 });
    }
    const offer = await data.models.dispatchOffer.create.mock.results[0]?.value;
    expect(offer).toBeDefined();
    data.models.dispatchOffer.findMany.mockResolvedValueOnce([offer]);
    const list = await request('technician', '/dispatch/offers');
    const view = { orderId, offerId: offer?.id, guaranteedPackageNet: agreedPackageNet, isBranchInvite: invite };
    expect(list).toMatchObject([view]);
    expect(data.realtime.emitToUser).toHaveBeenCalledTimes(1);
    expect(data.realtime.emitToUser).toHaveBeenCalledWith(
      actors.technician.id, RealtimeEvent.DISPATCH_OFFER, expect.objectContaining(view),
    );
    expect(data.notifications.send).toHaveBeenCalledWith(expect.objectContaining({
      userId: actors.technician.id, type: 'DISPATCH_OFFER', data: expect.objectContaining(view),
    }));
    expect(findPrivateFields([list, data.realtime.emitToUser.mock.calls, data.notifications.send.mock.calls])).toEqual([]);
  });

  it('keeps branch lists, branch updates and branch warranty claims clear of private financial fields', async () => {
    const branches = await request('branch', '/admin/branches');
    const updated = await request('branch', `/admin/branches/${branchId}`, 'PATCH', { phone: '05187654321' });
    const claims = await request('branch', '/admin/warranty-claims');
    expect(branches).toMatchObject([{ id: branchId, code: 'MSHD-C1' }]);
    expect(updated).toMatchObject({ id: branchId, phone: '05187654321' });
    expect(claims).toMatchObject([{ warranty: { id: warrantyId, order: { id: orderId, branchId } } }]);
    expect(findPrivateFields([branches, updated, claims])).toEqual([]);
    expect(await request('admin', '/admin/branches')).toMatchObject([
      { id: branchId, commissionRateOverride: 0.1, warrantyReserveOverride: 0.05 },
    ]);
  });
});
