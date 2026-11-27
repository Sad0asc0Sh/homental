import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderState, type Prisma, type Warranty, type WarrantyClaim, type WarrantyClaimStatus } from '@prisma/client';
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { AppConfigService } from '@config/app-config.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RedisService } from '@infra/redis/redis.service';
import { RealtimeEvent, RealtimeService } from '@infra/realtime/realtime.service';
import { MANAGED_PRICING_VERSION } from '../pricing/managed-pricing';
import { activeManagedRevision, managedSerialLineKeys, settleManagedSupply } from '../orders/managed-order-economics';
import { assertMeteredReconciled } from '../orders/metered-adjustments.service';
import { assertValidTransition } from '../orders/order-state-machine';
import type { RegisterHardwareUnitsDto } from './dto/warranty.dto';

const HANDOVER_OTP_TTL_MS = 10 * 60 * 1000;
const MAX_HANDOVER_ATTEMPTS = 3;
const HANDOVER_RESEND_LIMIT_PER_MINUTE = 1;

function toWarrantyCard(warranty: Warranty) {
  const { id, orderId, policyNumber, status, startDate, endDate, coverageMonths, createdAt, updatedAt } = warranty;
  const coverage = Array.isArray(warranty.coverage) ? warranty.coverage.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const { serviceKey, titleFa, warrantyMonths, serials } = entry;
    return [{
      serviceKey: typeof serviceKey === 'string' ? serviceKey : undefined,
      titleFa: typeof titleFa === 'string' ? titleFa : undefined,
      warrantyMonths: typeof warrantyMonths === 'number' ? warrantyMonths : undefined,
      serials: Array.isArray(serials) ? serials.filter((serial) => typeof serial === 'string') : [],
    }];
  }) : [];
  return { id, orderId, policyNumber, status, startDate, endDate, coverageMonths, coverage, createdAt, updatedAt };
}

function toClaimView(claim: WarrantyClaim) {
  const { id, warrantyId, status, descriptionFa, resolutionNoteFa, createdAt, updatedAt, resolvedAt } = claim;
  return { id, warrantyId, status, descriptionFa, resolutionNoteFa, createdAt, updatedAt, resolvedAt };
}

/**
 * Mandatory Handover Gate (Invariant 9) — ALL THREE locks must pass before
 * warranty activation & escrow release:
 *   1. Hardware serials registered for every FULL_PACKAGE item
 *   2. Privacy checklist signed (default passwords changed + access revoked)
 *   3. Customer handover OTP verified
 * Completion runs warranty activation, escrow release/split and stats in ONE
 * atomic transaction.
 */
@Injectable()
export class WarrantyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletEscrowService: WalletEscrowService,
    private readonly notificationsService: NotificationsService,
    private readonly realtimeService: RealtimeService,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  // ── Step 1: hardware serials ──────────────────────────────────────────────

  async registerHardwareUnits(
    actor: AuthenticatedUser,
    orderId: string,
    dto: RegisterHardwareUnitsDto,
  ) {
    const order = await this.requireAssignedOrder(actor, orderId, OrderState.IN_PROGRESS);

    if (order.pricingVersion === MANAGED_PRICING_VERSION) {
      return this.prisma.$transaction(async (db) => {
        const [current] = await db.$queryRaw<{ state: OrderState; activeRevision: number }[]>`
          SELECT "state", "activeRevision" FROM "ServiceOrder" WHERE "id" = ${orderId}::uuid FOR UPDATE
        `;
        if (current?.state !== 'IN_PROGRESS' || current.activeRevision !== order.activeRevision) {
          throw new ConflictException('نسخه یا وضعیت سفارش تغییر کرده است.');
        }
        const revision = await activeManagedRevision(db, order);
        if (!revision || revision.status !== 'FUNDED') throw new ConflictException('نسخه سفارش در دسترس نیست.');
        const required = managedSerialLineKeys(revision);
        const lines = new Map(revision.addons.filter((line) => required.has(line.lineKey)).map((line) => [line.id, line]));
        const existing = await db.hardwareUnit.groupBy({
          by: ['orderAddonId'], where: { orderAddonId: { in: [...lines.keys()] } }, _count: { _all: true },
        });
        const quantities = new Map(existing.map(({ orderAddonId, _count }) => [orderAddonId, _count._all]));
        const data = dto.units.map((unit) => {
          const line = unit.orderAddonId ? lines.get(unit.orderAddonId) : undefined;
          if (!line || line.orderItemId !== unit.orderItemId) {
            throw new BadRequestException('این قلم به فهرست سریال‌های سفارش تعلق ندارد.');
          }
          const registered = (quantities.get(line.id) ?? 0) + 1;
          if (registered > line.qty) throw new BadRequestException('تعداد سریال‌های این قلم از تعداد توافق‌شده بیشتر است.');
          quantities.set(line.id, registered);
          return {
            orderItemId: unit.orderItemId, orderAddonId: line.id, sku: line.sku, categoryFa: line.titleFa,
            brand: unit.brand, model: unit.model, serialNumber: unit.serialNumber.trim(), registeredByUserId: actor.id,
          };
        });
        if (data.some((unit) => unit.serialNumber.length < 4)) throw new BadRequestException('شماره سریال معتبر نیست.');
        await db.hardwareUnit.createMany({ data });
        return { registered: data.length };
      });
    }

    const items = await this.prisma.orderItem.findMany({
      where: { orderId: order.id },
      select: { id: true },
    });
    const itemIds = new Set(items.map((item) => item.id));
    for (const unit of dto.units) {
      if (!itemIds.has(unit.orderItemId)) {
        throw new BadRequestException({
          statusCode: 400,
          message: `آیتم سفارش «${unit.orderItemId}» متعلق به این سفارش نیست.`,
        });
      }
    }

    await this.prisma.hardwareUnit.createMany({
      data: dto.units.map((unit) => ({
        orderItemId: unit.orderItemId,
        categoryFa: unit.categoryFa,
        brand: unit.brand,
        model: unit.model,
        serialNumber: unit.serialNumber,
        registeredByUserId: actor.id,
      })),
    });
    return { registered: dto.units.length };
  }

  // ── Step 2: privacy checklist + handover OTP ──────────────────────────────

  async requestHandover(
    actor: AuthenticatedUser,
    orderId: string,
    dto: { defaultPasswordsChanged: boolean; technicianAccessRevoked: boolean },
  ) {
    const assigned = await this.requireAssignedOrder(actor, orderId, OrderState.IN_PROGRESS);

    if (dto.defaultPasswordsChanged !== true || dto.technicianAccessRevoked !== true) {
      throw new BadRequestException('تأیید تغییر رمزهای پیش‌فرض و حذف دسترسی نصاب برای تحویل کار الزامی است.');
    }

    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const salt = randomBytes(16).toString('hex');
    const handoverOtpHash = `${salt}:${scryptSync(otp, salt, 32).toString('hex')}`;

    const order = await this.prisma.$transaction(async (db) => {
      if (assigned.pricingVersion === MANAGED_PRICING_VERSION) {
        const [current] = await db.$queryRaw<{ state: OrderState }[]>`
          SELECT "state" FROM "ServiceOrder"
          WHERE "id" = ${orderId}::uuid AND "technicianId" = ${actor.id}::uuid FOR UPDATE
        `;
        if (current?.state !== 'IN_PROGRESS') throw new ConflictException('وضعیت سفارش تغییر کرده است.');
      }
      const order = await this.reloadOrder(orderId, db);
      await assertMeteredReconciled(db, order);
      const unpackagedItems = await this.missingSerials(order, db);
      if (unpackagedItems.length > 0) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'قبل از تحویل، ثبت شماره سریال تجهیزات نصب‌شده الزامی است.',
          metadata: { items: unpackagedItems },
        });
      }
      assertValidTransition(OrderState.IN_PROGRESS, OrderState.HANDOVER_OTP_PENDING);
      const updated = await db.serviceOrder.updateMany({
        where: { id: order.id, state: OrderState.IN_PROGRESS, technicianId: actor.id },
        data: {
          state: OrderState.HANDOVER_OTP_PENDING,
          handoverOtpHash,
          handoverOtpExpiresAt: new Date(Date.now() + HANDOVER_OTP_TTL_MS),
          handoverAttempts: 0,
          privacyChecklistSignedAt: new Date(),
          privacyChecklistAnswers: { defaultPasswordsChanged: true, technicianAccessRevoked: true },
        },
      });
      if (updated.count === 0) {
        throw new ConflictException('وضعیت سفارش تغییر کرده است؛ دوباره تلاش کنید.');
      }
      await db.orderStateTransition.create({
        data: {
          orderId: order.id,
          fromState: OrderState.IN_PROGRESS,
          toState: OrderState.HANDOVER_OTP_PENDING,
          actorUserId: actor.id,
          actorRole: actor.role,
          reason: 'درخواست تحویل با چک‌لیست حریم خصوصی',
          metadata: { privacyChecklistSigned: true } as unknown as Prisma.InputJsonValue,
        },
      });
      return order;
    });

    await this.notificationsService.send({
      userId: order.customerId,
      type: 'HANDOVER_OTP',
      channel: 'SMS',
      titleFa: 'کد تحویل سفارش',
      bodyFa: `کد تحویل سفارش ${order.orderNumber}: ${otp}\nاین کد را به تکنسین اعلام کنید.`,
      data: { orderId: order.id },
    });

    const devHandoverOtp =
      !this.config.isProduction && this.config.otpDevEcho ? otp : undefined;
    return { orderId: order.id, state: 'HANDOVER_OTP_PENDING', devHandoverOtp };
  }

  // ── Step 2b: resend OTP (expired-code recovery — no order deadlock) ───────

  async resendHandoverOtp(actor: AuthenticatedUser, orderId: string) {
    const order = await this.requireAssignedOrder(actor, orderId, OrderState.HANDOVER_OTP_PENDING);
    if (order.handoverAttempts >= MAX_HANDOVER_ATTEMPTS) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'تعداد تلاش کد تحویل به سقف مجاز رسید؛ با پشتیبانی شعبه تماس بگیرید.',
      });
    }
    const rate = await this.redis.rateLimit(`handover:otp:resend:${orderId}`, HANDOVER_RESEND_LIMIT_PER_MINUTE, 60_000);
    if (!rate.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'درخواست کد جدید بیش از حد مجاز است؛ لطفاً کمی بعد تلاش کنید.',
          retryAfterSeconds: Math.ceil(rate.retryAfterMs / 1000),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const salt = randomBytes(16).toString('hex');
    const renewed = await this.prisma.serviceOrder.updateMany({
      where: { id: order.id, state: 'HANDOVER_OTP_PENDING', technicianId: actor.id, handoverAttempts: { lt: MAX_HANDOVER_ATTEMPTS } },
      data: {
        handoverOtpHash: `${salt}:${scryptSync(otp, salt, 32).toString('hex')}`,
        handoverOtpExpiresAt: new Date(Date.now() + HANDOVER_OTP_TTL_MS),
      },
    });
    if (renewed.count === 0) throw new ConflictException('وضعیت سفارش تغییر کرده است.');

    await this.notificationsService.send({
      userId: order.customerId,
      type: 'HANDOVER_OTP',
      channel: 'SMS',
      titleFa: 'کد جدید تحویل سفارش',
      bodyFa: `کد جدید تحویل سفارش ${order.orderNumber}: ${otp}`,
      data: { orderId: order.id },
    });

    const devHandoverOtp =
      !this.config.isProduction && this.config.otpDevEcho ? otp : undefined;
    return { orderId: order.id, resent: true, devHandoverOtp };
  }

  // ── Step 3: complete handover (atomic gate → warranty + escrow) ──────────

  async completeHandover(actor: AuthenticatedUser, orderId: string, dto: { otp: string }) {
    const assigned = await this.requireAssignedOrder(actor, orderId);
    if (assigned.state === 'COMPLETED_WARRANTY_ACTIVE') return this.completedHandover(this.prisma, orderId, actor.id);
    if (assigned.state !== 'HANDOVER_OTP_PENDING') throw new BadRequestException('وضعیت سفارش برای تحویل مناسب نیست.');
    const order = await this.reloadOrder(orderId);
    if (!order.handoverOtpHash || !order.handoverOtpExpiresAt || !order.privacyChecklistSignedAt) {
      throw new BadRequestException('چک‌لیست یا کد تحویل برای این سفارش ثبت نشده است.');
    }
    const missing = await this.missingSerials(order);
    if (missing.length > 0) throw new BadRequestException('ثبت شماره سریال اقلام سفارش کامل نیست.');
    const now = new Date();
    const guard = {
      id: order.id, state: OrderState.HANDOVER_OTP_PENDING, technicianId: actor.id,
      ...(order.pricingVersion === MANAGED_PRICING_VERSION ? { activeRevision: order.activeRevision } : {}),
      handoverOtpHash: order.handoverOtpHash, handoverAttempts: { lt: MAX_HANDOVER_ATTEMPTS },
      handoverOtpExpiresAt: { gt: now },
    };
    if (order.handoverAttempts >= MAX_HANDOVER_ATTEMPTS) {
      throw new BadRequestException('تعداد تلاش کد تحویل به سقف مجاز رسید؛ با پشتیبانی شعبه تماس بگیرید.');
    }
    if (order.handoverOtpExpiresAt <= now) {
      throw new BadRequestException('کد تحویل منقضی شده است؛ از تکنسین بخواهید کد جدید صادر کند.');
    }
    if (!this.verifyOtp(dto.otp, order.handoverOtpHash)) {
      await this.prisma.serviceOrder.updateMany({ where: guard, data: { handoverAttempts: { increment: 1 } } });
      throw new BadRequestException(order.handoverAttempts + 1 >= MAX_HANDOVER_ATTEMPTS
        ? 'تعداد تلاش کد تحویل به سقف مجاز رسید؛ با پشتیبانی شعبه تماس بگیرید.'
        : 'کد تحویل نادرست است.');
    }
    if (!order.finalQuoteAmount) throw new BadRequestException('مبلغ نهایی سفارش برای تسویه ثبت نشده است.');
    const amount = order.finalQuoteAmount;

    const result = await this.prisma.$transaction(async (db) => {
      assertValidTransition('HANDOVER_OTP_PENDING', 'COMPLETED_WARRANTY_ACTIVE');
      const updated = await db.serviceOrder.updateMany({
        where: guard,
        data: {
          state: 'COMPLETED_WARRANTY_ACTIVE', completedAt: now, handoverOtpHash: null, handoverOtpExpiresAt: null,
        },
      });
      if (updated.count === 0) {
        const current = await db.serviceOrder.findUnique({ where: { id: orderId } });
        if (current?.state === 'COMPLETED_WARRANTY_ACTIVE' && current.technicianId === actor.id) {
          return { replay: await this.completedHandover(db, orderId, actor.id) };
        }
        throw new ConflictException('وضعیت سفارش یا کد تحویل تغییر کرده است.');
      }
      await db.orderStateTransition.create({
        data: {
          orderId, fromState: 'HANDOVER_OTP_PENDING', toState: 'COMPLETED_WARRANTY_ACTIVE',
          actorUserId: actor.id, actorRole: actor.role, reason: 'تحویل موفق با تأیید مشتری',
          metadata: { otpVerified: true, privacyChecklistSigned: true },
        },
      });
      const split = order.pricingVersion === MANAGED_PRICING_VERSION
        ? await settleManagedSupply(db, this.walletEscrowService, order, actor.id)
        : await this.walletEscrowService.releaseEscrowAndSplit({
          orderId, customerUserId: order.customerId, technicianUserId: actor.id,
          branchId: order.branchId, totalAmount: amount, idempotencyKey: `escrow:release:${orderId}`,
        }, db);

      const coverageMonths = Math.min(...order.items.map((item) => item.serviceDefinition.warrantyMonths));
      const warranty = await db.warranty.create({
        data: {
          policyNumber: this.generatePolicyNumber(), orderId, startDate: now, endDate: this.addMonths(now, coverageMonths),
          status: 'ACTIVE', coverageMonths,
          coverage: order.items.map((item) => ({
            serviceKey: item.serviceDefinition.key, titleFa: item.serviceDefinition.titleFa,
            warrantyMonths: item.serviceDefinition.warrantyMonths,
            serials: item.hardwareUnits.map((unit) => unit.serialNumber),
          })),
          warrantyReserveAmount: split.warrantyReserve, escrowReleasedAt: now,
        },
      });
      await db.technicianProfile.update({
        where: { userId: actor.id }, data: { completedJobs: { increment: 1 } },
      });
      return { warranty, payout: split.technicianPayout };
    });

    if (result.replay) return result.replay;
    await this.notificationsService.send({
      userId: order.customerId, type: 'WARRANTY_ACTIVATED', titleFa: 'گارانتی دیجیتال فعال شد',
      bodyFa: `سفارش ${order.orderNumber} تکمیل و گارانتی دیجیتال تا ${result.warranty.coverageMonths} ماه فعال شد.`,
      data: { orderId, warrantyId: result.warranty.id },
    });
    this.realtimeService.emitToOrder(orderId, RealtimeEvent.WARRANTY_ACTIVATED, {
      orderId, warrantyId: result.warranty.id, policyNumber: result.warranty.policyNumber,
    });
    return this.handoverView(orderId, result.warranty, result.payout);
  }

  private handoverView(orderId: string, warranty: Pick<Warranty, 'policyNumber' | 'coverageMonths'>, payout: bigint) {
    return {
      orderId, state: 'COMPLETED_WARRANTY_ACTIVE' as const, warrantyPolicyNumber: warranty.policyNumber,
      coverageMonths: warranty.coverageMonths, guaranteedNetPayout: payout,
    };
  }

  private async completedHandover(db: Prisma.TransactionClient, orderId: string, technicianUserId: string) {
    const [warranty, payout] = await Promise.all([
      db.warranty.findUnique({ where: { orderId }, select: { policyNumber: true, coverageMonths: true } }),
      db.walletTransaction.findFirst({
        where: { orderId, type: 'TECHNICIAN_PAYOUT', status: 'SETTLED',
          wallet: { ownerType: 'TECHNICIAN', ownerId: technicianUserId } },
        select: { amount: true },
      }),
    ]);
    if (!warranty || !payout) throw new ConflictException('اطلاعات تحویل و تسویه سفارش کامل نیست.');
    return this.handoverView(orderId, warranty, payout.amount);
  }

  async myWarranties(actor: AuthenticatedUser) {
    if (actor.role !== 'CUSTOMER') throw new ForbiddenException();
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: actor.id },
    });
    if (!customerProfile) {
      throw new ForbiddenException({ statusCode: 403, message: 'فقط مشتریان گارانتی دیجیتال دارند.' });
    }
    const warranties = await this.prisma.warranty.findMany({
      where: { order: { customerId: actor.id } },
      orderBy: { createdAt: 'desc' },
      include: {
        order: { select: { id: true, orderNumber: true, completedAt: true } },
        claims: true,
      },
    });
    return warranties.map((warranty) => ({
      ...toWarrantyCard(warranty),
      order: { id: warranty.order.id, orderNumber: warranty.order.orderNumber, completedAt: warranty.order.completedAt },
      claims: warranty.claims.map(toClaimView),
      daysRemaining: Math.max(
        0,
        Math.ceil((warranty.endDate.getTime() - Date.now()) / 86_400_000),
      ),
    }));
  }

  async createClaim(actor: AuthenticatedUser, warrantyId: string, dto: { descriptionFa: string; photos?: Record<string, unknown> }) {
    const warranty = await this.prisma.warranty.findUnique({
      where: { id: warrantyId },
      include: { order: true },
    });
    if (!warranty || warranty.order.customerId !== actor.id) {
      throw new NotFoundException({ statusCode: 404, message: 'گارانتی یافت نشد.' });
    }
    if (warranty.status !== 'ACTIVE' || warranty.endDate.getTime() <= Date.now()) {
      throw new BadRequestException({ statusCode: 400, message: 'ثبت درخواست گارانتی فقط در دوره اعتبار و بدون پرونده باز ممکن است.' });
    }

    const claim = await this.prisma.warrantyClaim.create({
      data: {
        warrantyId: warranty.id,
        openedByUserId: actor.id,
        status: 'OPEN',
        descriptionFa: dto.descriptionFa,
        photos: (dto.photos ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    await this.prisma.warranty.update({
      where: { id: warranty.id },
      data: { status: 'IN_CLAIM' },
    });
    return { claim: toClaimView(claim), warrantyStatus: 'IN_CLAIM' };
  }

  async updateClaim(
    actor: AuthenticatedUser,
    claimId: string,
    dto: { status: WarrantyClaimStatus; resolutionNoteFa?: string },
  ) {
    if (actor.role !== 'BRANCH_ADMIN' && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const claim = await this.prisma.warrantyClaim.findUnique({
      where: { id: claimId },
      include: { warranty: { include: { order: true } } },
    });
    if (!claim) {
      throw new NotFoundException({ statusCode: 404, message: 'درخواست گارانتی یافت نشد.' });
    }
    if (actor.role === 'BRANCH_ADMIN') {
      if (!actor.branchId || claim.warranty.order.branchId !== actor.branchId) {
        throw new NotFoundException({ statusCode: 404, message: 'درخواست گارانتی یافت نشد.' });
      }
    }

    const updated = await this.prisma.warrantyClaim.update({
      where: { id: claimId },
      data: { status: dto.status, resolutionNoteFa: dto.resolutionNoteFa },
    });

    // Resolved claims feed the technician's warrantyClaimRate (dispatch input).
    if (dto.status === 'APPROVED' || dto.status === 'RESOLVED') {
      await this.recalculateWarrantyClaimRate(claim.warranty.order.technicianId);
    }

    // Restore warranty to ACTIVE once nothing is open anymore (and still valid).
    const remainingOpen = await this.prisma.warrantyClaim.count({
      where: { warrantyId: claim.warrantyId, status: { in: ['OPEN', 'IN_REVIEW'] } },
    });
    if (remainingOpen === 0 && claim.warranty.endDate.getTime() > Date.now()) {
      await this.prisma.warranty.update({
        where: { id: claim.warrantyId },
        data: { status: 'ACTIVE' },
      });
    }
    return { claim: toClaimView(updated), warrantyStatus: remainingOpen === 0 ? 'ACTIVE' : 'IN_CLAIM' };
  }

  /** Branch-scoped claims queue (BRANCH_ADMIN sees own branch only; SUPER_ADMIN all). */
  async listClaims(actor: AuthenticatedUser) {
    if (actor.role !== 'BRANCH_ADMIN' && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (actor.role === 'BRANCH_ADMIN' && !actor.branchId) return [];
    const where: Prisma.WarrantyClaimWhereInput =
      actor.role === 'BRANCH_ADMIN'
        ? { warranty: { order: { branchId: actor.branchId } } }
        : {};
    const claims = await this.prisma.warrantyClaim.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        warranty: {
          include: {
            order: { select: { id: true, orderNumber: true, branchId: true, customerId: true } },
          },
        },
      },
    });
    if (actor.role === 'SUPER_ADMIN') return claims;
    return claims.map((claim) => {
      const { id, orderNumber, branchId, customerId } = claim.warranty.order;
      return { ...toClaimView(claim), warranty: { ...toWarrantyCard(claim.warranty), order: { id, orderNumber, branchId, customerId } } };
    });
  }

  private async recalculateWarrantyClaimRate(technicianUserId: string | null): Promise<void> {
    if (!technicianUserId) return;
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { userId: technicianUserId },
    });
    if (!profile) return;
    const approvedOrResolved = await this.prisma.warrantyClaim.count({
      where: {
        status: { in: ['APPROVED', 'RESOLVED'] },
        warranty: { order: { technicianId: technicianUserId } },
      },
    });
    const rate = approvedOrResolved / Math.max(1, profile.completedJobs);
    await this.prisma.technicianProfile.update({
      where: { userId: technicianUserId },
      data: { warrantyClaimRate: Math.min(1, rate) },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async requireAssignedOrder(actor: AuthenticatedUser, orderId: string, state?: OrderState) {
    if (actor.role !== 'TECHNICIAN') {
      throw new ForbiddenException({ statusCode: 403, message: 'این عملیات مخصوص تکنسین سفارش است.' });
    }
    const order = await this.prisma.serviceOrder.findUnique({ where: { id: orderId } });
    if (!order || order.technicianId !== actor.id) {
      throw new NotFoundException({ statusCode: 404, message: 'سفارش یافت نشد.' });
    }
    if (state && order.state !== state) {
      throw new BadRequestException({ statusCode: 400, message: 'وضعیت سفارش برای این عملیات مناسب نیست.' });
    }
    return order;
  }

  private async reloadOrder(orderId: string, db: Prisma.TransactionClient = this.prisma) {
    const order = await db.serviceOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { serviceDefinition: true, hardwareUnits: true } },
      },
    });
    if (!order) throw new NotFoundException({ statusCode: 404, message: 'سفارش یافت نشد.' });
    return order;
  }

  private async missingSerials(order: Awaited<ReturnType<WarrantyService['reloadOrder']>>, db: Prisma.TransactionClient = this.prisma) {
    if (order.pricingVersion !== MANAGED_PRICING_VERSION) {
      return order.items.filter((item) =>
        (item.supplyMode ?? order.supplyMode) === 'FULL_PACKAGE' && item.hardwareUnits.length === 0,
      ).map((item) => item.serviceDefinition.titleFa);
    }
    const revision = await activeManagedRevision(db, order);
    if (!revision || revision.status !== 'FUNDED') throw new ConflictException('نسخه تأمین مالی شده سفارش یافت نشد.');
    const keys = managedSerialLineKeys(revision);
    const registered = new Map<string, number>();
    for (const { orderAddonId } of order.items.flatMap((item) => item.hardwareUnits)) {
      if (orderAddonId) registered.set(orderAddonId, (registered.get(orderAddonId) ?? 0) + 1);
    }
    return revision.addons.filter((line) => keys.has(line.lineKey) && (registered.get(line.id) ?? 0) < line.qty)
      .map((line) => line.titleFa);
  }

  private verifyOtp(otp: string, stored: string): boolean {
    const [salt, storedHex] = stored.split(':');
    if (!salt || !storedHex) return false;
    const actual = Buffer.from(scryptSync(otp, salt, 32).toString('hex'), 'hex');
    const expected = Buffer.from(storedHex, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private generatePolicyNumber(): string {
    const serial = Math.floor(100_000 + Math.random() * 900_000);
    return `WR-${new Date().getFullYear()}-${serial}`;
  }

  private addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
  }
}
