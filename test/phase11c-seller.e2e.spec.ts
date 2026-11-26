import { type ExecutionContext, type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { BigIntSerializerInterceptor } from '@common/interceptors/bigint-serializer.interceptor';
import type { AuthenticatedRequest, AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import { B2BSupplyController } from '@modules/partner-supply/b2b-supply.controller';
import { B2BSupplyService } from '@modules/partner-supply/b2b-supply.service';
import { SellerPortalController } from '@modules/partner-supply/seller-portal.controller';
import { SellerPortalService } from '@modules/partner-supply/seller-portal.service';
import { WalletController } from '@modules/wallet-escrow/wallet.controller';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';

// Use a dedicated, migrated and seeded Mashhad pilot database.
const url = process.env['PHASE11C_SELLER_TEST_DATABASE_URL'];
const sellerSuite = url ? describe : describe.skip;
const blockedKeys = /"(?:commission|commissionBps|commissionRate|platformCommission|warrantyReserveAmount|internalSplitJson|metadata|walletId)"/;

async function createFixtures(db: PrismaClient) {
  const [sellerA, sellerB, technician, customer] = await Promise.all([
    db.sellerProfile.findFirstOrThrow({ where: { user: { phone: '+989120000030' } } }),
    db.sellerProfile.findFirstOrThrow({ where: { user: { phone: '+989120000031' } } }),
    db.user.findUniqueOrThrow({ where: { phone: '+989120000010' } }),
    db.user.findUniqueOrThrow({ where: { phone: '+989120000020' } }),
  ]);
  const [offerA, offerB, address, definition] = await Promise.all([
    db.sellerOffer.findFirstOrThrow({ where: { sellerId: sellerA.id }, include: { product: true } }),
    db.sellerOffer.findFirstOrThrow({ where: { sellerId: sellerB.id }, include: { product: true } }),
    db.address.findFirstOrThrow({ where: { customer: { userId: customer.id } } }),
    db.serviceDefinition.findUniqueOrThrow({ where: { key: 'CCTV' } }),
  ]);
  const actors: Record<string, AuthenticatedUser> = {
    a: { id: sellerA.userId, role: 'SELLER', phone: '+989120000030', branchId: sellerA.branchId },
    b: { id: sellerB.userId, role: 'SELLER', phone: '+989120000031', branchId: sellerB.branchId },
    customer: { id: customer.id, role: 'CUSTOMER', phone: customer.phone, branchId: null },
  };
  const { b2b, forA, forB, order, managed, posting } = await db.$transaction(async (tx) => {
    const b2b = await tx.b2BSupplyOrder.create({ data: {
      orderNumber: `B2B-2026-${randomInt(100000, 1000000)}`, technicianUserId: technician.id,
      cityId: sellerA.cityId, branchId: sellerA.branchId, deliveryAddressFa: 'مشهد، نشانی تحویل آزمایشی',
      lat: address.lat, lng: address.lng, goodsTotal: 300n, freightTotal: 40n, grandTotal: 340n,
      linesJson: [
        { lineKey: 'a', sellerOfferId: offerA.id, sellerId: sellerA.id, sku: 'ONLY-A', titleFa: 'کالای فروشنده اول', unit: 'EACH', qty: 1,
          partnerUnitPrice: '100', lineTotal: '100', commission: 'poison' },
        { lineKey: 'b', sellerOfferId: offerB.id, sellerId: sellerB.id, sku: 'ONLY-B', titleFa: 'کالای فروشنده دوم', unit: 'EACH', qty: 1,
          partnerUnitPrice: '200', lineTotal: '200', platformCommission: 'poison' },
      ],
    } });
    const forA = await tx.supplyFulfillment.create({ data: {
      b2bSupplyOrderId: b2b.id, sellerId: sellerA.id, deliveryMode: 'BIKE', sellerAppFee: 10n, freightCost: 15n,
    } });
    const forB = await tx.supplyFulfillment.create({ data: {
      b2bSupplyOrderId: b2b.id, sellerId: sellerB.id, deliveryMode: 'CAR', sellerAppFee: 20n, freightCost: 25n,
    } });
    const order = await tx.serviceOrder.create({ data: {
      orderNumber: `HM-2026-${randomInt(100000, 1000000)}`, customerId: customer.id, technicianId: technician.id,
      branchId: sellerA.branchId, addressId: address.id, state: 'IN_PROGRESS', pricingVersion: 2,
      locationType: address.locationType,
    } });
    const item = await tx.orderItem.create({ data: { orderId: order.id, serviceDefinitionId: definition.id, config: {} } });
    const managed = await tx.supplyFulfillment.create({ data: {
      orderId: order.id, sellerId: sellerA.id, deliveryMode: 'CAR', freightCost: 30n,
    } });
    const revision = await tx.orderPriceRevision.create({ data: {
      orderId: order.id, revision: 1, status: 'FUNDED', pricingVersion: 2, policyVersion: 'seller-test', bundleBps: 0,
      customerViewJson: {}, technicianTermsJson: {},
      internalSplitJson: { servicePackage: { commissionRate: 'poison', warrantyReserveAmount: 'poison' },
        shipments: [{ sellerId: sellerA.id, ownAppFee: '7' }, { sellerId: sellerB.id, ownAppFee: '9' }] },
    } });
    await tx.orderAddon.create({ data: {
      revisionId: revision.id, orderItemId: item.id, fulfillmentId: managed.id, sellerOfferId: offerA.id,
      lineKey: 'managed-a', sku: 'OWN-MANAGED', titleFa: 'قلم سفارش نصب', bucket: 'METERED', kind: 'MATERIAL',
      unit: 'METER', qty: 2, quantityCm: 125, unitPrice: 100n, lineTotal: 125n,
    } });
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { ownerType_ownerId: { ownerType: 'SELLER', ownerId: sellerA.userId } } });
    const posting = await tx.walletTransaction.create({ data: {
      walletId: wallet.id, b2bSupplyOrderId: b2b.id, type: 'SELLER_PAYOUT', amount: 90n, balanceAfter: 90n,
      metadata: { commission: 'poison', otherSellerUserId: sellerB.userId },
    } });
    return { b2b, forA, forB, order, managed, posting };
  });
  return { sellerA, sellerB, offerA, offerB, actors, b2b, forA, forB, order, managed, posting };
}

sellerSuite('Phase 11C — seller portal on PostgreSQL', () => {
  let db: PrismaClient;
  let fixtures: Awaited<ReturnType<typeof createFixtures>>;
  let app: INestApplication;
  let baseUrl: string;
  let newOfferId: string | undefined;
  const newSku = `seller-test-${randomUUID()}`;

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    fixtures = await createFixtures(db);
    const module = await Test.createTestingModule({
      controllers: [SellerPortalController, B2BSupplyController, WalletController],
      providers: [SellerPortalService, B2BSupplyService, WalletEscrowService, { provide: PrismaService, useValue: db }],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate(ctx: ExecutionContext) {
        const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
        request.user = fixtures.actors[request.get('x-test-actor') ?? ''];
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

  afterAll(async () => {
    try {
      await app?.close();
      if (fixtures) {
        await db.walletTransaction.delete({ where: { id: fixtures.posting.id } });
        await db.supplyFulfillment.deleteMany({ where: { id: { in: [fixtures.forA.id, fixtures.forB.id, fixtures.managed.id] } } });
        await db.b2BSupplyOrder.delete({ where: { id: fixtures.b2b.id } });
        await db.serviceOrder.delete({ where: { id: fixtures.order.id } });
        await db.sellerOffer.deleteMany({ where: { sellerId: fixtures.sellerA.id, sellerSku: newSku } });
      }
    } finally {
      await db?.$disconnect();
    }
  });

  async function request(actor: 'a' | 'b' | 'customer', path: string, method = 'GET', body?: object) {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method, headers: { 'x-test-actor': actor, 'content-type': 'application/json', connection: 'close' },
      body: body && JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as unknown };
  }

  it('scopes seller profile, offer reads and writes, and rejects stale versions and stock below reservations', async () => {
    const { sellerA, offerA, offerB } = fixtures;
    expect(await request('customer', '/seller/profile')).toMatchObject({ status: 403 });
    expect(await request('a', '/seller/profile')).toMatchObject({ status: 200, body: { id: sellerA.id, sellerAppFeeFlat: '0' } });
    const offers = await request('a', '/seller/offers');
    expect(offers).toMatchObject({ status: 200, body: expect.arrayContaining([expect.objectContaining({ id: offerA.id })]) });
    expect(JSON.stringify(offers.body)).not.toContain(offerB.id);
    expect(await request('a', `/seller/offers/${offerB.id}`, 'PATCH', { version: offerB.version, onHandQty: 0 })).toMatchObject({ status: 404 });
    expect(await request('a', '/seller/products')).toMatchObject({ status: 200, body: expect.arrayContaining([expect.objectContaining({ id: offerA.productId })]) });

    const created = await request('a', '/seller/offers', 'POST', {
      productId: offerA.productId, sellerSku: newSku, partnerPrice: '9007199254740993', onHandQty: 5,
    });
    expect(created).toMatchObject({ status: 201, body: { sellerSku: newSku, partnerPrice: '9007199254740993', version: 1 } });
    const saved = await db.sellerOffer.findUniqueOrThrow({ where: { sellerId_sellerSku: { sellerId: sellerA.id, sellerSku: newSku } } });
    newOfferId = saved.id;
    await db.sellerOffer.update({ where: { id: newOfferId }, data: { reservedQty: 2 } });
    const path = `/seller/offers/${newOfferId}`;
    expect(await request('a', path, 'PATCH', { version: 1, onHandQty: 1 })).toMatchObject({ status: 409 });
    expect(await request('a', path, 'PATCH', { version: 1, onHandQty: 3, isActive: false })).toMatchObject({
      status: 200, body: { version: 2, availableQty: 1, isActive: false },
    });
    expect(await request('a', path, 'PATCH', { version: 1, partnerPrice: '100' })).toMatchObject({ status: 409 });
  });

  it('shows only own B2C/B2B shipments and own wallet data, including during dispatch and delivery', async () => {
    const { forA, forB, managed, posting, sellerB } = fixtures;
    const [a, b, wallet] = await Promise.all([
      request('a', '/seller/fulfillments'), request('b', '/seller/fulfillments'), request('a', '/wallet/me'),
    ]);
    expect(a).toMatchObject({ status: 200, body: expect.arrayContaining([
      expect.objectContaining({ fulfillmentId: forA.id, orderKind: 'B2B', deliveryMode: 'BIKE', netReceivable: '90', lines: [expect.objectContaining({ sku: 'ONLY-A' })] }),
      expect.objectContaining({ fulfillmentId: managed.id, orderKind: 'B2C', deliveryMode: 'CAR', netReceivable: '118', lines: [expect.objectContaining({ quantityCm: 125 })] }),
    ]) });
    expect(b).toMatchObject({ status: 200, body: [expect.objectContaining({ fulfillmentId: forB.id, netReceivable: '180', lines: [expect.objectContaining({ sku: 'ONLY-B' })] })] });
    expect(JSON.stringify(a.body)).not.toMatch(new RegExp(`${forB.id}|ONLY-B`));
    expect(JSON.stringify(b.body)).not.toContain(forA.id);
    expect(JSON.stringify(wallet.body)).toContain(posting.id);
    expect(JSON.stringify(wallet.body)).not.toContain(sellerB.userId);
    expect(JSON.stringify([a.body, b.body, wallet.body])).not.toMatch(blockedKeys);
    expect(await request('a', `/seller/fulfillments/${forB.id}/dispatch`, 'PATCH')).toMatchObject({ status: 404 });
    expect(await request('a', `/partner-supply/fulfillments/${forB.id}/confirm-delivery`, 'POST')).toMatchObject({ status: 404 });
    expect(await request('a', `/seller/fulfillments/${managed.id}/dispatch`, 'PATCH')).toMatchObject({ status: 200, body: { status: 'DISPATCHED' } });
    expect(await request('a', `/partner-supply/fulfillments/${managed.id}/confirm-delivery`, 'POST')).toMatchObject({ status: 201, body: { status: 'DELIVERED' } });
  });

  it('rejects missing and multiple shipment or escrow parents at the database boundary', async () => {
    const { b2b, order, sellerA } = fixtures;
    const wallet = await db.wallet.findFirstOrThrow({ where: { ownerType: 'SELLER', ownerId: sellerA.userId } });
    const shipment = { sellerId: sellerA.id, deliveryMode: 'BIKE' as const, freightCost: 0n };
    const escrow = { payerWalletId: wallet.id, heldAmount: 1n, activeRevision: 1 };
    await expect(db.supplyFulfillment.create({ data: shipment })).rejects.toThrow('SupplyFulfillment_exactly_one_parent');
    await expect(db.supplyFulfillment.create({ data: { ...shipment, orderId: order.id, b2bSupplyOrderId: b2b.id } })).rejects.toThrow('SupplyFulfillment_exactly_one_parent');
    await expect(db.escrowPosition.create({ data: escrow })).rejects.toThrow('EscrowPosition_exactly_one_parent');
    await expect(db.escrowPosition.create({ data: { ...escrow, orderId: order.id, b2bSupplyOrderId: b2b.id } })).rejects.toThrow('EscrowPosition_exactly_one_parent');
  });
});
