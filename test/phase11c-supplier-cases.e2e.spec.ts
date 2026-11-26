import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException, ValidationPipe, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { User } from '@prisma/client';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { BigIntSerializerInterceptor } from '@common/interceptors/bigint-serializer.interceptor';
import type { AuthenticatedRequest, AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { SupplierCasesController } from '@modules/partner-supply/supplier-cases.controller';
import { SupplierCasesService } from '@modules/partner-supply/supplier-cases.service';
import { PLATFORM_WALLET_OWNER_ID } from '@modules/wallet-escrow/wallet-escrow.constants';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';

// Uses an empty disposable PostgreSQL/PostGIS database with migrations already deployed.
const databaseUrl = process.env['PHASE11C_CASES_TEST_DATABASE_URL'];
const describePostgres = databaseUrl ? describe : describe.skip;
const oldPrice = 100_001n;
const techBalance = 100_000n;
const sellerBalance = 1_000_000n;

function actor(user: User, branchId: string | null = null): AuthenticatedUser {
  return { id: user.id, role: user.role, phone: user.phone, branchId };
}

async function createFixtures(prisma: PrismaService) {
  const tag = randomUUID();
  return prisma.$transaction(async (db) => {
    const coordinates = { lat: 36.298, lng: 59.606 };
    const city = await db.city.create({ data: { slug: tag, nameFa: 'مشهد', nameEn: 'Mashhad', centerLat: coordinates.lat, centerLng: coordinates.lng } });
    const branch = await db.branch.create({ data: { code: tag, cityId: city.id, nameFa: 'شعبه تست', addressFa: 'مشهد', ...coordinates } });
    const buyer = await db.user.create({ data: { phone: `${tag}-buyer`, role: 'TECHNICIAN', status: 'ACTIVE' } });
    const outsider = await db.user.create({ data: { phone: `${tag}-other-tech`, role: 'TECHNICIAN', status: 'ACTIVE' } });
    await db.technicianProfile.create({ data: { userId: buyer.id, branchId: branch.id, status: 'APPROVED', skills: ['CCTV'] } });
    const techWallet = await db.wallet.create({ data: { ownerType: 'TECHNICIAN', ownerId: buyer.id, balance: techBalance } });
    const customer = await db.user.create({ data: { phone: `${tag}-customer`, role: 'CUSTOMER', status: 'ACTIVE' } });
    const customerProfile = await db.customerProfile.create({ data: { userId: customer.id } });
    const customerWallet = await db.wallet.create({ data: { ownerType: 'CUSTOMER', ownerId: customer.id } });
    const address = await db.address.create({ data: {
      customerId: customerProfile.id, cityId: city.id, titleFa: 'نشانی', fullAddressFa: 'مشهد', locationType: 'SHOP', ...coordinates,
    } });
    const seller = async (label: string) => {
      const user = await db.user.create({ data: { phone: `${tag}-${label}`, role: 'SELLER', status: 'ACTIVE' } });
      const profile = await db.sellerProfile.create({ data: {
        userId: user.id, cityId: city.id, branchId: branch.id, shopNameFa: `تأمین‌کننده ${label}`, addressFa: 'مشهد', status: 'APPROVED', ...coordinates,
      } });
      const wallet = await db.wallet.create({ data: { ownerType: 'SELLER', ownerId: user.id, balance: sellerBalance } });
      return { actor: actor(user, branch.id), profile, wallet };
    };
    const primary = await seller('seller-a');
    const secondary = await seller('seller-b');
    const makeOffer = async (sellerId: string, name: string, partnerPrice: bigint, unit: 'EACH' | 'METER' = 'EACH') => {
      const product = await db.product.create({ data: { sku: `${tag}-${name}`, serviceKey: 'CCTV', titleFa: 'کالا', unit } });
      const offer = await db.sellerOffer.create({ data: { sellerId, productId: product.id, sellerSku: product.sku, partnerPrice, onHandQty: 5 } });
      return { offer, product };
    };
    const original = await makeOffer(primary.profile.id, 'original', oldPrice);
    const low = await makeOffer(primary.profile.id, 'low', 70_001n);
    const high = await makeOffer(primary.profile.id, 'high', 220_003n);
    const foreign = await makeOffer(secondary.profile.id, 'foreign', 12n);
    const cable = await makeOffer(primary.profile.id, 'cable', 7_400n, 'METER');
    const lineKey = 'delivered-line';
    const b2bOrder = await db.b2BSupplyOrder.create({ data: {
      orderNumber: `case-fixture-${tag}`, cityId: city.id, branchId: branch.id, technicianUserId: buyer.id, deliveryAddressFa: 'مشهد',
      status: 'DELIVERED', goodsTotal: oldPrice * 2n, freightTotal: 30n, grandTotal: oldPrice * 2n + 30n, ...coordinates,
      linesJson: [{ lineKey, sellerOfferId: original.offer.id, sellerId: primary.profile.id, sku: original.product.sku,
        titleFa: original.product.titleFa, unit: 'EACH', qty: 2, partnerUnitPrice: oldPrice.toString(), lineTotal: (oldPrice * 2n).toString() }],
    } });
    const shipment = await db.supplyFulfillment.create({ data: {
      b2bSupplyOrderId: b2bOrder.id, sellerId: primary.profile.id, deliveryMode: 'BIKE', freightCost: 30n, status: 'DELIVERED',
    } });
    await db.escrowPosition.create({ data: {
      b2bSupplyOrderId: b2bOrder.id, payerWalletId: techWallet.id, heldAmount: b2bOrder.grandTotal,
      settledAmount: b2bOrder.grandTotal, activeRevision: 1, status: 'SETTLED',
    } });
    const managed = await db.serviceOrder.create({ data: {
      orderNumber: `case-managed-${tag}`, customerId: customer.id, technicianId: buyer.id, branchId: branch.id,
      addressId: address.id, locationType: 'SHOP', state: 'IN_PROGRESS', pricingVersion: 2,
    } });
    const managedShipment = await db.supplyFulfillment.create({ data: {
      orderId: managed.id, sellerId: primary.profile.id, deliveryMode: 'BIKE', freightCost: 30n, status: 'DELIVERED',
    } });
    await db.escrowPosition.create({ data: { orderId: managed.id, payerWalletId: customerWallet.id, heldAmount: 110_000n, activeRevision: 1 } });
    const revision = await db.orderPriceRevision.create({ data: {
      orderId: managed.id, revision: 1, pricingVersion: 2, status: 'FUNDED', policyVersion: 'test', bundleBps: 0,
      customerViewJson: {}, technicianTermsJson: {}, internalSplitJson: { commissionRate: '0.10', warrantyReserveAmount: '123' },
    } });
    await db.orderAddon.createMany({ data: [
      { lineKey: 'managed-fixed', revisionId: revision.id, fulfillmentId: managedShipment.id, kind: 'MATERIAL', bucket: 'FIXED',
        sellerOfferId: original.offer.id, sku: original.product.sku, titleFa: 'دوربین', unit: 'EACH', qty: 1, unitPrice: oldPrice, lineTotal: oldPrice },
      { lineKey: 'managed-cut', revisionId: revision.id, fulfillmentId: managedShipment.id, kind: 'MATERIAL', bucket: 'METERED',
        sellerOfferId: cable.offer.id, sku: cable.product.sku, titleFa: 'کابل', unit: 'METER', qty: 2, quantityCm: 125, unitPrice: 7_400n, lineTotal: 9_250n },
    ] });
    const platform = await db.wallet.create({ data: {
      ownerType: 'PLATFORM', ownerId: PLATFORM_WALLET_OWNER_ID, balance: 100n, restrictedReserve: 120n, restrictedFulfillment: 200n,
    } });
    return { city, branch, buyer: actor(buyer, branch.id), outsider: actor(outsider, branch.id), techWallet, customer, customerWallet,
      primary, secondary, original, low, high, foreign, cable, b2bOrder, shipment, lineKey, managed, managedShipment, platform };
  });
}

describePostgres('Phase 11C seller after-sales on PostgreSQL', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const send = jest.fn();
  let fixture: Awaited<ReturnType<typeof createFixtures>> | undefined;
  let app: INestApplication;
  let cases: SupplierCasesService;
  let wallet: WalletEscrowService;

  function rows() {
    if (!fixture) throw new Error('Test fixture missing');
    return fixture;
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SupplierCasesController], providers: [SupplierCasesService, WalletEscrowService,
        { provide: PrismaService, useValue: prisma }, { provide: NotificationsService, useValue: { send } }],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate(context: ExecutionContext) {
      const f = rows();
      const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
      req.user = [f.buyer, f.outsider, f.primary.actor, f.secondary.actor].find((caller) => caller.id === req.get('x-test-user'));
      return Boolean(req.user);
    } }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new BigIntSerializerInterceptor());
    await app.listen(0, '127.0.0.1');
    cases = module.get(SupplierCasesService);
    wallet = module.get(WalletEscrowService);
  });

  beforeEach(async () => {
    fixture = await createFixtures(prisma);
    send.mockClear();
  });

  afterEach(async () => {
    if (!fixture) return;
    const f = fixture;
    fixture = undefined;
    await prisma.$transaction(async (db) => {
      const walletIds = [f.techWallet, f.customerWallet, f.primary.wallet, f.secondary.wallet, f.platform].map(({ id }) => id);
      await db.walletTransaction.deleteMany({ where: { walletId: { in: walletIds } } });
      await db.supplierCase.deleteMany({ where: { technicianUserId: f.buyer.id } });
      await db.escrowPosition.deleteMany({ where: { payerWalletId: { in: walletIds } } });
      await db.supplyFulfillment.deleteMany({ where: { id: { in: [f.shipment.id, f.managedShipment.id] } } });
      await db.serviceOrder.delete({ where: { id: f.managed.id } });
      await db.b2BSupplyOrder.delete({ where: { id: f.b2bOrder.id } });
      await db.wallet.deleteMany({ where: { id: { in: walletIds } } });
      const products = [f.original, f.low, f.high, f.foreign, f.cable].map(({ product }) => product.id);
      await db.sellerOffer.deleteMany({ where: { productId: { in: products } } });
      await db.product.deleteMany({ where: { id: { in: products } } });
      await db.sellerProfile.deleteMany({ where: { id: { in: [f.primary.profile.id, f.secondary.profile.id] } } });
      await db.user.deleteMany({ where: { id: { in: [f.buyer.id, f.outsider.id, f.customer.id, f.primary.actor.id, f.secondary.actor.id] } } });
      await db.branch.delete({ where: { id: f.branch.id } });
      await db.city.delete({ where: { id: f.city.id } });
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  function openQuantity(type: 'UNUSED_RETURN' | 'EXCHANGE', requestedQty: number) {
    const f = rows();
    return cases.create(f.buyer, { type, sellerId: f.primary.profile.id, requestedQty, fulfillmentId: f.shipment.id, lineKey: f.lineKey, reasonFa: 'درخواست بررسی کالا' });
  }

  async function request(caller: AuthenticatedUser, suffix: string, body?: object) {
    const response = await fetch(`${await app.getUrl()}/api/v1/partner-supply/cases${suffix}`, {
      method: body ? 'POST' : 'GET', headers: { 'x-test-user': caller.id, 'content-type': 'application/json', connection: 'close' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload: unknown = await response.json();
    return { status: response.status, payload };
  }

  async function readStock(id: string) {
    return prisma.sellerOffer.findUniqueOrThrow({ where: { id }, select: { onHandQty: true, reservedQty: true } });
  }

  async function readBalance(id: string) {
    return (await prisma.wallet.findUniqueOrThrow({ where: { id }, select: { balance: true } })).balance;
  }

  it('serializes quantity claims, rejects broken seals and cut cable, and refunds the frozen price with one restock', async () => {
    const f = rows();
    await expect(openQuantity('UNUSED_RETURN', 3)).rejects.toThrow(ConflictException);
    const contenders = await Promise.allSettled([openQuantity('UNUSED_RETURN', 2), openQuantity('EXCHANGE', 2)]);
    const winner = contenders.find((result) => result.status === 'fulfilled');
    expect(contenders.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    if (!winner || winner.status !== 'fulfilled') throw new Error('Expected one successful request');
    await cases.resolve(f.primary.actor, winner.value.id, { status: 'CANCELLED' });
    const broken = await openQuantity('UNUSED_RETURN', 2);
    await expect(cases.resolve(f.primary.actor, broken.id, { status: 'INSPECTED_ACCEPTED', sealIntact: false }))
      .resolves.toMatchObject({ status: 'REJECTED', refundAmount: 0n, inspectionNoteFa: expect.any(String) });
    const cut = await openQuantity('UNUSED_RETURN', 2);
    await expect(cases.resolve(f.primary.actor, cut.id, { status: 'INSPECTED_ACCEPTED', sealIntact: true, cutCable: true }))
      .resolves.toMatchObject({ status: 'REJECTED', refundAmount: 0n });
    expect(await readBalance(f.techWallet.id)).toBe(techBalance);
    expect(await readBalance(f.primary.wallet.id)).toBe(sellerBalance);
    expect(await readStock(f.original.offer.id)).toEqual({ onHandQty: 5, reservedQty: 0 });

    const accepted = await openQuantity('UNUSED_RETURN', 2);
    await prisma.sellerOffer.update({ where: { id: f.original.offer.id }, data: { partnerPrice: 125_000n } });
    const decision = { status: 'INSPECTED_ACCEPTED', sealIntact: true, idempotencyKey: randomUUID() } as const;
    const replay = await Promise.all([cases.resolve(f.primary.actor, accepted.id, decision), cases.resolve(f.primary.actor, accepted.id, decision)]);
    expect(replay[1]).toEqual(replay[0]);
    expect(replay[0]).toMatchObject({ status: 'INSPECTED_ACCEPTED', approvedQty: 2, refundAmount: oldPrice * 2n });
    await expect(openQuantity('UNUSED_RETURN', 1)).rejects.toThrow(ConflictException);
    expect(await readBalance(f.techWallet.id)).toBe(techBalance + oldPrice * 2n);
    expect(await readBalance(f.primary.wallet.id)).toBe(sellerBalance - oldPrice * 2n);
    expect(await readStock(f.original.offer.id)).toEqual({ onHandQty: 7, reservedQty: 0 });
    const credits = await prisma.walletTransaction.findMany({ where: { b2bSupplyOrderId: f.b2bOrder.id }, orderBy: { amount: 'asc' } });
    expect(credits.map(({ type, amount, idempotencyKey }) => ({ type, amount, idempotencyKey }))).toEqual([
      { type: 'REFUND', amount: -(oldPrice * 2n), idempotencyKey: `case:refund:${accepted.id}:seller` },
      { type: 'REFUND', amount: oldPrice * 2n, idempotencyKey: `case:refund:${accepted.id}` },
    ]);
  });

  it('settles cheaper and dearer exchanges exactly, preserving stock and ledger when payment fails', async () => {
    const f = rows();
    const expensive = await openQuantity('EXCHANGE', 1);
    await expect(cases.resolve(f.primary.actor, expensive.id, { status: 'INSPECTED_ACCEPTED', replacementOfferId: f.foreign.offer.id }))
      .rejects.toThrow(NotFoundException);
    const decision = { status: 'INSPECTED_ACCEPTED', replacementOfferId: f.high.offer.id } as const;
    await expect(cases.resolve(f.primary.actor, expensive.id, decision)).rejects.toThrow(BadRequestException);
    expect(await readStock(f.original.offer.id)).toEqual({ onHandQty: 5, reservedQty: 0 });
    expect(await readStock(f.high.offer.id)).toEqual({ onHandQty: 5, reservedQty: 0 });
    expect(await readBalance(f.techWallet.id)).toBe(techBalance);
    expect(await prisma.supplierCase.findUnique({ where: { id: expensive.id }, select: { status: true } })).toEqual({ status: 'OPEN' });
    const positiveDelta = f.high.offer.partnerPrice - oldPrice;
    await wallet.topUp({ ownerType: 'TECHNICIAN', ownerId: f.buyer.id, amount: positiveDelta - techBalance, idempotencyKey: randomUUID() });
    await expect(cases.resolve(f.primary.actor, expensive.id, decision))
      .resolves.toMatchObject({ approvedQty: 1, priceDelta: positiveDelta, refundAmount: 0n });
    const cheaper = await openQuantity('EXCHANGE', 1);
    const negativeDelta = f.low.offer.partnerPrice - oldPrice;
    await expect(cases.resolve(f.primary.actor, cheaper.id, { status: 'RESOLVED', replacementOfferId: f.low.offer.id }))
      .resolves.toMatchObject({ approvedQty: 1, priceDelta: negativeDelta, refundAmount: -negativeDelta });
    expect(await readBalance(f.techWallet.id)).toBe(-negativeDelta);
    expect(await readBalance(f.primary.wallet.id)).toBe(sellerBalance + positiveDelta + negativeDelta);
    expect(await readStock(f.original.offer.id)).toEqual({ onHandQty: 7, reservedQty: 0 });
    expect(await readStock(f.low.offer.id)).toEqual({ onHandQty: 4, reservedQty: 0 });
    expect(await readStock(f.high.offer.id)).toEqual({ onHandQty: 4, reservedQty: 0 });
    expect(await prisma.wallet.findUnique({ where: { id: f.platform.id } }))
      .toMatchObject({ balance: 100n, restrictedReserve: 120n, restrictedFulfillment: 200n });
    const movements = await prisma.walletTransaction.findMany({ where: { b2bSupplyOrderId: f.b2bOrder.id, type: 'ADJUSTMENT' } });
    expect(movements).toHaveLength(4);
    expect(movements.reduce((total, { amount }) => total + amount, 0n)).toBe(0n);
  });

  it('accepts requests for delivered shipments before escrow settlement and gates their refund', async () => {
    const f = rows();
    const managed = { type: 'UNUSED_RETURN', fulfillmentId: f.managedShipment.id, sellerId: f.primary.profile.id,
      reasonFa: 'کالای کار استفاده نشده است', requestedQty: 1, lineKey: 'managed-fixed' } as const;
    const result = await cases.create(f.buyer, managed);
    const decision = { status: 'INSPECTED_ACCEPTED', sealIntact: true } as const;
    await expect(cases.resolve(f.primary.actor, result.id, decision)).rejects.toThrow(ConflictException);
    await prisma.escrowPosition.update({ where: { orderId: f.managed.id }, data: { status: 'SETTLED', settledAmount: 110_000n } });
    await expect(cases.resolve(f.primary.actor, result.id, decision)).resolves.toMatchObject({ refundAmount: oldPrice, serviceOrderId: f.managed.id });
    const cable = await cases.create(f.buyer, { ...managed, lineKey: 'managed-cut' });
    await expect(cases.resolve(f.primary.actor, cable.id, decision)).resolves.toMatchObject({ status: 'REJECTED', refundAmount: 0n });
    await expect(cases.create(f.outsider, managed)).rejects.toThrow(NotFoundException);
    expect(await readStock(f.cable.offer.id)).toEqual({ onHandQty: 5, reservedQty: 0 });

    await prisma.b2BSupplyOrder.update({ where: { id: f.b2bOrder.id }, data: { status: 'DISPATCHED' } });
    await prisma.escrowPosition.update({ where: { b2bSupplyOrderId: f.b2bOrder.id }, data: { status: 'OPEN', settledAmount: 0n } });
    const partial = await openQuantity('UNUSED_RETURN', 1);
    await expect(cases.resolve(f.primary.actor, partial.id, decision)).rejects.toThrow(ConflictException);
    expect(await readBalance(f.techWallet.id)).toBe(techBalance + oldPrice);
    await prisma.b2BSupplyOrder.update({ where: { id: f.b2bOrder.id }, data: { status: 'DELIVERED' } });
    await prisma.escrowPosition.update({ where: { b2bSupplyOrderId: f.b2bOrder.id }, data: { status: 'SETTLED', settledAmount: f.b2bOrder.grandTotal } });
    await expect(cases.resolve(f.primary.actor, partial.id, decision)).resolves.toMatchObject({ refundAmount: oldPrice, b2bSupplyOrderId: f.b2bOrder.id });
  });

  it('tracks repair custody and scopes technical guidance chat and projections to the two parties', async () => {
    const f = rows();
    const info = { type: 'REPAIR', sellerId: f.primary.profile.id, reasonFa: 'دستگاه روشن نمی‌شود.' } as const;
    await expect(cases.create(f.buyer, info)).rejects.toThrow(BadRequestException);
    const repair = await cases.create(f.buyer, { ...info, serialNumber: 'H-TEST-42' });
    await expect(cases.resolve(f.primary.actor, repair.id, { status: 'RESOLVED', inspectionNoteFa: 'تعمیر شد.' })).rejects.toThrow(BadRequestException);
    await expect(cases.resolve(f.primary.actor, repair.id, { status: 'IN_REVIEW', inspectionNoteFa: 'در مرکز تعمیر تحویل شد.' }))
      .resolves.toMatchObject({ status: 'IN_REVIEW' });
    await expect(cases.resolve(f.primary.actor, repair.id, { status: 'RESOLVED', inspectionNoteFa: 'برد تعویض و تست شد.' }))
      .resolves.toMatchObject({ status: 'RESOLVED', resolvedAt: expect.any(Date) });
    const guidance = await cases.create(f.buyer, { type: 'TECH_GUIDANCE', sellerId: f.primary.profile.id,
      sku: f.original.product.sku, reasonFa: 'روش نصب پایه چیست؟' });
    expect(guidance.messages).toEqual([{ senderRole: 'TECHNICIAN', textFa: 'روش نصب پایه چیست؟', at: expect.any(String) }]);
    await prisma.supplierCase.update({ where: { id: guidance.id }, data: { messagesJson: guidance.messages.map((message) => ({
      ...message, commission: 123, internalSplitJson: { warrantyReserveAmount: 44 },
    })) } });
    await expect(request(f.secondary.actor, '')).resolves.toEqual({ status: 200, payload: [] });
    await expect(request(f.secondary.actor, `/${guidance.id}/messages`, { textFa: 'پیام فروشنده دیگر' })).resolves.toMatchObject({ status: 404 });
    await expect(request(f.secondary.actor, `/${guidance.id}/resolve`, { status: 'RESOLVED' })).resolves.toMatchObject({ status: 404 });
    await expect(request(f.outsider, `/${guidance.id}/messages`, { textFa: 'تکنسین دیگر' })).resolves.toMatchObject({ status: 404 });
    const sent = await request(f.primary.actor, `/${guidance.id}/messages`, { textFa: 'از پایه استاندارد استفاده کنید.' });
    expect(sent).toMatchObject({ status: 201, payload: { id: guidance.id, messages: [expect.any(Object),
      { senderRole: 'SELLER', textFa: 'از پایه استاندارد استفاده کنید.', at: expect.any(String) }] } });
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ userId: f.buyer.id, data: expect.objectContaining({ caseId: guidance.id }) }));
    const own = await request(f.buyer, '');
    expect(own).toMatchObject({ status: 200, payload: expect.arrayContaining([expect.objectContaining({ id: guidance.id, status: 'OPEN' })]) });
    expect(JSON.stringify([own.payload, sent.payload])).not.toMatch(/commission|warrantyReserveAmount|internalSplitJson|idempotencyKey/);
  });
});
