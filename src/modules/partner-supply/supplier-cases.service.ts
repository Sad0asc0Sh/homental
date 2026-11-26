import { randomInt } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type SupplierCaseStatus } from '@prisma/client';
import { z } from 'zod';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';
import { parseB2BLines } from './b2b-supply-lines';
import type { CreateSupplierCaseDto, ResolveSupplierCaseDto, SendSupplierCaseMessageDto } from './dto/supplier-cases.dto';

type Db = Prisma.TransactionClient;
const caseInclude = { seller: { select: { shopNameFa: true, userId: true } } } satisfies Prisma.SupplierCaseInclude;
type CaseRow = Prisma.SupplierCaseGetPayload<{ include: typeof caseInclude }>;

const messages = z.array(z.object({
  senderRole: z.enum(['TECHNICIAN', 'SELLER']), textFa: z.string(), at: z.string(),
}));

const quantityCaseTypes = ['UNUSED_RETURN', 'EXCHANGE'] as const;
const terminalStatuses = new Set<SupplierCaseStatus>(['INSPECTED_ACCEPTED', 'REJECTED', 'RESOLVED', 'CANCELLED']);
const MAX_STOCK = 2_147_483_647;
const MAX_MONEY = 9_223_372_036_854_775_807n;

function readMessages(value: Prisma.JsonValue) {
  const parsed = messages.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

function view(row: CaseRow) {
  const { id, caseNumber, type, status, technicianUserId, sellerId, fulfillmentId, b2bSupplyOrderId,
    serviceOrderId, lineKey, sku, serialNumber, requestedQty, approvedQty, replacementOfferId, priceDelta,
    sealIntact, reasonFa, inspectionNoteFa, refundAmount, resolvedAt, createdAt, updatedAt } = row;
  return {
    id, caseNumber, type, status, technicianUserId, sellerId, sellerShopNameFa: row.seller.shopNameFa,
    fulfillmentId, b2bSupplyOrderId, serviceOrderId, lineKey, sku, serialNumber, requestedQty, approvedQty,
    replacementOfferId, priceDelta, sealIntact, reasonFa, inspectionNoteFa, messages: readMessages(row.messagesJson),
    refundAmount, resolvedAt, createdAt, updatedAt,
  };
}

@Injectable()
export class SupplierCasesService {
  private readonly logger = new Logger(SupplierCasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletEscrowService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateSupplierCaseDto) {
    if (actor.role !== 'TECHNICIAN') throw new ForbiddenException();
    const quantityCase = dto.type === 'UNUSED_RETURN' || dto.type === 'EXCHANGE';
    const hasLine = !!dto.fulfillmentId && !!dto.lineKey;
    const reason = dto.reasonFa.trim();
    if (!reason) throw new BadRequestException('شرح درخواست تأمین کالا را وارد کنید.');
    if (!!dto.fulfillmentId !== !!dto.lineKey || (quantityCase && (!hasLine || !Number.isInteger(dto.requestedQty) || (dto.requestedQty ?? 0) < 1)) ||
        (dto.type === 'REPAIR' && !hasLine && !dto.serialNumber?.trim())) {
      throw new BadRequestException('برای این درخواست، اطلاعات کالای تحویل‌شده، تعداد یا شماره سریال لازم است.');
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const row = await this.prisma.$transaction(async (db) => {
          const line = dto.fulfillmentId && dto.lineKey
            ? await this.deliveredLine(db, dto.fulfillmentId, dto.lineKey, dto.sellerId, actor.id)
            : null;
          if (line && dto.sku && dto.sku !== line.sku) throw new BadRequestException('شناسه کالا با قلم تحویل‌شده مطابقت ندارد.');
          if (line && quantityCase && dto.requestedQty) {
            await this.requireReturnableQuantity(db, line.fulfillmentId, line.lineKey, line.qty, dto.requestedQty);
          }
          if (!line) await this.requireLocalSeller(db, actor.id, dto.sellerId, dto.sku);
          return db.supplierCase.create({
            data: {
              caseNumber: `SC-${new Date().getFullYear()}-${String(randomInt(1_000_000)).padStart(6, '0')}`,
              type: dto.type, technicianUserId: actor.id, sellerId: dto.sellerId, reasonFa: reason,
              fulfillmentId: line?.fulfillmentId, b2bSupplyOrderId: line?.b2bSupplyOrderId, serviceOrderId: line?.serviceOrderId,
              lineKey: line?.lineKey, sku: line?.sku ?? dto.sku, serialNumber: dto.serialNumber?.trim(),
              requestedQty: quantityCase ? dto.requestedQty : undefined,
              messagesJson: dto.type === 'TECH_GUIDANCE' ? [{ senderRole: 'TECHNICIAN', textFa: reason, at: new Date().toISOString() }] : undefined,
            }, include: caseInclude,
          });
        });
        await this.notify(row.seller.userId, row, 'درخواست جدید تأمین کالا');
        return view(row);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' &&
              String(error.meta?.target).includes('caseNumber')) || attempt === 4) throw error;
      }
    }
    throw new ConflictException('شماره درخواست در دسترس نیست.');
  }

  async list(actor: AuthenticatedUser) {
    const rows = await this.prisma.supplierCase.findMany({
      where: this.scope(actor), include: caseInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(view);
  }

  async resolve(actor: AuthenticatedUser, id: string, dto: ResolveSupplierCaseDto) {
    if (actor.role !== 'SELLER' && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const idempotencyKey = dto.idempotencyKey?.trim();
    const result = await this.prisma.$transaction(async (db) => {
      const row = await this.lockCase(db, actor, id);
      if (terminalStatuses.has(row.status)) {
        if (row.status === dto.status && (!idempotencyKey || row.idempotencyKey === idempotencyKey)) return { row, replay: true };
        throw new ConflictException('تصمیم نهایی این درخواست قبلاً ثبت شده است.');
      }
      if (idempotencyKey) {
        const existing = await db.supplierCase.findUnique({ where: { idempotencyKey }, select: { id: true } });
        if (existing && existing.id !== id) throw new ConflictException('شناسه یکتای تصمیم قبلاً استفاده شده است.');
      }
      const isFinancialDecision = dto.status === 'INSPECTED_ACCEPTED' || (row.type === 'EXCHANGE' && dto.status === 'RESOLVED');
      const data = isFinancialDecision
        ? await this.inspectAndSettle(db, row, dto)
        : this.reviewCase(row, dto);
      const resolvedAt = data.status && terminalStatuses.has(data.status) ? new Date() : undefined;
      const updated = await db.supplierCase.update({
        where: { id }, data: { ...data, resolvedAt, idempotencyKey: resolvedAt ? idempotencyKey : undefined }, include: caseInclude,
      });
      return { row: updated, replay: false };
    });
    if (!result.replay) await this.notify(result.row.technicianUserId, result.row, 'وضعیت درخواست تأمین کالا به‌روزرسانی شد');
    return view(result.row);
  }

  async sendMessage(actor: AuthenticatedUser, id: string, dto: SendSupplierCaseMessageDto) {
    if (actor.role !== 'TECHNICIAN' && actor.role !== 'SELLER') throw new ForbiddenException();
    const senderRole = actor.role;
    const textFa = dto.textFa.trim();
    if (!textFa) throw new BadRequestException('متن پیام را وارد کنید.');
    const row = await this.prisma.$transaction(async (db) => {
      const current = await this.lockCase(db, actor, id);
      if (terminalStatuses.has(current.status)) throw new ConflictException('این درخواست بسته شده است.');
      const message = { senderRole, textFa, at: new Date().toISOString() };
      return db.supplierCase.update({
        where: { id }, data: { messagesJson: [...readMessages(current.messagesJson), message] }, include: caseInclude,
      });
    });
    await this.notify(senderRole === 'TECHNICIAN' ? row.seller.userId : row.technicianUserId, row, 'پیام جدید درخواست تأمین کالا');
    return view(row);
  }

  private scope(actor: AuthenticatedUser): Prisma.SupplierCaseWhereInput {
    if (actor.role === 'TECHNICIAN') return { technicianUserId: actor.id };
    if (actor.role === 'SELLER') return { seller: { userId: actor.id } };
    if (actor.role === 'SUPER_ADMIN') return {};
    throw new ForbiddenException();
  }

  private async lockCase(db: Db, actor: AuthenticatedUser, id: string) {
    const scope = this.scope(actor);
    const where = { id, ...scope };
    const visible = await db.supplierCase.findFirst({ where, select: { id: true } });
    if (visible) {
      await db.$queryRaw`SELECT "id" FROM "SupplierCase" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const locked = await db.supplierCase.findFirst({ where, include: caseInclude });
      if (locked) return locked;
    }
    throw new NotFoundException('درخواست تأمین کالا یافت نشد.');
  }

  private async requireLocalSeller(db: Db, technicianUserId: string, sellerId: string, sku?: string) {
    const profile = await db.technicianProfile.findUnique({ where: { userId: technicianUserId }, select: { branch: { select: { cityId: true } } } });
    if (!profile?.branch) throw new ForbiddenException('شعبه تکنسین مشخص نیست.');
    const seller = await db.sellerProfile.findFirst({
      where: { id: sellerId, cityId: profile.branch.cityId, status: 'APPROVED', user: { status: 'ACTIVE', role: 'SELLER' },
        ...(sku ? { offers: { some: { product: { sku } } } } : {}) }, select: { id: true },
    });
    if (!seller) throw new NotFoundException('فروشنده یا کالای موردنظر یافت نشد.');
  }

  private async deliveredLine(db: Db, fulfillmentId: string, lineKey: string, sellerId: string, technicianUserId: string, requireSettled = false) {
    // All new requests for this shipment serialize against the same quantity budget.
    const [locked] = await db.$queryRaw<{ id: string }[]>`
      SELECT f."id" FROM "SupplyFulfillment" f
      LEFT JOIN "B2BSupplyOrder" b ON b."id" = f."b2bSupplyOrderId"
      LEFT JOIN "ServiceOrder" o ON o."id" = f."orderId"
      WHERE f."id" = ${fulfillmentId}::uuid AND f."sellerId" = ${sellerId}::uuid
        AND (b."technicianUserId" = ${technicianUserId}::uuid OR o."technicianId" = ${technicianUserId}::uuid)
      FOR UPDATE OF f
    `;
    if (!locked) throw new NotFoundException('قلم تحویل‌شده یافت نشد.');
    const shipment = await db.supplyFulfillment.findUniqueOrThrow({
      where: { id: fulfillmentId }, select: {
        status: true, orderId: true, b2bSupplyOrderId: true,
        order: { select: { activeRevision: true, escrowPosition: { select: { status: true } } } },
        b2bSupplyOrder: { select: { linesJson: true, escrowPosition: { select: { status: true } } } },
        lines: { where: { lineKey, kind: 'MATERIAL' }, select: {
          sku: true, sellerOfferId: true, unit: true, qty: true, quantityCm: true, unitPrice: true,
          revision: { select: { revision: true } },
        } },
      },
    });
    if (shipment.status !== 'DELIVERED') throw new ConflictException('ابتدا تحویل کالا باید تأیید شود.');
    const parent = shipment.b2bSupplyOrder ?? shipment.order;
    if (requireSettled && parent?.escrowPosition?.status !== 'SETTLED') {
      throw new ConflictException('تأیید نهایی برگشت یا تعویض پس از تسویه سفارش امکان‌پذیر است.');
    }
    const scope = { fulfillmentId, lineKey, serviceOrderId: shipment.orderId, b2bSupplyOrderId: shipment.b2bSupplyOrderId };
    if (shipment.b2bSupplyOrder) {
      const line = parseB2BLines(shipment.b2bSupplyOrder.linesJson).find((item) => item.lineKey === lineKey && item.sellerId === sellerId);
      if (line) return { ...scope, sku: line.sku, offerId: line.sellerOfferId, qty: line.qty, unitPrice: line.partnerUnitPrice, cut: false };
    } else {
      const line = shipment.lines.find(({ revision }) => revision.revision === shipment.order?.activeRevision);
      if (line?.sellerOfferId && line.sku) return {
        ...scope, sku: line.sku, offerId: line.sellerOfferId, qty: line.qty, unitPrice: line.unitPrice,
        cut: line.quantityCm !== null && line.quantityCm % 100 !== 0,
      };
    }
    throw new NotFoundException('قلم تحویل‌شده یافت نشد.');
  }

  private async requireReturnableQuantity(db: Db, fulfillmentId: string, lineKey: string, delivered: number, requested: number, excludeCaseId?: string) {
    const previous = await db.supplierCase.findMany({
      where: { fulfillmentId, lineKey, id: excludeCaseId ? { not: excludeCaseId } : undefined,
        type: { in: [...quantityCaseTypes] }, status: { notIn: ['REJECTED', 'CANCELLED'] } },
      select: { requestedQty: true, approvedQty: true },
    });
    const claimed = previous.reduce((sum, row) => sum + BigInt(row.approvedQty ?? row.requestedQty ?? 0), 0n);
    if (claimed + BigInt(requested) > BigInt(delivered)) {
      throw new ConflictException('تعداد درخواستی بیش از تعداد باقیماندهٔ قابل برگشت یا تعویض است.');
    }
  }

  private reviewCase(row: CaseRow, dto: ResolveSupplierCaseDto): { status: SupplierCaseStatus; inspectionNoteFa?: string; sealIntact?: boolean; refundAmount?: bigint } {
    const { status } = dto;
    const note = dto.inspectionNoteFa?.trim();
    const allowed = status === 'CANCELLED' || status === 'REJECTED' ||
      (status === 'IN_REVIEW' && (row.status === 'OPEN' || row.status === 'IN_REVIEW')) ||
      (status === 'APPROVED' && (row.type === 'UNUSED_RETURN' || row.type === 'EXCHANGE')) ||
      (status === 'RESOLVED' && (row.type === 'TECH_GUIDANCE' || (row.type === 'REPAIR' && row.status === 'IN_REVIEW' && !!note)));
    if (!allowed) throw new BadRequestException('تغییر وضعیت برای این نوع درخواست مجاز نیست یا یادداشت بررسی لازم است.');
    return { status, inspectionNoteFa: note, sealIntact: dto.sealIntact, refundAmount: row.type === 'UNUSED_RETURN' && status === 'REJECTED' ? 0n : undefined };
  }

  private async inspectAndSettle(db: Db, row: CaseRow, dto: ResolveSupplierCaseDto) {
    if ((row.type !== 'UNUSED_RETURN' && row.type !== 'EXCHANGE') || !row.fulfillmentId || !row.lineKey || !row.requestedQty) {
      throw new BadRequestException('این درخواست برای تسویه کالا معتبر نیست.');
    }
    const line = await this.deliveredLine(db, row.fulfillmentId, row.lineKey, row.sellerId, row.technicianUserId, true);
    if (row.type === 'UNUSED_RETURN' && (dto.sealIntact !== true || dto.cutCable || line.cut)) {
      return { status: 'REJECTED' as const, sealIntact: dto.sealIntact ?? false, refundAmount: 0n,
        inspectionNoteFa: dto.inspectionNoteFa?.trim() || 'پلمب سالم نیست یا کالا به‌صورت برش‌خورده تحویل شده است.' };
    }
    if (row.type === 'EXCHANGE' && (dto.cutCable || line.cut)) throw new BadRequestException('کالای برش‌خورده قابل تعویض نیست.');
    const approvedQty = dto.approvedQty ?? row.requestedQty;
    if (!Number.isInteger(approvedQty) || approvedQty < 1 || approvedQty > row.requestedQty) {
      throw new BadRequestException('تعداد تأییدشده باید در محدوده تعداد درخواستی باشد.');
    }
    // A managed shipment's active line quantity can change at reconciliation before settlement.
    await this.requireReturnableQuantity(db, line.fulfillmentId, line.lineKey, line.qty, approvedQty, row.id);
    const replacementOfferId = row.type === 'EXCHANGE' ? dto.replacementOfferId : undefined;
    if (row.type === 'EXCHANGE' && !replacementOfferId) throw new BadRequestException('کالای جایگزین را مشخص کنید.');
    const ids = [...new Set([line.offerId, ...(replacementOfferId ? [replacementOfferId] : [])])];
    const stockIds = ids.map((id) => Prisma.sql`${id}::uuid`);
    await db.$queryRaw`SELECT "id" FROM "SellerOffer" WHERE "sellerId" = ${row.sellerId}::uuid
      AND "id" IN (${Prisma.join(stockIds)}) ORDER BY "id" FOR UPDATE`;
    const offers = await db.sellerOffer.findMany({
      where: { id: { in: ids }, sellerId: row.sellerId }, include: { product: { select: { isActive: true } } },
    });
    const original = offers.find(({ id }) => id === line.offerId);
    const replacement = offers.find(({ id }) => id === replacementOfferId);
    if (!original || (replacementOfferId && (!replacement?.isActive || !replacement.product.isActive))) {
      throw new NotFoundException('کالا یا کالای جایگزین متعلق به این فروشنده نیست یا در دسترس نیست.');
    }
    if (replacement && replacement.onHandQty - replacement.reservedQty < approvedQty) {
      throw new ConflictException('موجودی کالای جایگزین کافی نیست.');
    }
    if (original.id !== replacement?.id) {
      if (original.onHandQty > MAX_STOCK - approvedQty) throw new ConflictException('ظرفیت ثبت موجودی کالا کافی نیست.');
      await db.sellerOffer.update({ where: { id: original.id }, data: { onHandQty: { increment: approvedQty } } });
      if (replacement) await db.sellerOffer.update({ where: { id: replacement.id }, data: { onHandQty: { decrement: approvedQty } } });
    }
    const returnedTotal = line.unitPrice * BigInt(approvedQty);
    const replacementTotal = (replacement?.partnerPrice ?? 0n) * BigInt(approvedQty);
    if (returnedTotal > MAX_MONEY || replacementTotal > MAX_MONEY) throw new BadRequestException('مبلغ تسویه از محدوده مجاز بیشتر است.');
    const technicianAmount = returnedTotal - replacementTotal;
    await this.wallet.transferSupplierCaseBalance({
      caseId: row.id, technicianUserId: row.technicianUserId, sellerUserId: row.seller.userId, technicianAmount,
      type: row.type === 'EXCHANGE' ? 'ADJUSTMENT' : 'REFUND', orderId: row.serviceOrderId, b2bSupplyOrderId: row.b2bSupplyOrderId,
    }, db);
    return { status: dto.status === 'RESOLVED' ? 'RESOLVED' as const : 'INSPECTED_ACCEPTED' as const, approvedQty, sealIntact: dto.sealIntact,
      inspectionNoteFa: dto.inspectionNoteFa?.trim(), replacementOfferId,
      priceDelta: row.type === 'EXCHANGE' ? -technicianAmount : undefined,
      refundAmount: technicianAmount > 0n ? technicianAmount : 0n };
  }

  private async notify(userId: string, row: CaseRow, titleFa: string) {
    try {
      await this.notifications.send({ userId, type: 'GENERIC', titleFa, bodyFa: row.caseNumber,
        data: { caseId: row.id, caseType: row.type, status: row.status } });
    } catch (error) {
      this.logger.warn(`Supplier case notification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
