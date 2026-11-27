import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { OrderAddon, OrderState, User } from '@prisma/client';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import type { AuthenticatedRequest, AuthenticatedUser } from '@common/types/authenticated-user';
import { AppConfigService } from '@config/app-config.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RealtimeService } from '@infra/realtime/realtime.service';
import { RedisService } from '@infra/redis/redis.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { DispatchService } from '@modules/security-services/dispatch/dispatch.service';
import { MeteredAdjustmentsController } from '@modules/security-services/orders/metered-adjustments.controller';
import { MeteredAdjustmentsService } from '@modules/security-services/orders/metered-adjustments.service';
import { OrdersService } from '@modules/security-services/orders/orders.service';
import { DynamicFactorsService } from '@modules/security-services/pricing/dynamic-factors.service';
import { PricingSchemaInterpreter } from '@modules/security-services/pricing/pricing-schema.interpreter';
import { PricingService } from '@modules/security-services/pricing/pricing.service';
import { JsonLogicEvaluator } from '@modules/security-services/shared/json-logic.evaluator';
import { WarrantyService } from '@modules/security-services/warranty/warranty.service';
import { PLATFORM_WALLET_OWNER_ID } from '@modules/wallet-escrow/wallet-escrow.constants';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';

// Use a disposable, unseeded PostgreSQL/PostGIS database prepared with `prisma migrate deploy`.
const databaseUrl = process.env['PHASE11A_TEST_DATABASE_URL'];
const describePostgres = databaseUrl ? describe : describe.skip;
const openingBalance = 20_000_000n;
const cameraPrice = 1_000_009n;
const recorderPrice = 2_000_021n;
const cablePrice = 12_303n;
const policyKey = 'pricing.managed';

function actor(user: User, branchId: string | null = null): AuthenticatedUser {
  return { id: user.id, role: user.role, phone: user.phone, branchId };
}

async function createFixtures(prisma: PrismaService) {
  return prisma.$transaction(async (db) => {
    const token = randomUUID();
    const coordinates = { lat: 36.2972, lng: 59.6067 };
    const city = await db.city.create({
      data: { slug: token, nameEn: 'Mashhad test', nameFa: 'مشهد', centerLat: coordinates.lat, centerLng: coordinates.lng },
    });
    const branch = await db.branch.create({
      data: { code: token, cityId: city.id, nameFa: 'شعبه تست', addressFa: 'نشانی تست', commissionRateOverride: 0.1, ...coordinates },
    });
    const admin = await db.user.create({ data: { phone: `${token}-admin`, role: 'BRANCH_ADMIN', status: 'ACTIVE' } });
    const customer = await db.user.create({ data: { phone: `${token}-customer`, role: 'CUSTOMER', status: 'ACTIVE' } });
    const profile = await db.customerProfile.create({ data: { userId: customer.id } });
    const address = await db.address.create({
      data: { cityId: city.id, customerId: profile.id, locationType: 'SHOP', titleFa: 'فروشگاه', fullAddressFa: 'نشانی تست', ...coordinates },
    });
    const technician = async (index: number) => {
      const user = await db.user.create({ data: { phone: `${token}-tech-${index}`, role: 'TECHNICIAN', status: 'ACTIVE' } });
      const technicianProfile = await db.technicianProfile.create({
        data: { userId: user.id, branchId: branch.id, status: 'APPROVED', skills: ['CCTV'], isOnline: true },
      });
      const wallet = await db.wallet.create({ data: { ownerId: user.id, ownerType: 'TECHNICIAN' } });
      return { actor: actor(user, branch.id), profile: technicianProfile, wallet };
    };
    const seller = async (index: number, partnerPrice: bigint, fee: bigint, weightGrams: number) => {
      const user = await db.user.create({ data: { phone: `${token}-seller-${index}`, role: 'SELLER', status: 'ACTIVE' } });
      const sellerProfile = await db.sellerProfile.create({
        data: {
          userId: user.id, cityId: city.id, branchId: branch.id, status: 'APPROVED',
          shopNameFa: 'تأمین‌کننده تست', addressFa: 'نشانی تست', sellerAppFeeFlat: fee, ...coordinates,
        },
      });
      const product = await db.product.create({
        data: { sku: `${token}-${index}`, serviceKey: 'CCTV', titleFa: `تجهیز ${index}`, weightGrams },
      });
      // Reserve this offer first so a later last-stock conflict has a write to roll back.
      const offer = await db.sellerOffer.create({
        data: { id: `${token.slice(0, -1)}${index}`, sellerId: sellerProfile.id, productId: product.id, sellerSku: product.sku, partnerPrice, onHandQty: 2 },
      });
      const wallet = await db.wallet.create({ data: { ownerId: user.id, ownerType: 'SELLER' } });
      return { user, profile: sellerProfile, product, offer, wallet };
    };
    const techA = await technician(1);
    const techB = await technician(2);
    const camera = await seller(1, cameraPrice, 11n, 500);
    const recorder = await seller(2, recorderPrice, 17n, 5_000);
    const cableProduct = await db.product.create({
      data: { sku: `${token}-cable`, serviceKey: 'CCTV', titleFa: 'کابل دوربین', unit: 'METER', requiresSerial: false, weightGrams: 20 },
    });
    const cableOffer = await db.sellerOffer.create({ data: {
      sellerId: camera.profile.id, productId: cableProduct.id, sellerSku: cableProduct.sku, partnerPrice: cablePrice, onHandQty: 20,
    } });
    const customerWallet = await db.wallet.create({ data: { ownerId: customer.id, ownerType: 'CUSTOMER', balance: openingBalance } });
    const platformWallet = await db.wallet.create({ data: { ownerId: PLATFORM_WALLET_OWNER_ID, ownerType: 'PLATFORM' } });
    const definition = await db.serviceDefinition.create({
      data: {
        key: 'CCTV', titleFa: 'دوربین مداربسته', pillar: 'MONITORING', supportedLocationTypes: ['SHOP'], uiSchema: {},
        pricingSchema: {
          hardware: { lineItems: [
            ...[camera, recorder].map(({ product }) => ({ skuLogic: product.sku, qty: 1 })),
            { skuLogic: cableProduct.sku, qty: { var: ['cableMeters', 0] } },
          ] },
          managedWork: { meteredLabor: { titleFa: 'کابل‌کشی', qty: 2 } },
        },
      },
    });
    const rateCard = await db.installationRateCard.create({
      data: {
        code: token, cityId: city.id, branchId: branch.id, serviceKey: 'CCTV', standardMinutes: 60,
        hourlyRate: 3_120_001n, normalAllowance: 70_001n, minVisitWage: 1n, meteredLaborPerMeter: 50_003n,
      },
    });
    await db.platformConfig.create({
      data: {
        key: policyKey, value: {
          version: '11A-test', fixedTitleFa: 'تجهیزات', fixedBadgeFa: 'قیمت همکار', packageTitleFa: 'بسته اجرا', meteredTitleFa: 'متری',
          delivery: { bikeMaxGrams: 1_000, bikeMaxCm3: 20_000, bikeToman: '40001', carToman: '70003' },
        },
      },
    });
    return {
      token, city, branch, address, definition, rateCard, branchAdmin: actor(admin, branch.id), customer: actor(customer),
      customerWallet, platformWallet, techA, techB, camera, recorder, cableProduct, cableOffer,
    };
  });
}

describePostgres('Phase 11A managed orders on PostgreSQL', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const geo = jest.fn();
  const acquireOrderLock = jest.fn();
  const emitToUser = jest.fn();
  let fixtures: Awaited<ReturnType<typeof createFixtures>> | undefined;
  let orders: OrdersService;
  let dispatch: DispatchService;
  let warranty: WarrantyService;
  let walletEscrow: WalletEscrowService;
  let metering: MeteredAdjustmentsService;
  let app: INestApplication;

  function fixture() {
    if (!fixtures) throw new Error('PostgreSQL fixtures were not initialized');
    return fixtures;
  }

  beforeAll(async () => {
    fixtures = await createFixtures(prisma);
    const module = await Test.createTestingModule({
      controllers: [MeteredAdjustmentsController],
      providers: [
        OrdersService, DispatchService, WarrantyService, WalletEscrowService, PricingService, MeteredAdjustmentsService,
        PricingSchemaInterpreter, JsonLogicEvaluator, EventEmitter2,
        { provide: PrismaService, useValue: prisma },
        { provide: DynamicFactorsService, useValue: {
          getSurge: () => ({ multiplier: 1, reasonFa: 'عادی' }), getUrgency: () => ({ urgency: 'SCHEDULED', multiplier: 1 }),
        } },
        { provide: RedisService, useValue: {
          findNearbyTechs: geo, acquireOrderLock, releaseOrderLock: jest.fn().mockResolvedValue(true),
          orderLockKey: (id: string) => `dispatch:order:lock:${id}`,
        } },
        { provide: AppConfigService, useValue: { isProduction: false, otpDevEcho: true } },
        { provide: NotificationsService, useValue: { send: jest.fn() } },
        { provide: RealtimeService, useValue: { emitToOrder: jest.fn(), emitToUser } },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
        const { customer, techA, techB } = fixture();
        request.user = [customer, techA.actor, techB.actor].find(({ id }) => id === request.get('x-test-user'));
        return Boolean(request.user);
      },
    }).compile();
    orders = module.get(OrdersService);
    dispatch = module.get(DispatchService);
    warranty = module.get(WarrantyService);
    walletEscrow = module.get(WalletEscrowService);
    metering = module.get(MeteredAdjustmentsService);
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
  }, 20_000);

  beforeEach(async () => {
    const { camera, recorder, cableOffer, techA, techB } = fixture();
    await prisma.sellerOffer.updateMany({
      where: { id: { in: [camera.offer.id, recorder.offer.id] } }, data: { onHandQty: 2, reservedQty: 0 },
    });
    await prisma.sellerOffer.update({ where: { id: cableOffer.id }, data: { onHandQty: 20, reservedQty: 0 } });
    geo.mockResolvedValue([techA, techB].map(({ profile }) => ({ techId: profile.id, distanceMeters: 100 })));
    acquireOrderLock.mockResolvedValue({ acquired: true, token: 'test-lock' });
    emitToUser.mockClear();
  });

  async function clearOrders() {
    const { customer, customerWallet, platformWallet, techA, techB, camera, recorder } = fixture();
    const scope = { order: { customerId: customer.id } };
    const wallets = [customerWallet, platformWallet, techA.wallet, techB.wallet, camera.wallet, recorder.wallet];
    await prisma.$transaction(async (db) => {
      await db.walletTransaction.deleteMany({ where: scope });
      await db.escrowPosition.deleteMany({ where: scope });
      await db.supplyFulfillment.deleteMany({ where: scope });
      await db.serviceOrder.deleteMany({ where: { customerId: customer.id } });
      for (const { id, balance } of wallets) {
        await db.wallet.update({ where: { id }, data: { balance, heldInEscrow: 0n, restrictedReserve: 0n, restrictedFulfillment: 0n } });
      }
      await db.walletTransaction.deleteMany({ where: { orderId: null, walletId: customerWallet.id } });
    });
  }

  afterEach(async () => {
    if (fixtures) await clearOrders();
  });

  afterAll(async () => {
    try {
      if (!fixtures) return;
      const { camera, recorder, cableOffer, cableProduct, rateCard, definition, city, branch, customer, platformWallet, customerWallet, techA, techB, branchAdmin } = fixtures;
      await prisma.$transaction(async (db) => {
        await db.wallet.deleteMany({ where: { id: { in: [platformWallet, customerWallet, techA.wallet, techB.wallet, camera.wallet, recorder.wallet].map(({ id }) => id) } } });
        await db.sellerOffer.deleteMany({ where: { id: { in: [camera.offer.id, recorder.offer.id, cableOffer.id] } } });
        await db.product.deleteMany({ where: { id: { in: [camera.product.id, recorder.product.id, cableProduct.id] } } });
        await db.sellerProfile.deleteMany({ where: { id: { in: [camera.profile.id, recorder.profile.id] } } });
        await db.user.deleteMany({ where: { id: { in: [customer.id, branchAdmin.id, techA.actor.id, techB.actor.id, camera.user.id, recorder.user.id] } } });
        await db.installationRateCard.delete({ where: { id: rateCard.id } });
        await db.serviceDefinition.delete({ where: { id: definition.id } });
        await db.platformConfig.delete({ where: { key: policyKey } });
        await db.branch.delete({ where: { id: branch.id } });
        await db.city.delete({ where: { id: city.id } });
      });
    } finally {
      if (app) await app.close();
      await prisma.$disconnect();
    }
  });

  function createOrder() {
    const { customer, address } = fixture();
    return orders.create(customer, { addressId: address.id, items: [{ serviceKey: 'CCTV' }] });
  }

  function inventory() {
    const { camera, recorder } = fixture();
    return prisma.sellerOffer.findMany({
      where: { id: { in: [camera.offer.id, recorder.offer.id] } }, orderBy: { id: 'asc' },
      select: { onHandQty: true, reservedQty: true },
    });
  }

  it('funds a changed slider against frozen terms while preserving fixed and metered lines', async () => {
    const { customer, address, customerWallet } = fixture();
    const { order, estimate } = await orders.create(customer, {
      addressId: address.id, items: [{ serviceKey: 'CCTV' }], sliderBps: -1500,
    });
    expect(estimate.slider).toMatchObject({ sliderBps: -1500, dispatchAudience: 'ALL' });
    expect(order.slider).toMatchObject({ sliderBps: -1500 });
    const packageAmount = estimate.slider.packageBaseAmount * 10_500n / 10_000n;
    const untouched = estimate.invoice.buckets.filter(({ bucket }) => bucket !== 'SERVICE_PACKAGE');
    const total = untouched.reduce((sum, bucket) => sum + bucket.subtotal, packageAmount);

    await expect(orders.submit(customer, order.id, { sliderBps: 501 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(prisma.escrowPosition.findUnique({ where: { orderId: order.id } })).resolves.toBeNull();
    const result = await orders.submit(customer, order.id, { sliderBps: 500 });
    expect(result.state).toBe('SEARCHING_EXPERT');
    await expect(orders.submit(customer, order.id, { sliderBps: 500 })).resolves.toEqual(result);
    await expect(orders.submit(customer, order.id, { sliderBps: 2500 })).rejects.toBeInstanceOf(ConflictException);

    const final = await orders.getOne(customer, order.id);
    expect(final).toMatchObject({
      finalQuoteAmount: total,
      slider: { sliderBps: 500, dispatchAudience: 'TOP' },
      invoice: {
        total,
        buckets: expect.arrayContaining([
          ...untouched.map(({ bucket, subtotal }) => expect.objectContaining({ bucket, subtotal })),
          expect.objectContaining({ bucket: 'SERVICE_PACKAGE', subtotal: packageAmount }),
        ]),
      },
    });
    const revision = await prisma.orderPriceRevision.findFirstOrThrow({ where: { orderId: order.id } });
    expect(revision).toMatchObject({ status: 'FUNDED', sliderBps: 500 });
    await expect(prisma.escrowPosition.findUnique({ where: { orderId: order.id } })).resolves.toMatchObject({
      activeRevision: revision.revision, heldAmount: total, payerWalletId: customerWallet.id,
    });
    await expect(prisma.walletTransaction.count({ where: { orderId: order.id, type: 'ESCROW_HOLD' } })).resolves.toBe(1);
  });

  it('settles two sellers and every service-package Toman once across concurrent handover replays', async () => {
    const { token, customer, customerWallet, platformWallet, techA, recorder, camera } = fixture();
    const { order, estimate } = await createOrder();
    const servicePackage = 4_904_034n;
    const technicianNet = 3_605_296n;
    const commission = 873_532n;
    const reserve = servicePackage / 20n;
    const freight = 110_004n;
    const allowance = 70_001n;
    const meteredLabor = 100_006n;
    const total = servicePackage + cameraPrice + recorderPrice + meteredLabor;
    expect(servicePackage).toBe(technicianNet + commission + reserve + freight + allowance);
    expect(estimate.invoice.total).toBe(total);
    expect(estimate.invoice.buckets.map(({ subtotal }) => subtotal)).toEqual([cameraPrice + recorderPrice, servicePackage, meteredLabor]);
    await orders.submit(customer, order.id);
    await expect(orders.submit(customer, order.id)).resolves.toMatchObject({ state: 'SEARCHING_EXPERT' });
    await expect(dispatch.startSearch(order.id)).resolves.toMatchObject({ offersCreated: 2 });
    const [offer] = await dispatch.listMyOffers(techA.actor);
    if (!offer) throw new Error('Expected a dispatch offer');
    expect(offer.guaranteedPackageNet).toBe(technicianNet.toString());
    await dispatch.acceptOffer(techA.actor, offer.offerId);
    await orders.enRoute(techA.actor, order.id);
    await orders.startInspection(techA.actor, order.id);
    await expect(orders.inspectionScope(techA.actor, order.id, { matchesFrozenScope: true, revision: 1 }))
      .resolves.toMatchObject({ state: 'IN_PROGRESS' });

    const checklist = { defaultPasswordsChanged: true, technicianAccessRevoked: true };
    await expect(warranty.requestHandover(techA.actor, order.id, checklist)).rejects.toBeInstanceOf(BadRequestException);
    const lines = await prisma.orderAddon.findMany({
      where: { revision: { orderId: order.id }, sellerOfferId: { not: null } },
    });
    const orderUnit = (line: OrderAddon) => {
      if (!line.orderItemId) throw new Error('Expected order item for stocked hardware');
      return { orderAddonId: line.id, orderItemId: line.orderItemId, categoryFa: line.titleFa, serialNumber: `${token}-${line.id.slice(0, 8)}` };
    };
    await expect(warranty.registerHardwareUnits(techA.actor, order.id, { units: lines.map(orderUnit) })).resolves.toEqual({ registered: 2 });
    await expect(metering.submit(techA.actor, order.id, {
      readings: [{ lineKey: 'CCTV:metered-labor', actualCm: 200, photoAssetId: 'unchanged-cable-length' }],
    })).resolves.toMatchObject({ status: 'APPROVED', resultingRevision: 1 });
    const { devHandoverOtp } = await warranty.requestHandover(techA.actor, order.id, checklist);
    if (!devHandoverOtp) throw new Error('Expected the test handover OTP');
    const otp = { otp: devHandoverOtp };
    const [completed, concurrentReplay] = await Promise.all([
      warranty.completeHandover(techA.actor, order.id, otp), warranty.completeHandover(techA.actor, order.id, otp),
    ]);
    expect(concurrentReplay).toEqual(completed);
    await expect(warranty.completeHandover(techA.actor, order.id, otp)).resolves.toEqual(completed);
    expect(completed.guaranteedNetPayout).toBe(technicianNet + meteredLabor);

    await expect(prisma.escrowPosition.findUnique({ where: { orderId: order.id } })).resolves.toMatchObject({ status: 'SETTLED', heldAmount: total, settledAmount: total });
    const readWallet = (id: string) => prisma.wallet.findUniqueOrThrow({ where: { id } });
    const [payer, platform, technician, firstSeller, secondSeller] = await Promise.all([
      customerWallet, platformWallet, techA.wallet, camera.wallet, recorder.wallet,
    ].map(({ id }) => readWallet(id)));
    expect(payer).toMatchObject({ balance: openingBalance - total, heldInEscrow: 0n });
    expect(platform).toMatchObject({ balance: commission + 11n + 17n, restrictedReserve: reserve, restrictedFulfillment: freight + allowance });
    expect(technician).toMatchObject({ balance: technicianNet + meteredLabor });
    expect(firstSeller).toMatchObject({ balance: cameraPrice - 11n });
    expect(secondSeller).toMatchObject({ balance: recorderPrice - 17n });
    await expect(walletEscrow.getFinanceSummary()).resolves.toMatchObject({
      platformBalance: commission + 11n + 17n, restrictedReserve: reserve, restrictedFulfillment: freight + allowance,
    });
    const postings = await prisma.walletTransaction.findMany({ where: { orderId: order.id, type: { not: 'ESCROW_HOLD' } } });
    expect(postings.map(({ type }) => type).sort()).toEqual([
      'ESCROW_RELEASE', 'FULFILLMENT_ALLOCATION', 'PLATFORM_COMMISSION', 'SELLER_APP_FEE', 'SELLER_APP_FEE',
      'SELLER_PAYOUT', 'SELLER_PAYOUT', 'TECHNICIAN_PAYOUT', 'WARRANTY_RESERVE',
    ]);
    expect(postings.reduce((sum, { amount }) => sum + amount, 0n)).toBe(0n);
    expect(await inventory()).toEqual([{ onHandQty: 1, reservedQty: 0 }, { onHandQty: 1, reservedQty: 0 }]);
    const shipments = await prisma.supplyFulfillment.findMany({ where: { orderId: order.id }, orderBy: { freightCost: 'asc' } });
    expect(shipments).toEqual([
      expect.objectContaining({ sellerId: camera.profile.id, deliveryMode: 'BIKE', freightCost: 40_001n, status: 'DELIVERED' }),
      expect.objectContaining({ sellerId: recorder.profile.id, deliveryMode: 'CAR', freightCost: 70_003n, status: 'DELIVERED' }),
    ]);
  }, 20_000);

  it('allows one of two concurrent submits to reserve the last unit and rolls back the losing transaction', async () => {
    const { customer, customerWallet, recorder } = fixture();
    await prisma.sellerOffer.update({ where: { id: recorder.offer.id }, data: { onHandQty: 1 } });
    const first = await createOrder();
    const second = await createOrder();
    const ids = [first.order.id, second.order.id];
    const results = await Promise.allSettled(ids.map((id) => orders.submit(customer, id)));
    expect(results).toEqual(expect.arrayContaining([
      { status: 'fulfilled', value: expect.objectContaining({ state: 'SEARCHING_EXPERT' }) },
      { status: 'rejected', reason: expect.any(ConflictException) },
    ]));
    const rows = await prisma.serviceOrder.findMany({
      where: { id: { in: ids } }, orderBy: { state: 'asc' },
      include: { escrowPosition: true, priceRevisions: true, fulfillments: true, stateTransitions: true, transactions: true },
    });
    const funded = rows.find(({ state }) => state === 'SEARCHING_EXPERT');
    const losing = rows.find(({ state }) => state === 'ESTIMATED');
    expect(funded).toMatchObject({
      escrowPosition: { status: 'OPEN', heldAmount: first.estimate.invoice.total },
      priceRevisions: [expect.objectContaining({ status: 'FUNDED' })],
      transactions: [expect.objectContaining({ type: 'ESCROW_HOLD', amount: -first.estimate.invoice.total })],
    });
    expect(losing).toMatchObject({
      escrowPosition: null, finalQuoteAmount: null, fulfillments: [], transactions: [],
      priceRevisions: [expect.objectContaining({ status: 'DRAFT' })],
    });
    expect(losing?.stateTransitions.map(({ toState }) => toState).sort()).toEqual(['DRAFT', 'ESTIMATED']);
    expect(await inventory()).toEqual([{ onHandQty: 2, reservedQty: 1 }, { onHandQty: 1, reservedQty: 1 }]);
    await expect(prisma.wallet.findUnique({ where: { id: customerWallet.id } })).resolves.toMatchObject({
      balance: openingBalance - first.estimate.invoice.total, heldInEscrow: first.estimate.invoice.total,
    });
  });

  async function raceAccepts(orderId: string, fromState: OrderState) {
    const { techA, techB } = fixture();
    const [offersA, offersB] = await Promise.all([dispatch.listMyOffers(techA.actor), dispatch.listMyOffers(techB.actor)]);
    const offerA = offersA.find((offer) => offer.orderId === orderId);
    const offerB = offersB.find((offer) => offer.orderId === orderId);
    if (!offerA || !offerB) throw new Error('Expected independent offers for both technicians');
    // Let both contenders through the cache lock to exercise the database as the final authority.
    let contenders = 0;
    let release = () => {};
    const ready = new Promise<void>((resolve) => { release = resolve; });
    acquireOrderLock.mockImplementation(async () => {
      const token = `contender-${++contenders}`;
      if (contenders === 2) release();
      await ready;
      return { acquired: true, token };
    });
    const results = await Promise.allSettled([
      dispatch.acceptOffer(techA.actor, offerA.offerId), dispatch.acceptOffer(techB.actor, offerB.offerId),
    ]);
    expect(results).toEqual(expect.arrayContaining([
      { status: 'fulfilled', value: expect.objectContaining({ state: 'EXPERT_ASSIGNED' }) },
      { status: 'rejected', reason: expect.any(ConflictException) },
    ]));
    const attempts = await prisma.dispatchOffer.findMany({
      where: { id: { in: [offerA.offerId, offerB.offerId] } }, include: { technician: true },
    });
    const winner = attempts.find((attempt) => attempt.status === 'ACCEPTED');
    expect(attempts.map(({ status }) => status).sort()).toEqual(['ACCEPTED', 'CANCELLED']);
    await expect(prisma.serviceOrder.findUnique({ where: { id: orderId } })).resolves.toMatchObject({
      state: 'EXPERT_ASSIGNED', technicianId: winner?.technician.userId,
    });
    await expect(prisma.orderStateTransition.findMany({ where: { orderId, toState: 'EXPERT_ASSIGNED' } })).resolves.toEqual([
      expect.objectContaining({ fromState, actorUserId: winner?.technician.userId }),
    ]);
  }

  it('assigns a single technician when two auto-dispatch offers are accepted concurrently', async () => {
    const { customer } = fixture();
    const { order } = await createOrder();
    await orders.submit(customer, order.id);
    await expect(dispatch.startSearch(order.id)).resolves.toMatchObject({ offersCreated: 2 });
    await raceAccepts(order.id, 'SEARCHING_EXPERT');
  });

  it('expires branch invitations after five minutes and assigns one of two concurrent acceptances', async () => {
    const { customer, branchAdmin, techA, techB } = fixture();
    const { order } = await createOrder();
    await orders.submit(customer, order.id);
    await orders.branchQueue(branchAdmin, order.id);
    const start = Date.now();
    const pastInvite = await dispatch.inviteTechnician(branchAdmin, order.id, techA.actor.id);
    expect(pastInvite.expiresAt.getTime()).toBeGreaterThanOrEqual(start + 300_000);
    expect(pastInvite.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 300_000);
    await expect(dispatch.inviteTechnician(branchAdmin, order.id, techA.actor.id)).resolves.toEqual(pastInvite);
    await prisma.dispatchOffer.update({ where: { id: pastInvite.offerId }, data: { expiresAt: new Date(Date.now() - 1) } });
    await expect(dispatch.acceptOffer(techA.actor, pastInvite.offerId)).rejects.toBeInstanceOf(BadRequestException);
    const [inviteA, inviteB] = await Promise.all([
      dispatch.inviteTechnician(branchAdmin, order.id, techA.actor.id), dispatch.inviteTechnician(branchAdmin, order.id, techB.actor.id),
    ]);
    expect(inviteA.offerId).not.toBe(pastInvite.offerId);
    expect(inviteA.offerId).not.toBe(inviteB.offerId);
    await raceAccepts(order.id, 'BRANCH_QUEUE');
    await expect(prisma.dispatchOffer.findUnique({ where: { id: pastInvite.offerId } })).resolves.toMatchObject({ status: 'EXPIRED' });
  });

  it('refunds escrow and restores reserved stock together after submission', async () => {
    const { customer, customerWallet } = fixture();
    const { order, estimate } = await createOrder();
    const total = estimate.invoice.total;
    await orders.submit(customer, order.id);
    expect(await inventory()).toEqual([{ onHandQty: 2, reservedQty: 1 }, { onHandQty: 2, reservedQty: 1 }]);

    // Force the refund to fail after the stock writes to prove they roll back with the order transition.
    await prisma.wallet.update({ where: { id: customerWallet.id }, data: { heldInEscrow: total - 1n } });
    await expect(orders.cancel(customer, order.id, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(await inventory()).toEqual([{ onHandQty: 2, reservedQty: 1 }, { onHandQty: 2, reservedQty: 1 }]);
    await expect(prisma.escrowPosition.findUnique({ where: { orderId: order.id } })).resolves.toMatchObject({ status: 'OPEN' });
    await expect(prisma.serviceOrder.findUnique({ where: { id: order.id } })).resolves.toMatchObject({ state: 'SEARCHING_EXPERT' });
    await prisma.wallet.update({ where: { id: customerWallet.id }, data: { heldInEscrow: total } });

    const cancelled = await orders.cancel(customer, order.id, { reason: 'تست لغو سفارش' });
    expect(cancelled.state).toBe('CANCELLED');
    await expect(orders.cancel(customer, order.id, {})).resolves.toEqual(cancelled);
    await expect(prisma.escrowPosition.findUnique({ where: { orderId: order.id } })).resolves.toMatchObject({ status: 'REFUNDED', heldAmount: total });
    await expect(prisma.wallet.findUnique({ where: { id: customerWallet.id } })).resolves.toMatchObject({ balance: openingBalance, heldInEscrow: 0n });
    expect(await inventory()).toEqual([{ onHandQty: 2, reservedQty: 0 }, { onHandQty: 2, reservedQty: 0 }]);
    await expect(prisma.supplyFulfillment.count({ where: { orderId: order.id, status: 'CANCELLED' } })).resolves.toBe(2);
    await expect(prisma.orderPriceRevision.findFirst({ where: { orderId: order.id } })).resolves.toMatchObject({ status: 'CANCELLED' });
    await expect(prisma.walletTransaction.findMany({ where: { orderId: order.id, type: 'REFUND' } })).resolves.toEqual([
      expect.objectContaining({ amount: total }),
    ]);
  });

  const checklist = { defaultPasswordsChanged: true, technicianAccessRevoked: true };

  async function startMeteredWork() {
    const { address, customer, techA, token } = fixture();
    const { order, estimate } = await orders.create(customer, {
      addressId: address.id, items: [{ serviceKey: 'CCTV', config: { cableMeters: 3 } }],
    });
    await orders.submit(customer, order.id);
    await dispatch.startSearch(order.id);
    const [offer] = await dispatch.listMyOffers(techA.actor);
    if (!offer) throw new Error('Dispatch offer missing');
    await dispatch.acceptOffer(techA.actor, offer.offerId);
    await orders.enRoute(techA.actor, order.id);
    await orders.startInspection(techA.actor, order.id);
    await orders.inspectionScope(techA.actor, order.id, { matchesFrozenScope: true, revision: 1 });
    const fixed = await prisma.orderAddon.findMany({ where: { revision: { orderId: order.id }, bucket: 'FIXED' } });
    await warranty.registerHardwareUnits(techA.actor, order.id, {
      units: fixed.map(({ id, orderItemId, titleFa }) => {
        if (!orderItemId) throw new Error('Order item missing');
        return { orderAddonId: id, orderItemId, categoryFa: titleFa, serialNumber: `${token}-${id.slice(0, 8)}` };
      }),
    });
    const [material, labor] = await Promise.all([
      prisma.orderAddon.findFirstOrThrow({ where: { revision: { orderId: order.id }, bucket: 'METERED', kind: 'MATERIAL' } }),
      prisma.orderAddon.findFirstOrThrow({ where: { revision: { orderId: order.id }, bucket: 'METERED', kind: 'LABOR' } }),
    ]);
    expect(material).toMatchObject({ quantityCm: 300, unitPrice: cablePrice, lineTotal: 36_909n });
    expect(labor).toMatchObject({ quantityCm: 200, unitPrice: 50_003n, lineTotal: 100_006n });
    return { orderId: order.id, total: estimate.invoice.total, material, labor };
  }

  function measuredLengths(material: OrderAddon, materialCm: number, labor: OrderAddon, laborCm: number) {
    return { readings: [
      { lineKey: material.lineKey, actualCm: materialCm, photoAssetId: 'material-photo-ref' },
      { lineKey: labor.lineKey, actualCm: laborCm, photoAssetId: 'labor-photo-ref' },
    ] };
  }

  function expectNoSettlementDetails(value: unknown) {
    expect(JSON.stringify(value)).not.toMatch(/"(?:commission|commissionRate|platformCommission|warrantyReserveAmount|internalSplitJson)"/);
  }

  it('auto-refunds fractional usage exactly once and releases excess reserved material', async () => {
    const { cableOffer, customer, customerWallet, techA } = fixture();
    const { orderId, total, material, labor } = await startMeteredWork();
    await expect(warranty.requestHandover(techA.actor, orderId, checklist)).rejects.toThrow(/متراژ واقعی/);
    const dto = measuredLengths(material, 105, labor, 117);
    const adjustment = await metering.submit(techA.actor, orderId, dto);
    expect(adjustment).toMatchObject({ status: 'AUTO_REFUNDED', baseRevision: 1, resultingRevision: 2 });
    expect(adjustment).not.toHaveProperty('deltaAmount');
    await expect(metering.submit(techA.actor, orderId, dto)).resolves.toEqual(adjustment);
    expectNoSettlementDetails(adjustment);
    await expect(prisma.wallet.findUnique({ where: { id: customerWallet.id } })).resolves.toMatchObject({
      balance: openingBalance - total + 65_494n, heldInEscrow: total - 65_494n,
    });
    await expect(prisma.escrowPosition.findUnique({ where: { orderId } })).resolves.toMatchObject({ heldAmount: total - 65_494n, activeRevision: 2 });
    await expect(prisma.sellerOffer.findUnique({ where: { id: cableOffer.id } })).resolves.toMatchObject({ reservedQty: 2 });
    await expect(prisma.walletTransaction.findMany({ where: { orderId, type: 'REFUND' } })).resolves.toEqual([
      expect.objectContaining({ amount: 65_494n, idempotencyKey: `meter:refund:${orderId}:2` }),
    ]);
    await expect(prisma.orderPriceRevision.findMany({ where: { orderId }, orderBy: { revision: 'asc' } })).resolves.toEqual([
      expect.objectContaining({ revision: 1, status: 'SUPERSEDED' }), expect.objectContaining({ revision: 2, status: 'FUNDED' }),
    ]);
    expect(emitToUser).toHaveBeenCalledWith(customer.id, 'METERED_ADJUSTMENT_CHANGED', {
      orderId, adjustment: { ...adjustment, deltaAmount: '-65494' },
    });
    expect(emitToUser).toHaveBeenCalledWith(techA.actor.id, 'METERED_ADJUSTMENT_CHANGED', { orderId, adjustment });
    await expect(warranty.requestHandover(techA.actor, orderId, checklist)).resolves.toMatchObject({ state: 'HANDOVER_OTP_PENDING' });
  }, 20_000);

  it('returns the exact 409 shortfall, permits top-up and idempotent approval, then settles actual seller and technician quantities', async () => {
    const { camera, recorder, cableOffer, customer, customerWallet, platformWallet, techA } = fixture();
    const { orderId, total, material, labor } = await startMeteredWork();
    const dto = measuredLengths(material, 425, labor, 278);
    const pending = await metering.submit(techA.actor, orderId, dto);
    expect(pending).toMatchObject({ status: 'PENDING_APPROVAL', resultingRevision: null, readings: expect.arrayContaining([
      { lineKey: material.lineKey, titleFa: material.titleFa, estimatedCm: 300, actualCm: 425, photoAssetId: 'material-photo-ref' },
    ]) });
    await expect(metering.submit(techA.actor, orderId, dto)).rejects.toBeInstanceOf(ConflictException);
    await expect(warranty.requestHandover(techA.actor, orderId, checklist)).rejects.toThrow(/در انتظار تأیید مشتری/);
    const beforeTopup = 127n;
    await prisma.wallet.update({ where: { id: customerWallet.id }, data: { balance: beforeTopup } });
    await prisma.wallet.update({ where: { id: platformWallet.id }, data: { restrictedReserve: 37n, restrictedFulfillment: 41n } });
    const idempotencyKey = randomUUID();
    const approvePath = `${await app.getUrl()}/api/v1/orders/${orderId}/adjustments/${pending.id}/approve`;
    const approve = () => fetch(approvePath, {
      method: 'POST', body: JSON.stringify({ idempotencyKey }),
      headers: { 'content-type': 'application/json', 'x-test-user': customer.id, connection: 'close' },
    });
    const shortfall = await approve();
    expect(shortfall.status).toBe(409);
    expect(await shortfall.json()).toEqual({
      errorCode: 'WALLET_SHORTFALL', revision: 1, delta: '54380', available: '127', shortfall: '54253', currency: 'TOMAN',
    });
    await expect(prisma.wallet.findUnique({ where: { id: customerWallet.id } })).resolves.toMatchObject({ balance: beforeTopup, heldInEscrow: total });
    await expect(prisma.wallet.findUnique({ where: { id: platformWallet.id } })).resolves.toMatchObject({ balance: 0n, restrictedReserve: 37n, restrictedFulfillment: 41n });
    await expect(prisma.sellerOffer.findUnique({ where: { id: cableOffer.id } })).resolves.toMatchObject({ reservedQty: 3 });
    await expect(prisma.orderMeteredAdjustment.findUnique({ where: { id: pending.id } })).resolves.toMatchObject({ status: 'PENDING_APPROVAL', idempotencyKey: null });
    await expect(orders.getOne(customer, orderId)).resolves.toMatchObject({ pendingAdjustment: { ...pending, deltaAmount: '54380' } });
    const technicianOrder = await orders.getOne(techA.actor, orderId);
    expect(technicianOrder).toMatchObject({ pendingAdjustment: pending });
    expect(technicianOrder).not.toHaveProperty('pendingAdjustment.deltaAmount');

    await walletEscrow.topUp({ ownerId: customer.id, ownerType: 'CUSTOMER', amount: 54_253n, idempotencyKey: randomUUID() });
    const [first, replay] = await Promise.all([approve(), approve()]);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    const approved: unknown = await first.json();
    expect(await replay.json()).toEqual(approved);
    expect(approved).toMatchObject({ status: 'APPROVED', deltaAmount: '54380', resultingRevision: 2 });
    expectNoSettlementDetails(approved);
    await expect(prisma.walletTransaction.count({ where: { orderId, type: 'ESCROW_HOLD' } })).resolves.toBe(2);
    await expect(prisma.wallet.findUnique({ where: { id: customerWallet.id } })).resolves.toMatchObject({ balance: 0n, heldInEscrow: total + 54_380n });
    await expect(orders.getOne(customer, orderId)).resolves.toMatchObject({ pendingAdjustment: null, latestAdjustment: approved });
    const seller = actor(camera.user, fixture().branch.id);
    const projected = await orders.getOne(seller, orderId);
    expect(projected).toMatchObject({
      grossGoods: cameraPrice + 52_287n,
      lines: [expect.objectContaining({ lineTotal: cameraPrice }), expect.objectContaining({ quantityCm: 425, lineTotal: 52_287n })],
    });
    expect(JSON.stringify(projected, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value))
      .not.toMatch(/"(?:commission|commissionRate|platformCommission|warrantyReserveAmount|internalSplitJson)"/);

    const { devHandoverOtp } = await warranty.requestHandover(techA.actor, orderId, checklist);
    if (!devHandoverOtp) throw new Error('Test OTP missing');
    const result = await warranty.completeHandover(techA.actor, orderId, { otp: devHandoverOtp });
    expect(result.guaranteedNetPayout).toBe(3_605_296n + 139_008n);
    expectNoSettlementDetails({ ...result, guaranteedNetPayout: result.guaranteedNetPayout.toString() });
    await expect(prisma.escrowPosition.findUnique({ where: { orderId } })).resolves.toMatchObject({
      status: 'SETTLED', activeRevision: 2, heldAmount: total + 54_380n, settledAmount: total + 54_380n,
    });
    await expect(prisma.wallet.findUnique({ where: { id: camera.wallet.id } })).resolves.toMatchObject({ balance: cameraPrice + 52_287n - 11n });
    await expect(prisma.wallet.findUnique({ where: { id: recorder.wallet.id } })).resolves.toMatchObject({ balance: recorderPrice - 17n });
    await expect(prisma.wallet.findUnique({ where: { id: techA.wallet.id } })).resolves.toMatchObject({ balance: 3_605_296n + 139_008n });
    await expect(prisma.wallet.findUnique({ where: { id: platformWallet.id } })).resolves.toMatchObject({ balance: 873_560n, restrictedReserve: 245_238n, restrictedFulfillment: 180_046n });
    await expect(prisma.sellerOffer.findUnique({ where: { id: cableOffer.id } })).resolves.toMatchObject({ onHandQty: 15, reservedQty: 0 });
  }, 20_000);

  it('allows remeasurement after rejection and keeps the base revision if actual line amounts offset exactly', async () => {
    const { customer, customerWallet, techA } = fixture();
    const { orderId, total, material, labor } = await startMeteredWork();
    const pending = await metering.submit(techA.actor, orderId, measuredLengths(material, 425, labor, 278));
    await expect(metering.reject(customer, orderId, pending.id)).resolves.toMatchObject({ status: 'REJECTED', resultingRevision: null });
    await expect(warranty.requestHandover(techA.actor, orderId, checklist)).rejects.toThrow(/متراژ واقعی/);
    const balanced = await metering.submit(techA.actor, orderId, measuredLengths(material, 426, labor, 169));
    expect(balanced).toMatchObject({ status: 'APPROVED', baseRevision: 1, resultingRevision: 1 });
    await expect(orders.getOne(customer, orderId)).resolves.toMatchObject({ latestAdjustment: { ...balanced, readings: expect.any(Array), deltaAmount: '0' } });
    await expect(prisma.orderAddon.findMany({ where: { id: { in: [material.id, labor.id] } } })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ quantityCm: 426, lineTotal: 52_410n }), expect.objectContaining({ quantityCm: 169, lineTotal: 84_505n }),
    ]));
    await expect(prisma.orderPriceRevision.count({ where: { orderId } })).resolves.toBe(1);
    await expect(prisma.wallet.findUnique({ where: { id: customerWallet.id } })).resolves.toMatchObject({ balance: openingBalance - total, heldInEscrow: total });
    await expect(prisma.walletTransaction.count({ where: { orderId } })).resolves.toBe(1);
    await expect(warranty.requestHandover(techA.actor, orderId, checklist)).resolves.toMatchObject({ state: 'HANDOVER_OTP_PENDING' });
  }, 20_000);
});
