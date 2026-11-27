import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException,
} from '@nestjs/common';
import { Prisma, type EscrowPosition, type ServiceOrder } from '@prisma/client';
import { WalletShortfallException } from '@common/errors/wallet-shortfall.exception';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RealtimeEvent, RealtimeService } from '@infra/realtime/realtime.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';
import { MANAGED_PRICING_VERSION } from '../pricing/managed-pricing';
import { MAX_QUANTITY_CM, meteredLineAmount, meteredStockQty } from '../pricing/metered-quantity';
import type { ApproveMeteredAdjustmentDto, SubmitMeterReadingsDto } from './dto/metered-adjustments.dto';
import { activeManagedRevision, jsonSnapshot, parseManagedSplit } from './managed-order-economics';
import { parseMeterReadings, toMeteredAdjustmentView, toTechnicianMeteredAdjustmentView } from './metered-adjustment-view';

type Db = Prisma.TransactionClient;
type Revision = NonNullable<Awaited<ReturnType<typeof activeManagedRevision>>>;
type Reading = ReturnType<typeof parseMeterReadings>[number];
type AdjustmentView = ReturnType<typeof toMeteredAdjustmentView>;

const MAX_MONEY = 9_223_372_036_854_775_807n;
export const newestMeteredAdjustment = [{ createdAt: 'desc' }, { id: 'desc' }] satisfies Prisma.OrderMeteredAdjustmentOrderByWithRelationInput[];

export async function assertMeteredReconciled(db: Db, order: Pick<ServiceOrder, 'id' | 'activeRevision' | 'pricingVersion'>) {
  if (order.pricingVersion !== MANAGED_PRICING_VERSION) return;
  const pending = await db.orderMeteredAdjustment.findFirst({ where: { orderId: order.id, status: 'PENDING_APPROVAL' }, select: { id: true } });
  if (pending) throw new BadRequestException('مابه‌التفاوت متراژ در انتظار تأیید مشتری است.');
  const revision = await activeManagedRevision(db, order);
  if (!revision || revision.status !== 'FUNDED') throw new ConflictException('نسخه تأمین مالی شده سفارش یافت نشد.');
  if (!revision.addons.some(({ bucket }) => bucket === 'METERED')) return;
  const latest = await db.orderMeteredAdjustment.findFirst({
    where: { orderId: order.id }, orderBy: newestMeteredAdjustment,
  });
  if (latest?.resultingRevision !== order.activeRevision || (latest.status !== 'APPROVED' && latest.status !== 'AUTO_REFUNDED')) {
    throw new BadRequestException('پیش از تحویل، متراژ واقعی تمام اقلام متری باید تأیید شود.');
  }
  const reconciled = new Set(parseMeterReadings(latest.readingsJson).map(({ lineKey }) => lineKey));
  if (revision.addons.some(({ bucket, lineKey }) => bucket === 'METERED' && !reconciled.has(lineKey))) {
    throw new BadRequestException('پیش از تحویل، متراژ واقعی تمام اقلام متری باید تأیید شود.');
  }
}

function objectSnapshot(value: Prisma.JsonValue): Prisma.JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InternalServerErrorException('اطلاعات نسخه سفارش کامل نیست.');
  }
  return value;
}

function validatedReadings(input: Reading[], revision: Revision) {
  const metered = revision.addons.filter(({ bucket, unit }) => bucket === 'METERED' && unit === 'METER');
  const keys = new Set(metered.map(({ lineKey }) => lineKey));
  if (!keys.size || input.length !== keys.size) throw new BadRequestException('متراژ واقعی تمام اقلام متری را ثبت کنید.');
  for (const { lineKey, actualCm, photoAssetId } of input) {
    if (!keys.delete(lineKey) || !Number.isInteger(actualCm) || actualCm < 0 || actualCm > MAX_QUANTITY_CM || !photoAssetId.trim()) {
      throw new BadRequestException('قلم متری تکراری یا نامعتبر است، یا متراژ و مرجع عکس کامل نیست.');
    }
  }
  return input.map(({ lineKey, actualCm, photoAssetId }) => ({ lineKey, actualCm, photoAssetId: photoAssetId.trim() }))
    .sort((left, right) => left.lineKey.localeCompare(right.lineKey));
}

function calculateRevision(revision: Revision, heldAmount: bigint, readings: Reading[]) {
  const split = parseManagedSplit(revision.internalSplitJson);
  if (split.total !== heldAmount || revision.addons.reduce((sum, line) => sum + line.lineTotal, 0n) !== heldAmount) {
    throw new InternalServerErrorException('مبلغ امانت با نسخه فعال سفارش تطابق ندارد.');
  }

  const actual = new Map(readings.map(({ lineKey, actualCm }) => [lineKey, actualCm]));
  const goodsBySeller = new Map<string, bigint>();
  const stockChanges = new Map<string, number>();
  let meteredLabor = 0n;
  let total = 0n;
  const lines = revision.addons.map((base) => {
    const actualCm = actual.get(base.lineKey);
    const line = actualCm === undefined ? base : {
      ...base, quantityCm: actualCm, qty: meteredStockQty(actualCm), lineTotal: meteredLineAmount(actualCm, base.unitPrice),
    };
    if (line.sellerOffer) {
      const { sellerId } = line.sellerOffer;
      goodsBySeller.set(sellerId, (goodsBySeller.get(sellerId) ?? 0n) + line.lineTotal);
    }
    if (line.sellerOfferId && line.qty !== base.qty) {
      stockChanges.set(line.sellerOfferId, (stockChanges.get(line.sellerOfferId) ?? 0) + line.qty - base.qty);
    }
    if (line.kind === 'LABOR' && line.bucket === 'METERED') meteredLabor += line.lineTotal;
    total += line.lineTotal;
    return line;
  });

  if (total > MAX_MONEY) throw new BadRequestException('متراژ ثبت‌شده خارج از محدوده مبلغ مجاز سفارش است.');
  const shipments = split.shipments.map((shipment) => {
    const grossGoods = goodsBySeller.get(shipment.sellerId) ?? 0n;
    const ownAppFee = shipment.ownAppFee > grossGoods ? grossGoods : shipment.ownAppFee;
    return { ...shipment, grossGoods, ownAppFee, netReceivable: grossGoods - ownAppFee };
  });
  const expected = split.servicePackage.price + meteredLabor + shipments.reduce((sum, shipment) => sum + shipment.grossGoods, 0n);
  if (expected !== total) throw new InternalServerErrorException('تراز مبالغ متری سفارش نامعتبر است.');
  const stock = [...stockChanges].filter(([, change]) => change !== 0).sort(([left], [right]) => left.localeCompare(right));
  return { lines, shipments, meteredLabor, total, delta: total - heldAmount, stock };
}

type Reconciliation = ReturnType<typeof calculateRevision>;

async function reserveActualStock(db: Db, stock: Reconciliation['stock']) {
  for (const [id, change] of stock) {
    const updated = await db.$executeRaw`
      UPDATE "SellerOffer" SET "reservedQty" = "reservedQty" + ${change}::integer
      WHERE "id" = ${id}::uuid AND ("reservedQty"::bigint + ${change}::integer) BETWEEN 0 AND "onHandQty"
    `;
    if (updated !== 1) throw new ConflictException('موجودی تأمین‌کننده برای متراژ ثبت‌شده کافی نیست.');
  }
}

function revisedCustomerSnapshot(revision: Revision, calculation: Reconciliation) {
  const customerView = objectSnapshot(revision.customerViewJson);
  const oldInvoice = customerView['invoice'];
  const invoice = oldInvoice === undefined ? {} : objectSnapshot(oldInvoice);
  const oldBuckets = invoice['buckets'];
  const buckets = (Array.isArray(oldBuckets) ? oldBuckets : []).map((item) => {
    const snapshot = objectSnapshot(item);
    const matching = calculation.lines.filter(({ bucket }) => bucket === snapshot['bucket']);
    return {
      ...snapshot,
      subtotal: matching.reduce((sum, line) => sum + line.lineTotal, 0n),
      lines: matching.map(({ lineKey, sku, titleFa, unit, qty, quantityCm, unitPrice, lineTotal }) => ({
        lineKey, sku, titleFa, unit, qty, quantityCm, unitPrice, lineTotal,
      })),
    };
  });
  return jsonSnapshot({
    ...customerView, invoice: { buckets, total: calculation.total },
    estimatedMin: calculation.total, estimatedMax: calculation.total, netEstimated: calculation.total,
  });
}

function revisedSnapshots(revision: Revision, calculation: Reconciliation) {
  return {
    customerViewJson: revisedCustomerSnapshot(revision, calculation),
    technicianTermsJson: jsonSnapshot({ ...objectSnapshot(revision.technicianTermsJson), meteredLabor: calculation.meteredLabor }),
    internalSplitJson: jsonSnapshot({
      ...objectSnapshot(revision.internalSplitJson), shipments: calculation.shipments, meteredLabor: calculation.meteredLabor, total: calculation.total,
    }),
  };
}

@Injectable()
export class MeteredAdjustmentsService {
  private readonly logger = new Logger(MeteredAdjustmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletEscrowService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async submit(actor: AuthenticatedUser, orderId: string, dto: SubmitMeterReadingsDto) {
    if (actor.role !== 'TECHNICIAN') throw new ForbiddenException();
    const result = await this.prisma.$transaction(async (db) => {
      const order = await this.lockVisibleOrder(db, orderId, { technicianId: actor.id });
      const { revision, escrow } = await this.activePosition(db, order);
      const readings = validatedReadings(dto.readings, revision);
      const latest = await db.orderMeteredAdjustment.findFirst({ where: { orderId }, orderBy: newestMeteredAdjustment });
      if (latest?.status === 'PENDING_APPROVAL') throw new ConflictException('متراژ دیگری در انتظار تأیید مشتری است.');
      if (latest?.resultingRevision === order.activeRevision && JSON.stringify(parseMeterReadings(latest.readingsJson)) === JSON.stringify(readings)) {
        const base = await this.baseRevision(db, orderId, latest.baseRevision);
        return { order, adjustment: toMeteredAdjustmentView(latest, base.addons), replay: true };
      }
      const calculation = calculateRevision(revision, escrow.heldAmount, readings);
      let resultingRevision = calculation.delta > 0n ? null : order.activeRevision;
      if (calculation.delta < 0n) {
        resultingRevision = await this.applyRevision(db, order, revision, escrow, calculation);
      } else if (calculation.delta === 0n) {
        // Offset changes can leave the invoice total unchanged while shifting individual line amounts.
        const baseById = new Map(revision.addons.map((line) => [line.id, line]));
        const changed = calculation.lines.filter(({ id, quantityCm }) => quantityCm !== baseById.get(id)?.quantityCm);
        if (changed.length) {
          await reserveActualStock(db, calculation.stock);
          for (const { id, qty, quantityCm, lineTotal } of changed) {
            await db.orderAddon.update({ where: { id }, data: { qty, quantityCm, lineTotal } });
          }
          await db.orderPriceRevision.update({ where: { id: revision.id }, data: revisedSnapshots(revision, calculation) });
        }
      }
      const adjustment = await db.orderMeteredAdjustment.create({
        data: {
          orderId, baseRevision: order.activeRevision, resultingRevision, submittedByUserId: actor.id,
          readingsJson: jsonSnapshot(readings), deltaAmount: calculation.delta,
          status: calculation.delta > 0n ? 'PENDING_APPROVAL' : calculation.delta < 0n ? 'AUTO_REFUNDED' : 'APPROVED',
          createdAt: new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1)),
        },
      });
      return { order, adjustment: toMeteredAdjustmentView(adjustment, revision.addons), replay: false };
    });
    if (!result.replay) await this.publish(result.order, result.adjustment, 'CUSTOMER');
    return toTechnicianMeteredAdjustmentView(result.adjustment);
  }

  async approve(actor: AuthenticatedUser, orderId: string, adjustmentId: string, dto: ApproveMeteredAdjustmentDto) {
    if (actor.role !== 'CUSTOMER') throw new ForbiddenException();
    const result = await this.prisma.$transaction(async (db) => {
      const order = await this.lockVisibleOrder(db, orderId, { customerId: actor.id });
      const adjustment = await db.orderMeteredAdjustment.findFirst({ where: { id: adjustmentId, orderId } });
      if (!adjustment) throw new NotFoundException('درخواست اصلاح متراژ یافت نشد.');
      if (adjustment.status === 'APPROVED' && adjustment.idempotencyKey === dto.idempotencyKey) {
        const base = await this.baseRevision(db, orderId, adjustment.baseRevision);
        return { order, adjustment: toMeteredAdjustmentView(adjustment, base.addons), replay: true };
      }
      if (adjustment.status !== 'PENDING_APPROVAL' || adjustment.baseRevision !== order.activeRevision) {
        throw new ConflictException('این اصلاح متراژ دیگر قابل تأیید نیست.');
      }
      if (await db.orderMeteredAdjustment.findUnique({ where: { idempotencyKey: dto.idempotencyKey }, select: { id: true } })) {
        throw new ConflictException('شناسه یکتای تأیید قبلاً استفاده شده است.');
      }
      const { revision, escrow } = await this.activePosition(db, order);
      const calculation = calculateRevision(revision, escrow.heldAmount, parseMeterReadings(adjustment.readingsJson));
      if (calculation.delta !== adjustment.deltaAmount || calculation.delta <= 0n) {
        throw new InternalServerErrorException('مبلغ مابه‌التفاوت اصلاح متراژ نامعتبر است.');
      }
      // Match submit's stock-then-wallet lock ordering for overlapping customer orders.
      if (calculation.stock.length) {
        const ids = calculation.stock.map(([id]) => Prisma.sql`${id}::uuid`);
        await db.$queryRaw`SELECT "id" FROM "SellerOffer" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
      }
      const [payer] = await db.$queryRaw<{ balance: bigint }[]>`
        SELECT "balance" FROM "Wallet"
        WHERE "id" = ${escrow.payerWalletId}::uuid AND "ownerType" = 'CUSTOMER' AND "ownerId" = ${actor.id}::uuid FOR UPDATE
      `;
      if (!payer) throw new InternalServerErrorException('کیف پول پرداخت‌کننده امانت یافت نشد.');
      if (payer.balance < calculation.delta) throw new WalletShortfallException(order.activeRevision, calculation.delta, payer.balance);
      const resultingRevision = await this.applyRevision(db, order, revision, escrow, calculation);
      const approved = await db.orderMeteredAdjustment.update({
        where: { id: adjustment.id },
        data: { status: 'APPROVED', resultingRevision, idempotencyKey: dto.idempotencyKey, customerDecidedAt: new Date() },
      });
      return { order, adjustment: toMeteredAdjustmentView(approved, revision.addons), replay: false };
    });
    if (!result.replay) await this.publish(result.order, result.adjustment, 'TECHNICIAN');
    return result.adjustment;
  }

  async reject(actor: AuthenticatedUser, orderId: string, adjustmentId: string) {
    if (actor.role !== 'CUSTOMER') throw new ForbiddenException();
    const result = await this.prisma.$transaction(async (db) => {
      const order = await this.lockVisibleOrder(db, orderId, { customerId: actor.id });
      const adjustment = await db.orderMeteredAdjustment.findFirst({ where: { id: adjustmentId, orderId } });
      if (!adjustment) throw new NotFoundException('درخواست اصلاح متراژ یافت نشد.');
      const base = await this.baseRevision(db, orderId, adjustment.baseRevision);
      if (adjustment.status === 'REJECTED') return { order, adjustment: toMeteredAdjustmentView(adjustment, base.addons), replay: true };
      if (order.state !== 'IN_PROGRESS' || adjustment.status !== 'PENDING_APPROVAL' || adjustment.baseRevision !== order.activeRevision) {
        throw new ConflictException('این اصلاح متراژ دیگر قابل اعتراض نیست.');
      }
      const rejected = await db.orderMeteredAdjustment.update({
        where: { id: adjustment.id }, data: { status: 'REJECTED', customerDecidedAt: new Date() },
      });
      return { order, adjustment: toMeteredAdjustmentView(rejected, base.addons), replay: false };
    });
    if (!result.replay) await this.publish(result.order, result.adjustment, 'TECHNICIAN');
    return result.adjustment;
  }

  private async lockVisibleOrder(db: Db, orderId: string, owner: { technicianId: string } | { customerId: string }) {
    const ownership = 'technicianId' in owner ? Prisma.sql`"technicianId" = ${owner.technicianId}::uuid`
      : Prisma.sql`"customerId" = ${owner.customerId}::uuid`;
    const [locked] = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "ServiceOrder" WHERE "id" = ${orderId}::uuid AND ${ownership} FOR UPDATE
    `;
    if (!locked) throw new NotFoundException('سفارش یافت نشد.');
    return db.serviceOrder.findUniqueOrThrow({ where: { id: orderId } });
  }

  private async activePosition(db: Db, order: ServiceOrder) {
    if (order.state !== 'IN_PROGRESS' || order.pricingVersion !== MANAGED_PRICING_VERSION) {
      throw new BadRequestException('ثبت و تأیید متراژ فقط هنگام اجرای سفارش امکان‌پذیر است.');
    }
    const [revision, escrow] = await Promise.all([
      activeManagedRevision(db, order), db.escrowPosition.findUnique({ where: { orderId: order.id } }),
    ]);
    if (!revision || revision.status !== 'FUNDED' || !escrow || escrow.status !== 'OPEN' || escrow.activeRevision !== order.activeRevision) {
      throw new ConflictException('نسخه و امانت فعال سفارش برای اصلاح متراژ در دسترس نیست.');
    }
    return { revision, escrow };
  }

  private async baseRevision(db: Db, orderId: string, baseRevision: number) {
    return db.orderPriceRevision.findUniqueOrThrow({
      where: { orderId_revision: { orderId, revision: baseRevision } }, include: { addons: true },
    });
  }

  private async applyRevision(db: Db, order: ServiceOrder, revision: Revision, escrow: EscrowPosition, calculation: Reconciliation) {
    const revisionNumber = order.activeRevision + 1;
    await reserveActualStock(db, calculation.stock);
    const posting = calculation.delta < 0n ? await this.wallet.refundEscrow({
      customerUserId: order.customerId, orderId: order.id, amount: -calculation.delta,
      idempotencyKey: `meter:refund:${order.id}:${revisionNumber}`, reason: 'بازگشت مابه‌التفاوت متراژ واقعی',
    }, db) : calculation.delta > 0n ? await this.wallet.holdEscrow({
      customerUserId: order.customerId, orderId: order.id, amount: calculation.delta,
      idempotencyKey: `meter:hold:${order.id}:${revisionNumber}`,
    }, db) : null;
    if (posting && posting.walletId !== escrow.payerWalletId) throw new InternalServerErrorException('مالک امانت نامعتبر است.');

    const saved = await db.orderPriceRevision.create({ data: {
      orderId: order.id, revision: revisionNumber, pricingVersion: revision.pricingVersion, status: 'FUNDED',
      policyVersion: revision.policyVersion, bundleBps: revision.bundleBps, sliderBps: revision.sliderBps,
      ...revisedSnapshots(revision, calculation),
    } });
    const newLines = await db.orderAddon.createManyAndReturn({
      data: calculation.lines.map(({ lineKey, bucket, kind, orderItemId, fulfillmentId, sellerOfferId, rateCardId, sku, titleFa, unit, qty, quantityCm, unitPrice, lineTotal }) => ({
        revisionId: saved.id, lineKey, bucket, kind, orderItemId, fulfillmentId, sellerOfferId, rateCardId, sku, titleFa, unit, qty, quantityCm, unitPrice, lineTotal,
      })),
      select: { id: true, lineKey: true },
    });
    // Serial registrations follow the same hardware line into the funded revision.
    const oldIds = new Map(revision.addons.filter(({ kind }) => kind === 'MATERIAL').map(({ id, lineKey }) => [lineKey, id]));
    for (const { id, lineKey } of newLines) {
      const previousId = oldIds.get(lineKey);
      if (previousId) await db.hardwareUnit.updateMany({ where: { orderAddonId: previousId }, data: { orderAddonId: id } });
    }
    await db.orderPriceRevision.update({ where: { id: revision.id }, data: { status: 'SUPERSEDED' } });
    await db.serviceOrder.update({ where: { id: order.id }, data: { activeRevision: revisionNumber, finalQuoteAmount: calculation.total } });
    await db.escrowPosition.update({ where: { id: escrow.id }, data: { activeRevision: revisionNumber, heldAmount: calculation.total } });
    return revisionNumber;
  }

  private async publish(order: ServiceOrder, adjustment: AdjustmentView, recipient: 'CUSTOMER' | 'TECHNICIAN') {
    const customerData = { orderId: order.id, adjustment };
    const technicianData = { orderId: order.id, adjustment: toTechnicianMeteredAdjustmentView(adjustment) };
    this.realtime.emitToUser(order.customerId, RealtimeEvent.METERED_ADJUSTMENT_CHANGED, customerData);
    if (order.technicianId) this.realtime.emitToUser(order.technicianId, RealtimeEvent.METERED_ADJUSTMENT_CHANGED, technicianData);
    const userId = recipient === 'CUSTOMER' ? order.customerId : order.technicianId;
    if (!userId) return;
    const statusMessage = {
      APPROVED: 'متراژ واقعی سفارش تأیید شد.', AUTO_REFUNDED: 'مابه‌التفاوت متراژ به کیف پول مشتری بازگشت.',
      PENDING_APPROVAL: 'متراژ واقعی و مابه‌التفاوت در انتظار بررسی مشتری است.', REJECTED: 'مشتری به متراژ ثبت‌شده اعتراض کرد.',
    }[adjustment.status];
    try {
      await this.notifications.send({
        userId, type: 'ORDER_STATUS_CHANGED', titleFa: 'اصلاح متراژ سفارش', bodyFa: statusMessage,
        data: recipient === 'CUSTOMER' ? customerData : technicianData,
      });
    } catch (error) {
      this.logger.warn(`Metered adjustment notification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
