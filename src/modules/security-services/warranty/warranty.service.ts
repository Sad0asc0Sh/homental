import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderState, type Prisma, type WarrantyClaimStatus } from '@prisma/client';
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { AppConfigService } from '@config/app-config.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RedisService } from '@infra/redis/redis.service';
import { RealtimeEvent, RealtimeService } from '@infra/realtime/realtime.service';

const HANDOVER_OTP_TTL_MS = 10 * 60 * 1000;
const MAX_HANDOVER_ATTEMPTS = 3;
const HANDOVER_RESEND_LIMIT_PER_MINUTE = 1;

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
    dto: { units: Array<{ orderItemId: string; categoryFa: string; brand?: string; model?: string; serialNumber: string }> },
  ) {
    const order = await this.requireAssignedOrder(actor, orderId, OrderState.IN_PROGRESS);

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
    const order = await this.requireAssignedOrderWithItems(actor, orderId, OrderState.IN_PROGRESS);

    // Gate 1: every FULL_PACKAGE item must have at least one registered serial.
    const unpackagedItems: string[] = [];
    for (const item of order.items) {
      const effectiveSupplyMode = item.supplyMode ?? order.supplyMode;
      if (effectiveSupplyMode === 'FULL_PACKAGE' && item.hardwareUnits.length === 0) {
        unpackagedItems.push(item.serviceDefinition.titleFa);
      }
    }
    if (unpackagedItems.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'قبل از تحویل، ثبت شماره سریال تجهیزات نصب‌شده الزامی است.',
        metadata: { items: unpackagedItems },
      });
    }

    // Gate 2: mandatory privacy checklist.
    if (dto.defaultPasswordsChanged !== true || dto.technicianAccessRevoked !== true) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'تأیید تغییر رمزهای پیش‌فرض و حذف دسترسی فنی نصاب برای تحویل کار الزامی است.',
      });
    }

    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const salt = randomBytes(16).toString('hex');
    const handoverOtpHash = `${salt}:${scryptSync(otp, salt, 32).toString('hex')}`;

    await this.prisma.$transaction(async (db) => {
      await db.serviceOrder.update({
        where: { id: order.id },
        data: {
          handoverOtpHash,
          handoverOtpExpiresAt: new Date(Date.now() + HANDOVER_OTP_TTL_MS),
          handoverAttempts: 0,
          privacyChecklistSignedAt: new Date(),
          privacyChecklistAnswers: {
            defaultPasswordsChanged: dto.defaultPasswordsChanged,
            technicianAccessRevoked: dto.technicianAccessRevoked,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      const updated = await db.serviceOrder.updateMany({
        where: { id: order.id, state: OrderState.IN_PROGRESS },
        data: { state: OrderState.HANDOVER_OTP_PENDING },
      });
      if (updated.count === 0) {
        throw new BadRequestException({ statusCode: 409, message: 'وضعیت سفارش تغییر کرده است؛ دوباره تلاش کنید.' });
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
    await this.prisma.serviceOrder.update({
      where: { id: order.id },
      data: {
        handoverOtpHash: `${salt}:${scryptSync(otp, salt, 32).toString('hex')}`,
        handoverOtpExpiresAt: new Date(Date.now() + HANDOVER_OTP_TTL_MS),
      },
    });

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
    const order = await this.requireAssignedOrderWithItems(actor, orderId, OrderState.HANDOVER_OTP_PENDING);
    if (!order.handoverOtpHash || !order.handoverOtpExpiresAt) {
      throw new BadRequestException({ statusCode: 400, message: 'کد تحویلی برای این سفارش صادر نشده است.' });
    }
    if (order.handoverAttempts >= MAX_HANDOVER_ATTEMPTS) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'تعداد تلاش کد تحویل به سقف مجاز رسید؛ با پشتیبانی شعبه تماس بگیرید.',
      });
    }
    if (order.handoverOtpExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({ statusCode: 400, message: 'کد تحویل منقضی شده است؛ از تکنسین بخواهید کد جدید صادر کند.' });
    }
    if (!this.verifyOtp(dto.otp, order.handoverOtpHash)) {
      const attempts = order.handoverAttempts + 1;
      await this.prisma.serviceOrder.update({
        where: { id: order.id },
        data: { handoverAttempts: attempts },
      });
      if (attempts >= MAX_HANDOVER_ATTEMPTS) {
        throw new BadRequestException({
          statusCode: 400,
          message: 'تعداد تلاش کد تحویل به سقف مجاز رسید؛ با پشتیبانی شعبه تماس بگیرید.',
        });
      }
      throw new BadRequestException({ statusCode: 400, message: 'کد تحویل نادرست است.' });
    }
    if (!order.finalQuoteAmount) {
      throw new BadRequestException({ statusCode: 400, message: 'مبلغ نهایی سفارش برای تسویه ثبت نشده است.' });
    }

    const now = new Date();
    const escrowAmount = order.finalQuoteAmount; // narrowed non-null above
    const freshOrder = await this.reloadOrder(order.id);

    const split = await this.prisma.$transaction(async (db) => {
      // 1) Optimistic terminal transition + audit.
      const updated = await db.serviceOrder.updateMany({
        where: { id: order.id, state: OrderState.HANDOVER_OTP_PENDING },
        data: { state: OrderState.COMPLETED_WARRANTY_ACTIVE, completedAt: now },
      });
      if (updated.count === 0) {
        throw new BadRequestException({ statusCode: 409, message: 'وضعیت سفارش تغییر کرده است؛ دوباره تلاش کنید.' });
      }
      await db.orderStateTransition.create({
        data: {
          orderId: order.id,
          fromState: OrderState.HANDOVER_OTP_PENDING,
          toState: OrderState.COMPLETED_WARRANTY_ACTIVE,
          actorUserId: actor.id,
          actorRole: actor.role,
          reason: 'تحویل موفق با تأیید مشتری',
          metadata: {
            otpVerified: true,
            privacyChecklistSigned: true,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      // 2) Escrow release + zero-drift split (commission / reserve / payout).
      const escrowSplit = await this.walletEscrowService.releaseEscrowAndSplit(
        {
          orderId: order.id,
          customerUserId: freshOrder.customerId,
          technicianUserId: actor.id,
          branchId: freshOrder.branchId,
          totalAmount: escrowAmount,
          idempotencyKey: `escrow:release:${order.id}`,
        },
        db,
      );

      // 3) Digital warranty activation.
      const coverageMonths = Math.min(
        ...order.items.map((item) => item.serviceDefinition.warrantyMonths),
      );
      const warranty = await db.warranty.create({
        data: {
          policyNumber: this.generatePolicyNumber(),
          orderId: order.id,
          startDate: now,
          endDate: this.addMonths(now, coverageMonths),
          status: 'ACTIVE',
          coverageMonths,
          coverage: order.items.map((item) => ({
            serviceKey: item.serviceDefinition.key,
            titleFa: item.serviceDefinition.titleFa,
            warrantyMonths: item.serviceDefinition.warrantyMonths,
            serials: item.hardwareUnits.map((unit) => unit.serialNumber),
          })) as unknown as Prisma.InputJsonValue,
          warrantyReserveAmount: escrowSplit.warrantyReserve,
          escrowReleasedAt: now,
        },
      });

      // 4) Technician stats (feeds dispatch scoring + claim rate).
      await db.technicianProfile.update({
        where: { userId: actor.id },
        data: { completedJobs: { increment: 1 } },
      });

      return { escrowSplit, warranty };
    });

    await this.notificationsService.send({
      userId: freshOrder.customerId,
      type: 'WARRANTY_ACTIVATED',
      titleFa: 'گارانتی دیجیتال فعال شد',
      bodyFa: `سفارش ${freshOrder.orderNumber} تکمیل و گارانتی دیجیتال تا ${split.warranty.coverageMonths} ماه فعال شد.`,
      data: { orderId: order.id, warrantyId: split.warranty.id },
    });
    this.realtimeService.emitToOrder(order.id, RealtimeEvent.WARRANTY_ACTIVATED, {
      orderId: order.id,
      warrantyId: split.warranty.id,
      policyNumber: split.warranty.policyNumber,
    });

    return {
      orderId: order.id,
      state: 'COMPLETED_WARRANTY_ACTIVE',
      warranty: split.warranty,
      escrowSplit: split.escrowSplit,
    };
  }

  // ── Customer warranty card & claims ───────────────────────────────────────

  async myWarranties(actor: AuthenticatedUser) {
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
      ...warranty,
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
    return { claim, warrantyStatus: 'IN_CLAIM' };
  }

  async updateClaim(
    actor: AuthenticatedUser,
    claimId: string,
    dto: { status: WarrantyClaimStatus; resolutionNoteFa?: string },
  ) {
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
    return { claim: updated, warrantyStatus: remainingOpen === 0 ? 'ACTIVE' : 'IN_CLAIM' };
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

  private async requireAssignedOrder(actor: AuthenticatedUser, orderId: string, state: OrderState) {
    if (actor.role !== 'TECHNICIAN') {
      throw new ForbiddenException({ statusCode: 403, message: 'این عملیات مخصوص تکنسین سفارش است.' });
    }
    const order = await this.prisma.serviceOrder.findUnique({ where: { id: orderId } });
    if (!order || order.technicianId !== actor.id) {
      throw new NotFoundException({ statusCode: 404, message: 'سفارش یافت نشد.' });
    }
    if (order.state !== state) {
      throw new BadRequestException({ statusCode: 400, message: 'وضعیت سفارش برای این عملیات مناسب نیست.' });
    }
    return order;
  }

  private async requireAssignedOrderWithItems(
    actor: AuthenticatedUser,
    orderId: string,
    state: OrderState,
  ) {
    const order = await this.requireAssignedOrder(actor, orderId, state);
    return this.reloadOrder(order.id);
  }

  private async reloadOrder(orderId: string) {
    const order = await this.prisma.serviceOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { serviceDefinition: true, hardwareUnits: true } },
      },
    });
    if (!order) throw new NotFoundException({ statusCode: 404, message: 'سفارش یافت نشد.' });
    return order;
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
