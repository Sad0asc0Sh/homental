import { ConflictException, InternalServerErrorException } from '@nestjs/common';
import type { OrderAddon, OrderPriceRevision, Prisma, ServiceOrder } from '@prisma/client';
import { z } from 'zod';
import { serializeBigInts } from '@common/interceptors/bigint-serializer.interceptor';
import type { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';
import { dispatchPriorityPolicy } from '../dispatch/dispatch-priority-policy';
import { computeServicePackage, MANAGED_PRICING_VERSION, toSliderView } from '../pricing/managed-pricing';
import type { PricingService } from '../pricing/pricing.service';

type Db = Prisma.TransactionClient;
type RevisionOrder = Pick<ServiceOrder, 'id' | 'activeRevision' | 'pricingVersion'>;

const money = z.string().regex(/^\d+$/).transform((value) => BigInt(value));
const storedSplit = z.object({
  servicePackage: z.object({
    price: money, technicianPackageNet: money, commission: money, reserve: money,
    freight: money, allowance: money,
  }),
  shipments: z.array(z.object({
    sellerId: z.string(), sellerUserId: z.string(), deliveryMode: z.enum(['BIKE', 'CAR']),
    freightCost: money, grossGoods: money, ownAppFee: money, netReceivable: money,
  })),
  meteredLabor: money,
  total: money,
  offerVersions: z.record(z.number().int().positive()),
});

export function parseManagedSplit(value: Prisma.JsonValue) {
  const parsed = storedSplit.safeParse(value);
  if (!parsed.success) throw new InternalServerErrorException('اطلاعات مالی نسخه سفارش کامل نیست.');
  return parsed.data;
}

export function jsonSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(serializeBigInts(value))) as Prisma.InputJsonValue;
}

const repriceBasis = z.object({
  servicePackage: z.object({ wage: money, commissionBps: z.number().int().nonnegative() }),
}).passthrough();

const buyerSnapshot = z.object({
  invoice: z.object({
    buckets: z.array(z.object({ bucket: z.string() }).passthrough()),
  }).passthrough(),
}).passthrough();

const termsSnapshot = z.record(z.unknown());

export async function createManagedRevision(
  db: Db,
  orderId: string,
  price: Awaited<ReturnType<PricingService['estimateManaged']>>,
  orderItemIds: Map<string, string>,
) {
  const { customerView, internalSplit, materials, labor, tasks, packageLine } = price;
  const revision = await db.orderPriceRevision.create({
    data: {
      orderId, revision: 1, pricingVersion: MANAGED_PRICING_VERSION, status: 'DRAFT',
      policyVersion: price.policyVersion, bundleBps: price.bundleBps, sliderBps: customerView.slider.sliderBps,
      customerViewJson: jsonSnapshot(customerView),
      technicianTermsJson: jsonSnapshot({
        tasks,
        agreedPackageNet: internalSplit.servicePackage.technicianPackageNet,
        meteredLabor: internalSplit.meteredLabor,
        serialLineKeys: materials.filter((line) => line.requiresSerial).map((line) => line.lineKey),
      }),
      internalSplitJson: jsonSnapshot({
        ...internalSplit,
        offerVersions: Object.fromEntries(materials.map((line) => [line.sellerOfferId, line.offerVersion])),
      }),
    },
  });
  // Only persist the fields of each line that belong to the revision model.
  await db.orderAddon.createMany({
    data: [
      { ...packageLine, revisionId: revision.id, bucket: 'SERVICE_PACKAGE', kind: 'LABOR' },
      ...materials.map(({ lineKey, bucket, serviceKey, sku, titleFa, unit, qty, quantityCm, unitPrice, lineTotal, sellerOfferId }) => ({
        revisionId: revision.id, lineKey, bucket, kind: 'MATERIAL' as const,
        orderItemId: orderItemIds.get(serviceKey), sku, titleFa, unit, qty, quantityCm, unitPrice, lineTotal, sellerOfferId,
      })),
      ...labor.map(({ lineKey, serviceKey, rateCardId, titleFa, unit, qty, quantityCm, unitPrice, lineTotal }) => ({
        revisionId: revision.id, lineKey, bucket: 'METERED' as const, kind: 'LABOR' as const,
        orderItemId: orderItemIds.get(serviceKey), rateCardId, titleFa, unit, qty, quantityCm, unitPrice, lineTotal,
      })),
    ],
  });
}

export function activeManagedRevision(db: Db, order: RevisionOrder) {
  return db.orderPriceRevision.findUnique({
    where: { orderId_revision: { orderId: order.id, revision: order.activeRevision } },
    include: { addons: { include: { sellerOffer: { select: { sellerId: true } } } } },
  });
}

function quantitiesByOffer(
  lines: (Pick<OrderAddon, 'sellerOfferId' | 'qty' | 'unitPrice'> & { sellerOffer: { sellerId: string } | null })[],
) {
  const stock = new Map<string, { qty: number; partnerPrice: bigint; sellerId: string }>();
  for (const line of lines) {
    if (line.qty === 0 || !line.sellerOfferId || !line.sellerOffer) continue;
    const prior = stock.get(line.sellerOfferId);
    stock.set(line.sellerOfferId, {
      qty: (prior?.qty ?? 0) + line.qty, partnerPrice: line.unitPrice, sellerId: line.sellerOffer.sellerId,
    });
  }
  return [...stock].sort(([left], [right]) => left.localeCompare(right));
}

type ActiveRevision = NonNullable<Awaited<ReturnType<typeof activeManagedRevision>>>;

async function repriceDraftPackage(
  db: Db,
  revision: ActiveRevision,
  split: ReturnType<typeof parseManagedSplit>,
  sliderBps: number,
) {
  const basis = repriceBasis.safeParse(revision.internalSplitJson);
  const terms = termsSnapshot.safeParse(revision.technicianTermsJson);
  const buyer = buyerSnapshot.safeParse(revision.customerViewJson);
  const packageLines = revision.addons.filter(({ bucket }) => bucket === 'SERVICE_PACKAGE');
  const [packageLine] = packageLines;
  if (!basis.success || !buyer.success || !terms.success || packageLines.length !== 1 ||
      packageLine?.lineTotal !== split.servicePackage.price) {
    throw new InternalServerErrorException('نسخه پایه قیمت‌گذاری بسته کامل نیست.');
  }
  const { wage, commissionBps } = basis.data.servicePackage;
  const { freight, allowance, price: previousPrice } = split.servicePackage;
  const servicePackage = computeServicePackage(wage, freight, allowance, BigInt(commissionBps), BigInt(revision.bundleBps), sliderBps);
  const { price } = servicePackage;
  const total = split.total - previousPrice + price;
  const dispatch = await db.platformConfig.findUnique({ where: { key: 'dispatch.offer' } });
  const slider = toSliderView(servicePackage, dispatchPriorityPolicy(dispatch?.value).priorityThresholdBps);
  const { lineKey, titleFa, unit, qty } = packageLine;
  await db.orderAddon.update({ where: { id: packageLine.id }, data: { unitPrice: price, lineTotal: price } });
  return {
    total,
    revisionData: {
      sliderBps,
      customerViewJson: jsonSnapshot({
        ...buyer.data, slider, netEstimated: total, estimatedMin: total, estimatedMax: total,
        invoice: {
          ...buyer.data.invoice, total,
          buckets: buyer.data.invoice.buckets.map((bucket) => bucket.bucket === 'SERVICE_PACKAGE' ? {
            ...bucket, subtotal: price, lines: [{ lineKey, titleFa, unit, qty, unitPrice: price, lineTotal: price }],
          } : bucket),
        },
      }),
      technicianTermsJson: jsonSnapshot({ ...terms.data, agreedPackageNet: servicePackage.technicianPackageNet }),
      internalSplitJson: jsonSnapshot({ ...basis.data, servicePackage, total }),
    },
  };
}

export async function fundManagedOrder(db: Db, wallet: WalletEscrowService, order: ServiceOrder, sliderBps?: number) {
  const revision = await activeManagedRevision(db, order);
  if (!revision || revision.status !== 'DRAFT' || revision.pricingVersion !== order.pricingVersion ||
      (revision.expiresAt && revision.expiresAt <= new Date())) {
    throw new ConflictException('این برآورد دیگر قابل ثبت نیست. سفارش را دوباره برآورد کنید.');
  }
  const split = parseManagedSplit(revision.internalSplitJson);
  const draftTotal = revision.addons.reduce((sum, line) => sum + line.lineTotal, 0n);
  if (draftTotal !== split.total || draftTotal <= 0n) {
    throw new InternalServerErrorException('مبلغ صورتحساب با نسخه سفارش تطابق ندارد.');
  }
  const repriced = sliderBps !== undefined && sliderBps !== revision.sliderBps
    ? await repriceDraftPackage(db, revision, split, sliderBps)
    : undefined;
  const total = repriced?.total ?? draftTotal;
  const stock = quantitiesByOffer(revision.addons);
  for (const [offerId, { qty, partnerPrice }] of stock) {
    const updated = await db.$executeRaw`
      UPDATE "SellerOffer" AS offer
      SET "reservedQty" = "reservedQty" + ${qty}::integer
      WHERE offer."id" = ${offerId}::uuid AND offer."version" = ${split.offerVersions[offerId]}::integer
        AND offer."isActive" AND offer."partnerPrice" = ${partnerPrice}
        AND offer."onHandQty" - offer."reservedQty" >= ${qty}::integer
        AND EXISTS (SELECT 1 FROM "Product" WHERE "id" = offer."productId" AND "isActive")
        AND EXISTS (
          SELECT 1 FROM "SellerProfile" AS seller JOIN "User" AS account ON account."id" = seller."userId"
          WHERE seller."id" = offer."sellerId" AND seller."status" = 'APPROVED'
            AND account."status" = 'ACTIVE' AND account."role" = 'SELLER'
        )
    `;
    if (updated !== 1) throw new ConflictException('قیمت یا موجودی تجهیزات تغییر کرده است. سفارش را دوباره برآورد کنید.');
  }
  for (const shipment of split.shipments) {
    const fulfillment = await db.supplyFulfillment.create({
      data: {
        orderId: order.id, sellerId: shipment.sellerId, deliveryMode: shipment.deliveryMode,
        freightCost: shipment.freightCost,
      },
    });
    await db.orderAddon.updateMany({
      where: { revisionId: revision.id, sellerOfferId: { in: stock.filter(([, line]) => line.sellerId === shipment.sellerId).map(([id]) => id) } },
      data: { fulfillmentId: fulfillment.id },
    });
  }
  const posting = await wallet.holdEscrow({
    customerUserId: order.customerId, orderId: order.id, amount: total,
    idempotencyKey: `escrow:hold:${order.id}`,
  }, db);
  await db.escrowPosition.create({
    data: { orderId: order.id, payerWalletId: posting.walletId, heldAmount: total, activeRevision: order.activeRevision },
  });
  await db.orderPriceRevision.update({ where: { id: revision.id }, data: { ...repriced?.revisionData, status: 'FUNDED' } });
  await db.serviceOrder.update({ where: { id: order.id }, data: { finalQuoteAmount: total } });
}

async function releaseReservedStock(
  db: Db,
  revision: NonNullable<Awaited<ReturnType<typeof activeManagedRevision>>>,
  consumed: boolean,
) {
  for (const [id, { qty }] of quantitiesByOffer(revision.addons)) {
    const result = await db.sellerOffer.updateMany({
      where: { id, reservedQty: { gte: qty } },
      data: {
        reservedQty: { decrement: qty },
        ...(consumed ? { onHandQty: { decrement: qty } } : {}),
      },
    });
    if (result.count !== 1) throw new InternalServerErrorException('موجودی رزروشده سفارش کامل نیست.');
  }
}

export async function cancelManagedOrder(db: Db, wallet: WalletEscrowService, order: ServiceOrder, reason?: string) {
  const revision = await activeManagedRevision(db, order);
  if (!revision) throw new InternalServerErrorException('نسخه قیمت سفارش یافت نشد.');
  const position = await db.escrowPosition.findUnique({ where: { orderId: order.id } });
  if (revision.status === 'FUNDED') {
    if (!position || position.status !== 'OPEN' || position.activeRevision !== order.activeRevision) {
      throw new ConflictException('امانت این سفارش قابل بازگشت نیست.');
    }
    await releaseReservedStock(db, revision, false);
    const posting = await wallet.refundEscrow({
      customerUserId: order.customerId, orderId: order.id, amount: position.heldAmount,
      idempotencyKey: `escrow:refund:${order.id}`, reason,
    }, db);
    if (posting.walletId !== position.payerWalletId) throw new InternalServerErrorException('مالک امانت معتبر نیست.');
    await db.escrowPosition.update({ where: { id: position.id }, data: { status: 'REFUNDED' } });
    await db.supplyFulfillment.updateMany({ where: { orderId: order.id }, data: { status: 'CANCELLED' } });
  }
  await db.orderPriceRevision.update({ where: { id: revision.id }, data: { status: 'CANCELLED' } });
}

export async function settleManagedSupply(db: Db, wallet: WalletEscrowService, order: ServiceOrder, technicianUserId: string) {
  const revision = await activeManagedRevision(db, order);
  if (!revision || revision.status !== 'FUNDED') throw new ConflictException('نسخه تأمین مالی شده سفارش یافت نشد.');
  const { servicePackage, shipments, meteredLabor } = parseManagedSplit(revision.internalSplitJson);
  await releaseReservedStock(db, revision, true);
  const updated = await db.supplyFulfillment.updateMany({
    where: { orderId: order.id, status: { in: ['RESERVED', 'DISPATCHED', 'DELIVERED'] } },
    data: { status: 'DELIVERED' },
  });
  if (updated.count !== shipments.length) throw new InternalServerErrorException('اطلاعات ارسال سفارش کامل نیست.');
  return wallet.settleManagedOrder({
    orderId: order.id, revision: order.activeRevision, customerUserId: order.customerId, technicianUserId,
    technicianPayout: servicePackage.technicianPackageNet + meteredLabor,
    platformCommission: servicePackage.commission, warrantyReserve: servicePackage.reserve,
    fulfillmentAllocation: servicePackage.freight + servicePackage.allowance,
    sellers: shipments.map(({ sellerUserId, grossGoods, ownAppFee }) => ({ userId: sellerUserId, grossGoods, appFee: ownAppFee })),
  }, db);
}

export function managedSerialLineKeys(revision: Pick<OrderPriceRevision, 'technicianTermsJson'>): Set<string> {
  const terms = revision.technicianTermsJson as { serialLineKeys?: unknown } | null;
  const keys = terms?.serialLineKeys;
  if (!Array.isArray(keys) || !keys.every((key): key is string => typeof key === 'string')) {
    throw new InternalServerErrorException('فهرست سریال‌های نسخه سفارش کامل نیست.');
  }
  return new Set(keys);
}
