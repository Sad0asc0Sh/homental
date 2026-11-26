import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException, ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { BigIntSerializerInterceptor } from '@common/interceptors/bigint-serializer.interceptor';
import type { AuthenticatedRequest, AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import type { NotificationsService } from '@modules/notifications/notifications.service';
import { B2BSupplyController } from '@modules/partner-supply/b2b-supply.controller';
import { B2BSupplyService } from '@modules/partner-supply/b2b-supply.service';
import { OrdersService } from '@modules/security-services/orders/orders.service';
import type { DynamicFactorsService } from '@modules/security-services/pricing/dynamic-factors.service';
import { PricingSchemaInterpreter } from '@modules/security-services/pricing/pricing-schema.interpreter';
import { PricingService } from '@modules/security-services/pricing/pricing.service';
import { JsonLogicEvaluator } from '@modules/security-services/shared/json-logic.evaluator';
import { PLATFORM_WALLET_OWNER_ID } from '@modules/wallet-escrow/wallet-escrow.constants';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';
import { WalletController } from '@modules/wallet-escrow/wallet.controller';

// Use a disposable, unseeded PostGIS database prepared with prisma migrate deploy.
const databaseUrl = process.env['PHASE11C_B2B_TEST_DATABASE_URL'];
const describePostgres = databaseUrl ? describe : describe.skip;
const coordinates = { lat: 36.29, lng: 59.6 };
const openingBalance = 20_000_000n;
const bikeToman = 90_001n;
const carToman = 220_003n;
const pricingKey = 'pricing.managed';

function actor(user: User, branchId: string | null = null): AuthenticatedUser {
  return { id: user.id, role: user.role, phone: user.phone, branchId };
}

async function fixtures(prisma: PrismaService) {
  return prisma.$transaction(async (db) => {
    const key = randomUUID();
    const city = await db.city.create({ data: {
      slug: key, nameEn: 'Mashhad test', nameFa: 'مشهد', centerLat: coordinates.lat, centerLng: coordinates.lng,
    } });
    const branch = await db.branch.create({ data: {
      cityId: city.id, code: key, nameFa: 'شعبه آزمایشی', addressFa: 'نشانی شعبه آزمایشی', ...coordinates,
    } });
    const technician = async (index: number) => {
      const user = await db.user.create({ data: { phone: `${key}-t${index}`, role: 'TECHNICIAN', status: 'ACTIVE' } });
      await db.technicianProfile.create({ data: { userId: user.id, branchId: branch.id, status: 'APPROVED', skills: ['CCTV'] } });
      const wallet = await db.wallet.create({ data: { ownerType: 'TECHNICIAN', ownerId: user.id, balance: openingBalance } });
      return { actor: actor(user, branch.id), wallet };
    };
    const technicianA = await technician(1);
    const technicianB = await technician(2);
    const seller = async (index: number) => {
      const user = await db.user.create({ data: { phone: `${key}-s${index}`, role: 'SELLER', status: 'ACTIVE' } });
      const profile = await db.sellerProfile.create({ data: {
        userId: user.id, cityId: city.id, branchId: branch.id, shopNameFa: `فروشگاه ${index}`,
        status: 'APPROVED', addressFa: 'نشانی فروشگاه', ...coordinates,
      } });
      const wallet = await db.wallet.create({ data: { ownerType: 'SELLER', ownerId: user.id } });
      return { actor: actor(user), profile, wallet };
    };
    const sellerA = await seller(1);
    const sellerB = await seller(2);
    const addOffer = async (sellerId: string, sku: string, partnerPrice: bigint, weightGrams: number) => {
      const product = await db.product.create({ data: {
        sku: `${key}-${sku}`, serviceKey: 'CCTV', titleFa: `کالا ${sku}`, weightGrams,
        specs: { brand: 'Pilot', commission: 'must-be-removed' },
      } });
      const offer = await db.sellerOffer.create({ data: {
        sellerId, productId: product.id, sellerSku: sku, partnerPrice, onHandQty: 5,
      } });
      return { product, offer };
    };
    const camera = await addOffer(sellerA.profile.id, 'camera', 1_000_009n, 600);
    const cable = await addOffer(sellerA.profile.id, 'kit', 50_007n, 300);
    const recorder = await addOffer(sellerB.profile.id, 'recorder', 2_000_021n, 8_001);
    const customer = await db.user.create({ data: { phone: `${key}-customer`, role: 'CUSTOMER', status: 'ACTIVE' } });
    const customerProfile = await db.customerProfile.create({ data: { userId: customer.id } });
    const address = await db.address.create({ data: {
      customerId: customerProfile.id, cityId: city.id, titleFa: 'خانه', fullAddressFa: 'نشانی مشتری',
      locationType: 'SHOP', ...coordinates,
    } });
    const customerWallet = await db.wallet.create({ data: { ownerType: 'CUSTOMER', ownerId: customer.id, balance: openingBalance } });
    const platform = await db.wallet.create({ data: { ownerType: 'PLATFORM', ownerId: PLATFORM_WALLET_OWNER_ID } });
    const definition = await db.serviceDefinition.create({ data: {
      key: 'CCTV', titleFa: 'دوربین مداربسته', pillar: 'MONITORING', supportedLocationTypes: ['SHOP'], uiSchema: {},
      pricingSchema: { hardware: { lineItems: [{ qty: 1, skuLogic: camera.product.sku }] } },
    } });
    const rate = await db.installationRateCard.create({ data: {
      code: key, serviceKey: 'CCTV', cityId: city.id, branchId: branch.id, standardMinutes: 60, hourlyRate: 1_000_000n,
      normalAllowance: 50_000n, minVisitWage: 100_000n,
    } });
    await db.platformConfig.create({ data: {
      key: pricingKey,
      value: {
        version: '11c-b2b-test', fixedTitleFa: 'تجهیزات', fixedBadgeFa: 'همکار', packageTitleFa: 'اجرا', meteredTitleFa: 'متری',
        delivery: { bikeMaxGrams: 8000, bikeMaxCm3: 24_000, bikeToman: bikeToman.toString(), carToman: carToman.toString() },
      },
    } });
    return {
      city, branch, address, technicianA, technicianB, sellerA, sellerB, camera, cable, recorder, customer: actor(customer),
      customerWallet, platform, definition, rate,
    };
  });
}

describePostgres('Phase 11C B2B procurement on PostgreSQL', () => {
  const db = new PrismaService({ datasourceUrl: databaseUrl });
  const wallet = new WalletEscrowService(db);
  const b2b = new B2BSupplyService(db, wallet);
  const factorStub = {
    getSurge: async () => ({ multiplier: 1, reasonFa: 'عادی' }),
    getUrgency: async () => ({ urgency: 'SCHEDULED', multiplier: 1 }),
  } as unknown as DynamicFactorsService;
  const pricing = new PricingService(db, new PricingSchemaInterpreter(new JsonLogicEvaluator()), factorStub);
  const orders = new OrdersService(
    db, pricing, wallet, { send: jest.fn().mockResolvedValue({}) } as unknown as NotificationsService, new EventEmitter2(),
  );
  let f: Awaited<ReturnType<typeof fixtures>>;
  let app: INestApplication;
  let httpBase: string;

  beforeAll(async () => {
    f = await fixtures(db);
    const module = await Test.createTestingModule({
      controllers: [B2BSupplyController, WalletController],
      providers: [{ provide: B2BSupplyService, useValue: b2b }, { provide: WalletEscrowService, useValue: wallet }],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        request.user = [f.technicianA.actor, f.technicianB.actor, f.sellerA.actor, f.sellerB.actor, f.customer]
          .find(({ id }) => id === request.get('x-test-user'));
        return Boolean(request.user);
      },
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new BigIntSerializerInterceptor());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    httpBase = await app.getUrl();
  }, 20_000);

  afterEach(async () => {
    if (!f) return;
    const b2bScope = { technicianUserId: f.technicianA.actor.id };
    const managedScope = { customerId: f.customer.id };
    const wallets = [f.technicianA.wallet, f.technicianB.wallet, f.sellerA.wallet, f.sellerB.wallet, f.customerWallet, f.platform];
    await db.$transaction(async (tx) => {
      await tx.walletTransaction.deleteMany({ where: { walletId: { in: wallets.map(({ id }) => id) } } });
      await tx.escrowPosition.deleteMany({ where: { OR: [{ b2bSupplyOrder: b2bScope }, { order: managedScope }] } });
      await tx.supplyFulfillment.deleteMany({ where: { OR: [{ b2bSupplyOrder: b2bScope }, { order: managedScope }] } });
      await tx.b2BSupplyOrder.deleteMany({ where: b2bScope });
      await tx.serviceOrder.deleteMany({ where: managedScope });
      await tx.sellerOffer.updateMany({
        where: { id: { in: [f.camera.offer.id, f.cable.offer.id, f.recorder.offer.id] } }, data: { onHandQty: 5, reservedQty: 0 },
      });
      await tx.sellerProfile.update({ where: { id: f.sellerA.profile.id }, data: { sellerAppFeeFlat: 0n } });
      for (const { id, balance } of wallets) {
        await tx.wallet.update({ where: { id }, data: { balance, heldInEscrow: 0n, restrictedReserve: 0n, restrictedFulfillment: 0n } });
      }
    });
  });

  afterAll(async () => {
    try {
      if (!f) return;
      await db.$transaction(async (tx) => {
        const actors = [f.technicianA.actor, f.technicianB.actor, f.sellerA.actor, f.sellerB.actor, f.customer];
        await tx.sellerOffer.deleteMany({ where: { id: { in: [f.camera.offer.id, f.cable.offer.id, f.recorder.offer.id] } } });
        await tx.product.deleteMany({ where: { id: { in: [f.camera.product.id, f.cable.product.id, f.recorder.product.id] } } });
        await tx.sellerProfile.deleteMany({ where: { id: { in: [f.sellerA.profile.id, f.sellerB.profile.id] } } });
        await tx.wallet.deleteMany({ where: { ownerId: { in: [...actors.map(({ id }) => id), PLATFORM_WALLET_OWNER_ID] } } });
        await tx.user.deleteMany({ where: { id: { in: actors.map(({ id }) => id) } } });
        await tx.installationRateCard.delete({ where: { id: f.rate.id } });
        await tx.serviceDefinition.delete({ where: { id: f.definition.id } });
        await tx.platformConfig.delete({ where: { key: pricingKey } });
        await tx.branch.delete({ where: { id: f.branch.id } });
        await tx.city.delete({ where: { id: f.city.id } });
      });
    } finally {
      await app?.close();
      await db.$disconnect();
    }
  });

  function checkout(...offerIds: string[]) {
    return b2b.create(f.technicianA.actor, {
      deliveryAddressFa: 'نشانی تحویل سفارش تست', ...coordinates,
      items: offerIds.map((sellerOfferId) => ({ sellerOfferId, qty: 1 })),
    });
  }

  function readWallet(id: string) {
    return db.wallet.findUniqueOrThrow({ where: { id } });
  }

  async function request(path: string, as: AuthenticatedUser, body?: object) {
    const response = await fetch(`${httpBase}${path}`, {
      headers: { 'content-type': 'application/json', 'x-test-user': as.id, connection: 'close' },
      method: body ? 'POST' : 'GET', body: body && JSON.stringify(body),
    });
    const payload: unknown = await response.json();
    return { status: response.status, payload };
  }

  it('grants technician wallet self-topup and scopes wallet views and clean catalog through HTTP', async () => {
    const topup = await request('/wallet/topup', f.technicianA.actor, {
      amount: '100003', idempotencyKey: randomUUID(), ownerType: 'SELLER', ownerId: f.sellerA.actor.id,
    });
    expect(topup).toMatchObject({ status: 201, payload: { amount: '100003', type: 'TOPUP' } });
    expect(await request('/wallet/me', f.technicianA.actor)).toMatchObject({
      status: 200, payload: { wallet: { id: f.technicianA.wallet.id, balance: (openingBalance + 100_003n).toString() }, total: 1 },
    });
    expect(await request('/wallet/me', f.sellerA.actor)).toMatchObject({
      status: 200, payload: { wallet: { id: f.sellerA.wallet.id, balance: '0' }, total: 0 },
    });
    expect(await request('/wallet/me', f.customer)).toMatchObject({
      status: 200, payload: { wallet: { id: f.customerWallet.id, balance: openingBalance.toString() }, total: 0 },
    });
    const catalog = await request('/partner-supply/catalog', f.technicianA.actor);
    expect(catalog).toMatchObject({
      status: 200, payload: {
        deliveryPolicy: { bikeMaxGrams: 8000, bikeToman: bikeToman.toString() },
        items: expect.arrayContaining([expect.objectContaining({
          id: f.camera.offer.id, partnerPrice: '1000009', availableQty: 5, product: expect.objectContaining({ specs: { brand: 'Pilot' } }),
        })]),
      },
    });
    expect(JSON.stringify(catalog.payload)).not.toMatch(/commission|sellerAppFee|restrictedReserve|internalSplit/);
    expect(await request('/partner-supply/orders', f.technicianA.actor, {
      deliveryAddressFa: 'نشانی تحویل سفارش تست', ...coordinates, items: [{ sellerOfferId: f.camera.offer.id, qty: 1 }],
    })).toMatchObject({ status: 201, payload: { status: 'FUNDED_RESERVED', goodsTotal: '1000009', freightTotal: bikeToman.toString() } });
  });

  it('shares the last unit atomically with a concurrent managed B2C submit', async () => {
    await db.sellerOffer.update({ where: { id: f.camera.offer.id }, data: { onHandQty: 1 } });
    const estimated = await orders.create(f.customer, { addressId: f.address.id, items: [{ serviceKey: 'CCTV' }] });
    const outcomes = await Promise.allSettled([checkout(f.camera.offer.id), orders.submit(f.customer, estimated.order.id)]);
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'fulfilled' }),
      { status: 'rejected', reason: expect.any(ConflictException) },
    ]));
    expect(await db.sellerOffer.findUniqueOrThrow({ where: { id: f.camera.offer.id } })).toMatchObject({ onHandQty: 1, reservedQty: 1 });
    const [positions, postings] = await Promise.all([
      db.escrowPosition.findMany(),
      db.walletTransaction.findMany({ where: { type: 'ESCROW_HOLD' } }),
    ]);
    expect(positions).toHaveLength(1);
    expect(postings).toHaveLength(1);
    const b2bWon = outcomes[0]?.status === 'fulfilled';
    expect(await db.b2BSupplyOrder.count({ where: { technicianUserId: f.technicianA.actor.id } })).toBe(b2bWon ? 1 : 0);
    expect(await db.serviceOrder.findUniqueOrThrow({ where: { id: estimated.order.id } })).toMatchObject({
      state: b2bWon ? 'ESTIMATED' : 'SEARCHING_EXPERT',
    });
    const losingWallet = b2bWon ? f.customerWallet.id : f.technicianA.wallet.id;
    expect(await readWallet(losingWallet)).toMatchObject({ balance: openingBalance, heldInEscrow: 0n });
  });

  it('rolls back a short-wallet checkout and refunds a funded cancellation once', async () => {
    await db.wallet.update({ where: { id: f.technicianA.wallet.id }, data: { balance: 0n } });
    await expect(checkout(f.camera.offer.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(await db.sellerOffer.findUniqueOrThrow({ where: { id: f.camera.offer.id } })).toMatchObject({ reservedQty: 0 });
    expect(await db.b2BSupplyOrder.count()).toBe(0);
    expect(await db.escrowPosition.count()).toBe(0);
    await db.wallet.update({ where: { id: f.technicianA.wallet.id }, data: { balance: openingBalance } });

    const order = await checkout(f.camera.offer.id);
    await expect(b2b.get(f.technicianB.actor, order.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(b2b.cancel(f.technicianB.actor, order.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await readWallet(f.technicianA.wallet.id)).toMatchObject({
      balance: openingBalance - order.grandTotal, heldInEscrow: order.grandTotal,
    });
    const replay = await Promise.all([b2b.cancel(f.technicianA.actor, order.id), b2b.cancel(f.technicianA.actor, order.id)]);
    expect(replay.map((item) => item.status)).toEqual(['CANCELLED', 'CANCELLED']);
    expect(replay[0]?.fulfillments).toMatchObject([{ status: 'CANCELLED' }]);
    expect(await db.sellerOffer.findUniqueOrThrow({ where: { id: f.camera.offer.id } })).toMatchObject({ onHandQty: 5, reservedQty: 0 });
    expect(await db.escrowPosition.findUniqueOrThrow({ where: { b2bSupplyOrderId: order.id } })).toMatchObject({ status: 'REFUNDED' });
    expect(await readWallet(f.technicianA.wallet.id)).toMatchObject({ balance: openingBalance, heldInEscrow: 0n });
    expect(await db.walletTransaction.count({ where: { b2bSupplyOrderId: order.id, type: 'REFUND' } })).toBe(1);
  });

  it('classifies whole seller loads and settles every Toman once after the final delivery', async () => {
    expect((await db.sellerProfile.findUniqueOrThrow({ where: { id: f.sellerB.profile.id } })).sellerAppFeeFlat).toBe(0n);
    const fee = 9_001n;
    await db.sellerProfile.update({ where: { id: f.sellerA.profile.id }, data: { sellerAppFeeFlat: fee } });
    const order = await checkout(f.camera.offer.id, f.cable.offer.id, f.recorder.offer.id);
    const bike = order.fulfillments.find(({ deliveryMode }) => deliveryMode === 'BIKE');
    const car = order.fulfillments.find(({ deliveryMode }) => deliveryMode === 'CAR');
    if (!bike || !car) throw new Error('Expected separate bike and car shipments');
    expect(bike).toMatchObject({ sellerId: f.sellerA.profile.id, freightCost: bikeToman });
    expect(bike.lines).toHaveLength(2);
    expect(car).toMatchObject({ sellerId: f.sellerB.profile.id, freightCost: carToman });
    expect(car.lines).toHaveLength(1);
    expect(order.freightTotal).toBe(bikeToman + carToman);
    expect(order.grandTotal).toBe(order.goodsTotal + order.freightTotal);
    await db.sellerProfile.update({ where: { id: f.sellerA.profile.id }, data: { sellerAppFeeFlat: fee * 2n } });
    await expect(b2b.dispatchFulfillment(f.sellerA.actor, car.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(b2b.confirmDelivery(f.sellerA.actor, car.id)).rejects.toBeInstanceOf(NotFoundException);

    expect(await b2b.confirmDelivery(f.sellerA.actor, bike.id)).toMatchObject({ status: 'DELIVERED', orderStatus: 'DISPATCHED' });
    await expect(b2b.cancel(f.technicianA.actor, order.id)).rejects.toBeInstanceOf(ConflictException);
    expect(await b2b.dispatchFulfillment(f.sellerB.actor, car.id)).toMatchObject({ status: 'DISPATCHED', orderStatus: 'DISPATCHED' });
    expect(await readWallet(f.sellerA.wallet.id)).toMatchObject({ balance: 0n });
    expect(await db.sellerOffer.findUniqueOrThrow({ where: { id: f.camera.offer.id } })).toMatchObject({ onHandQty: 4, reservedQty: 0 });
    const final = await Promise.all([b2b.confirmDelivery(f.technicianA.actor, car.id), b2b.confirmDelivery(f.sellerB.actor, car.id)]);
    expect(final).toMatchObject([{ orderStatus: 'DELIVERED' }, { orderStatus: 'DELIVERED' }]);
    expect(await db.sellerOffer.findUniqueOrThrow({ where: { id: f.recorder.offer.id } })).toMatchObject({ onHandQty: 4, reservedQty: 0 });
    expect(await db.escrowPosition.findUniqueOrThrow({ where: { b2bSupplyOrderId: order.id } })).toMatchObject({
      status: 'SETTLED', heldAmount: order.grandTotal, settledAmount: order.grandTotal,
    });
    expect(await readWallet(f.technicianA.wallet.id)).toMatchObject({ balance: openingBalance - order.grandTotal, heldInEscrow: 0n });
    expect(await readWallet(f.sellerA.wallet.id)).toMatchObject({ balance: f.camera.offer.partnerPrice + f.cable.offer.partnerPrice - fee });
    expect(await readWallet(f.sellerB.wallet.id)).toMatchObject({ balance: f.recorder.offer.partnerPrice });
    expect(await readWallet(f.platform.id)).toMatchObject({ balance: fee, restrictedReserve: 0n, restrictedFulfillment: order.freightTotal });
    const ledger = await db.walletTransaction.findMany({ where: { b2bSupplyOrderId: order.id, type: { not: 'ESCROW_HOLD' } } });
    expect(ledger.map(({ type }) => type).sort()).toEqual(['ESCROW_RELEASE', 'FULFILLMENT_ALLOCATION', 'SELLER_APP_FEE', 'SELLER_PAYOUT', 'SELLER_PAYOUT']);
    expect(ledger.reduce((sum, posting) => sum + posting.amount, 0n)).toBe(0n);
    expect(ledger.find(({ type }) => type === 'SELLER_APP_FEE')).toMatchObject({
      idempotencyKey: `b2b:fee:${order.id}:${f.sellerA.profile.id}`, amount: fee,
    });
  });
});
