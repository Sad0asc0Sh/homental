import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { classifyShipment, deliveryPolicySchema } from '@common/utils/delivery-policy';
import { PrismaService } from '@infra/prisma/prisma.service';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';
import { parseB2BLines, snapshotB2BLines, type B2BSupplyLine } from './b2b-supply-lines';
import type { CreateB2BSupplyOrderDto } from './dto/b2b-supply.dto';
import { confirmManagedFulfillment } from './managed-fulfillment-status';

type Db = Prisma.TransactionClient;

const supplyOrderInclude = {
  fulfillments: {
    orderBy: { id: 'asc' },
    include: { seller: { select: { shopNameFa: true, userId: true } } },
  },
  escrowPosition: { select: { id: true, heldAmount: true, payerWalletId: true, status: true } },
} satisfies Prisma.B2BSupplyOrderInclude;

type SupplyOrder = Prisma.B2BSupplyOrderGetPayload<{ include: typeof supplyOrderInclude }>;

const offerInclude = {
  product: true,
  seller: { select: { id: true, shopNameFa: true, sellerAppFeeFlat: true } },
} satisfies Prisma.SellerOfferInclude;

const publicSpecs = z.object({
  brand: z.string().optional(), model: z.string().optional(), color: z.string().optional(), material: z.string().optional(),
  resolution: z.string().optional(), dimensions: z.string().optional(), powerWatts: z.number().optional(),
  attributes: z.array(z.object({ labelFa: z.string(), valueFa: z.string() })).optional(),
});

const managedDelivery = z.object({ delivery: deliveryPolicySchema });
const MAX_LEDGER_AMOUNT = 9_223_372_036_854_775_807n;

function eligibleOffers(cityId: string): Prisma.SellerOfferWhereInput {
  return {
    isActive: true, product: { isActive: true },
    seller: { cityId, status: 'APPROVED', user: { role: 'SELLER', status: 'ACTIVE' } },
  };
}

function orderView(order: SupplyOrder) {
  const lines = parseB2BLines(order.linesJson);
  const { id, orderNumber, deliveryAddressFa, lat, lng, status, goodsTotal, freightTotal, grandTotal, createdAt, updatedAt } = order;
  return {
    id, orderNumber, deliveryAddressFa, lat, lng, status, goodsTotal, freightTotal, grandTotal, createdAt, updatedAt,
    fulfillments: order.fulfillments.map(({ id, sellerId, seller, deliveryMode, freightCost, status }) => ({
      id, sellerId, shopNameFa: seller.shopNameFa, deliveryMode, freightCost, status,
      lines: lines.filter((line) => line.sellerId === sellerId),
    })),
  };
}

@Injectable()
export class B2BSupplyService {
  constructor(private readonly prisma: PrismaService, private readonly wallet: WalletEscrowService) {}

  async catalog(actor: AuthenticatedUser) {
    const { branch } = await this.approvedTechnician(this.prisma, actor);
    const [offers, deliveryPolicy] = await Promise.all([
      this.prisma.sellerOffer.findMany({
        where: eligibleOffers(branch.cityId), include: offerInclude,
        orderBy: [{ product: { titleFa: 'asc' } }, { partnerPrice: 'asc' }, { id: 'asc' }],
      }),
      this.deliveryPolicy(this.prisma),
    ]);
    return {
      deliveryPolicy,
      items: offers.map(({ id, sellerId, sellerSku, partnerPrice, version, onHandQty, reservedQty, product, seller }) => {
        const { id: productId, sku, titleFa, unit, requiresSerial, weightGrams, volumeCm3, handlingClass } = product;
        const specs = publicSpecs.safeParse(product.specs);
        return {
          id, sellerId, sellerSku, partnerPrice, version, availableQty: onHandQty - reservedQty,
          seller: { id: seller.id, shopNameFa: seller.shopNameFa },
          product: { id: productId, sku, titleFa, unit, requiresSerial, weightGrams, volumeCm3, handlingClass, specs: specs.data ?? null },
        };
      }),
    };
  }

  async create(actor: AuthenticatedUser, input: CreateB2BSupplyOrderDto) {
    if (actor.role !== 'TECHNICIAN') throw new ForbiddenException();
    const quantities = new Map(input.items.map(({ sellerOfferId, qty }) => [sellerOfferId, qty]));
    if (!quantities.size || quantities.size !== input.items.length) {
      throw new BadRequestException('سبد تأمین باید دست‌کم یک قلم داشته باشد و اقلام تکراری نباشند.');
    }
    const order = await this.prisma.$transaction(async (db) => {
      const { branchId, branch } = await this.approvedTechnician(db, actor);
      const [offers, policy] = await Promise.all([
        db.sellerOffer.findMany({
          where: { ...eligibleOffers(branch.cityId), id: { in: [...quantities.keys()] } }, include: offerInclude, orderBy: { id: 'asc' },
        }),
        this.deliveryPolicy(db),
      ]);
      if (offers.length !== quantities.size) throw new ConflictException('برخی اقلام دیگر در شهر شما قابل تأمین نیستند.');
      type Shipment = { grossGoods: bigint; weight: bigint; volume: bigint; bulky: boolean; fee: bigint };
      const bySeller = new Map<string, Shipment>();
      const lines: B2BSupplyLine[] = [];
      for (const offer of offers) {
        const qty = quantities.get(offer.id);
        if (!qty || !Number.isInteger(qty) || qty < 0 || qty > 2_147_483_647) throw new BadRequestException('تعداد اقلام سفارش معتبر نیست.');
        await this.reserveOffer(db, offer, qty, branch.cityId);
        const { sku, titleFa, unit, weightGrams, volumeCm3, handlingClass } = offer.product;
        const lineTotal = offer.partnerPrice * BigInt(qty);
        lines.push({
          lineKey: `b2b:${offer.id}`, sellerOfferId: offer.id, sellerId: offer.sellerId, sku, titleFa, unit, qty,
          partnerUnitPrice: offer.partnerPrice, lineTotal,
        });
        const shipment = bySeller.get(offer.sellerId) ?? { grossGoods: 0n, weight: 0n, volume: 0n, bulky: false, fee: offer.seller.sellerAppFeeFlat };
        shipment.grossGoods += lineTotal;
        shipment.weight += BigInt(weightGrams) * BigInt(qty);
        shipment.volume += BigInt(volumeCm3) * BigInt(qty);
        shipment.bulky ||= handlingClass !== 'STANDARD';
        bySeller.set(offer.sellerId, shipment);
      }
      const fulfillments = [...bySeller].map(([sellerId, shipment]) => {
        if (shipment.fee < 0n) throw new InternalServerErrorException('کارمزد تأمین‌کننده معتبر نیست.');
        return { sellerId, ...classifyShipment(policy, shipment), sellerAppFee: shipment.fee < shipment.grossGoods ? shipment.fee : shipment.grossGoods };
      });
      const goodsTotal = lines.reduce((total, line) => total + line.lineTotal, 0n);
      const freightTotal = fulfillments.reduce((total, leg) => total + leg.freightCost, 0n);
      const grandTotal = goodsTotal + freightTotal;
      if (grandTotal <= 0n || grandTotal > MAX_LEDGER_AMOUNT) throw new BadRequestException('مبلغ سفارش تأمین خارج از محدوده مجاز است.');
      const created = await db.b2BSupplyOrder.create({
        data: {
          orderNumber: `B2B-${new Date().getFullYear()}-${randomInt(100_000, 1_000_000)}`,
          technicianUserId: actor.id, branchId, cityId: branch.cityId, deliveryAddressFa: input.deliveryAddressFa,
          lat: input.lat, lng: input.lng, goodsTotal, freightTotal, grandTotal, linesJson: snapshotB2BLines(lines),
          fulfillments: { createMany: { data: fulfillments } },
        },
      });
      const posting = await this.wallet.holdPartnerSupply({ orderId: created.id, technicianUserId: actor.id, amount: grandTotal }, db);
      await db.escrowPosition.create({ data: {
        b2bSupplyOrderId: created.id, payerWalletId: posting.walletId, heldAmount: grandTotal, activeRevision: 1,
      } });
      return db.b2BSupplyOrder.findUniqueOrThrow({ where: { id: created.id }, include: supplyOrderInclude });
    });
    return orderView(order);
  }

  async list(actor: AuthenticatedUser) {
    const rows = await this.prisma.b2BSupplyOrder.findMany({
      where: this.orderScope(actor), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: supplyOrderInclude,
    });
    return rows.map(orderView);
  }

  async get(actor: AuthenticatedUser, id: string) {
    const order = await this.prisma.b2BSupplyOrder.findFirst({ where: { id, ...this.orderScope(actor) }, include: supplyOrderInclude });
    if (!order) throw new NotFoundException('سفارش تأمین یافت نشد.');
    return orderView(order);
  }

  async cancel(actor: AuthenticatedUser, id: string) {
    if (actor.role !== 'TECHNICIAN') throw new ForbiddenException();
    const order = await this.prisma.$transaction(async (db) => {
      const order = await this.lockOrder(db, id, actor.id);
      if (order.status === 'CANCELLED') return order;
      if (order.status !== 'FUNDED_RESERVED' || order.fulfillments.some(({ status }) => status !== 'RESERVED')) {
        throw new ConflictException('پس از ارسال، لغو سفارش تأمین ممکن نیست.');
      }
      const position = order.escrowPosition;
      if (position?.status !== 'OPEN' || position.heldAmount !== order.grandTotal) {
        throw new ConflictException('امانت سفارش تأمین قابل بازگشت نیست.');
      }
      await this.releaseStock(db, parseB2BLines(order.linesJson), false);
      const posting = await this.wallet.refundPartnerSupply({ orderId: id, technicianUserId: actor.id, amount: position.heldAmount }, db);
      if (posting.walletId !== position.payerWalletId) throw new InternalServerErrorException('مالک امانت سفارش تأمین معتبر نیست.');
      await db.escrowPosition.update({ where: { id: position.id }, data: { status: 'REFUNDED' } });
      await db.supplyFulfillment.updateMany({ where: { b2bSupplyOrderId: id }, data: { status: 'CANCELLED' } });
      return db.b2BSupplyOrder.update({ where: { id }, data: { status: 'CANCELLED' }, include: supplyOrderInclude });
    });
    return orderView(order);
  }

  async dispatchFulfillment(actor: AuthenticatedUser, fulfillmentId: string) {
    if (actor.role !== 'SELLER') throw new ForbiddenException();
    return this.prisma.$transaction(async (db) => {
      const { order, shipment } = await this.lockShipment(db, actor, fulfillmentId);
      if (shipment.status === 'DISPATCHED') return { fulfillmentId, status: shipment.status, orderStatus: order.status };
      if (shipment.status !== 'RESERVED' || (order.status !== 'FUNDED_RESERVED' && order.status !== 'DISPATCHED')) {
        throw new ConflictException('این محموله قابل ارسال نیست.');
      }
      await db.supplyFulfillment.update({ where: { id: fulfillmentId }, data: { status: 'DISPATCHED' } });
      await db.b2BSupplyOrder.update({ where: { id: order.id }, data: { status: 'DISPATCHED' } });
      return { fulfillmentId, status: 'DISPATCHED' as const, orderStatus: 'DISPATCHED' as const };
    });
  }

  async confirmDelivery(actor: AuthenticatedUser, fulfillmentId: string) {
    if (actor.role !== 'TECHNICIAN' && actor.role !== 'SELLER') throw new ForbiddenException();
    const target = await this.prisma.supplyFulfillment.findUnique({ where: { id: fulfillmentId }, select: { b2bSupplyOrderId: true } });
    if (!target) throw new NotFoundException('محموله یافت نشد.');
    if (!target.b2bSupplyOrderId) return confirmManagedFulfillment(this.prisma, actor, fulfillmentId);
    return this.prisma.$transaction(async (db) => {
      const { order, shipment } = await this.lockShipment(db, actor, fulfillmentId);
      if (shipment.status === 'DELIVERED') return { fulfillmentId, status: shipment.status, orderStatus: order.status };
      if ((shipment.status !== 'RESERVED' && shipment.status !== 'DISPATCHED') ||
          (order.status !== 'FUNDED_RESERVED' && order.status !== 'DISPATCHED')) {
        throw new ConflictException('تحویل این محموله قابل ثبت نیست.');
      }
      const lines = parseB2BLines(order.linesJson);
      const shippedLines = lines.filter((line) => line.sellerId === shipment.sellerId);
      if (!shippedLines.length) throw new InternalServerErrorException('اقلام محموله تأمین یافت نشد.');
      await this.releaseStock(db, shippedLines, true);
      await db.supplyFulfillment.update({ where: { id: fulfillmentId }, data: { status: 'DELIVERED' } });
      const allDelivered = order.fulfillments.every((leg) => leg.id === fulfillmentId || leg.status === 'DELIVERED');
      if (!allDelivered) {
        if (order.status === 'FUNDED_RESERVED') {
          await db.b2BSupplyOrder.update({ where: { id: order.id }, data: { status: 'DISPATCHED' } });
        }
        return { fulfillmentId, status: 'DELIVERED' as const, orderStatus: 'DISPATCHED' as const };
      }
      await this.wallet.settlePartnerSupply({
        orderId: order.id, technicianUserId: order.technicianUserId, freightTotal: order.freightTotal,
        sellers: order.fulfillments.map((leg) => ({
          sellerId: leg.sellerId, userId: leg.seller.userId, appFee: leg.sellerAppFee ?? 0n,
          grossGoods: lines.filter(({ sellerId }) => sellerId === leg.sellerId).reduce((sum, { lineTotal }) => sum + lineTotal, 0n),
        })),
      }, db);
      await db.b2BSupplyOrder.update({ where: { id: order.id }, data: { status: 'DELIVERED' } });
      return { fulfillmentId, status: 'DELIVERED' as const, orderStatus: 'DELIVERED' as const };
    });
  }

  private async lockShipment(db: Db, actor: AuthenticatedUser, fulfillmentId: string) {
    const scope = actor.role === 'SELLER' ? { seller: { userId: actor.id } } : { b2bSupplyOrder: { technicianUserId: actor.id } };
    const parent = await db.supplyFulfillment.findFirst({ where: { id: fulfillmentId, ...scope }, select: { b2bSupplyOrderId: true } });
    if (!parent?.b2bSupplyOrderId) throw new NotFoundException('محموله یافت نشد.');
    const order = await this.lockOrder(db, parent.b2bSupplyOrderId);
    const shipment = order.fulfillments.find((leg) => leg.id === fulfillmentId);
    if (!shipment || (actor.role === 'SELLER' ? shipment.seller.userId !== actor.id : order.technicianUserId !== actor.id)) {
      throw new NotFoundException('محموله یافت نشد.');
    }
    return { order, shipment };
  }

  private async lockOrder(db: Db, id: string, technicianUserId?: string) {
    // Serialize checkout fulfillment progress, cancellation, and settlement at the aggregate root.
    const ownership = technicianUserId ? Prisma.sql`AND "technicianUserId" = ${technicianUserId}::uuid` : Prisma.empty;
    const [locked] = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "B2BSupplyOrder" WHERE "id" = ${id}::uuid ${ownership} FOR UPDATE
    `;
    if (!locked) throw new NotFoundException('سفارش تأمین یافت نشد.');
    const order = await db.b2BSupplyOrder.findFirst({ where: { id, technicianUserId }, include: supplyOrderInclude });
    if (!order) throw new NotFoundException('سفارش تأمین یافت نشد.');
    return order;
  }

  private async approvedTechnician(db: Db, actor: AuthenticatedUser) {
    if (actor.role !== 'TECHNICIAN') throw new ForbiddenException();
    const technician = await db.technicianProfile.findFirst({
      where: {
        userId: actor.id, status: 'APPROVED', user: { status: 'ACTIVE', role: 'TECHNICIAN' },
        branch: { isActive: true, city: { isActive: true } },
      },
      select: { branchId: true, branch: { select: { cityId: true } } },
    });
    if (!technician?.branchId || !technician.branch) throw new ForbiddenException('فروشگاه همکار فقط برای نصاب تأییدشده در شعبه فعال در دسترس است.');
    return { branchId: technician.branchId, branch: technician.branch };
  }

  private orderScope(actor: AuthenticatedUser): Prisma.B2BSupplyOrderWhereInput {
    if (actor.role === 'TECHNICIAN') return { technicianUserId: actor.id };
    if (actor.role === 'SUPER_ADMIN') return {};
    throw new ForbiddenException();
  }

  private async deliveryPolicy(db: Db) {
    const config = await db.platformConfig.findUnique({ where: { key: 'pricing.managed' } });
    const result = managedDelivery.safeParse(config?.value);
    if (!result.success) throw new InternalServerErrorException('تعرفه ارسال تأمین در دسترس نیست.');
    return result.data.delivery;
  }

  private async reserveOffer(db: Db, offer: { id: string; version: number; partnerPrice: bigint }, qty: number, cityId: string) {
    const changed = await db.$executeRaw`
      UPDATE "SellerOffer" AS offer SET "reservedQty" = "reservedQty" + ${qty}::integer
      WHERE offer."id" = ${offer.id}::uuid AND offer."version" = ${offer.version}::integer
        AND offer."isActive" AND offer."partnerPrice" = ${offer.partnerPrice}
        AND offer."onHandQty" - offer."reservedQty" >= ${qty}::integer
        AND EXISTS (SELECT 1 FROM "Product" WHERE "id" = offer."productId" AND "isActive")
        AND EXISTS (
          SELECT 1 FROM "SellerProfile" AS seller JOIN "User" AS account ON account."id" = seller."userId"
          WHERE seller."id" = offer."sellerId" AND seller."cityId" = ${cityId}::uuid AND seller."status" = 'APPROVED'
            AND account."status" = 'ACTIVE' AND account."role" = 'SELLER'
        )
    `;
    if (changed !== 1) throw new ConflictException('قیمت یا موجودی اقلام تغییر کرده است. سبد تأمین را دوباره بررسی کنید.');
  }

  private async releaseStock(db: Db, lines: B2BSupplyLine[], consumed: boolean) {
    const sorted = [...lines].sort((a, b) => a.sellerOfferId.localeCompare(b.sellerOfferId));
    for (const { sellerOfferId, sellerId, qty } of sorted) {
      const updated = await db.sellerOffer.updateMany({
        where: { id: sellerOfferId, sellerId, reservedQty: { gte: qty } },
        data: { reservedQty: { decrement: qty }, ...(consumed ? { onHandQty: { decrement: qty } } : {}) },
      });
      if (updated.count !== 1) throw new InternalServerErrorException('موجودی رزروشده سفارش تأمین کامل نیست.');
    }
  }
}
