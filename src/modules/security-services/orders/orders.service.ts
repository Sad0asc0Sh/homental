import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { OrderState, Prisma } from '@prisma/client';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import type {
  AssignTechnicianDto,
  CancelOrderDto,
  CreateOrderDto,
  ListOrdersDto,
  QuoteOrderDto,
} from './dto/orders.dto';
import { assertValidTransition, stateFa } from './order-state-machine';

/** BigInt-safe JSON for JSONB snapshots (Invariant 13 — money becomes string). */
function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as T;
}

interface EscrowScope {
  customerUserId: string;
  branchId?: string | null;
  orderId: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
    private readonly walletEscrowService: WalletEscrowService,
    private readonly notificationsService: NotificationsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Creation (DRAFT → ESTIMATED with full pricing snapshot) ───────────────

  async create(actor: AuthenticatedUser, dto: CreateOrderDto) {
    const customerProfile = await this.requireCustomerProfile(actor.id);
    const address = await this.prisma.address.findUnique({
      where: { id: dto.addressId },
      include: { city: true },
    });
    if (!address || address.customerId !== customerProfile.id) {
      throw new NotFoundException({ statusCode: 404, message: 'آدرس یافت نشد یا متعلق به شما نیست.' });
    }
    if (dto.securityProfileId) {
      const securityProfile = await this.prisma.securityProfile.findUnique({
        where: { id: dto.securityProfileId },
      });
      if (!securityProfile || securityProfile.customerId !== customerProfile.id) {
        throw new NotFoundException({ statusCode: 404, message: 'پروفایل امنیتی یافت نشد.' });
      }
    }

    const branch = await this.prisma.branch.findFirst({
      where: { cityId: address.cityId, isActive: true },
    });

    const estimate = await this.pricingService.estimate({
      citySlug: address.city.slug,
      lat: Number(address.lat),
      lng: Number(address.lng),
      urgency: dto.urgency,
      supplyMode: dto.supplyMode,
      items: dto.items,
    });

    const definitionRows = await this.prisma.serviceDefinition.findMany({
      where: { key: { in: dto.items.map((item) => item.serviceKey) }, isActive: true },
      select: { id: true, key: true },
    });
    const definitionIdByKey = new Map(definitionRows.map((row) => [row.key, row.id]));

    const orderNumber = this.generateOrderNumber();
    const created = await this.prisma.$transaction(async (db) => {
      const order = await db.serviceOrder.create({
        data: {
          orderNumber,
          customerId: actor.id,
          branchId: branch?.id ?? null,
          addressId: address.id,
          securityProfileId: dto.securityProfileId ?? null,
          state: 'ESTIMATED',
          locationType: address.locationType,
          urgency: dto.urgency ?? 'SCHEDULED',
          supplyMode: dto.supplyMode ?? 'FULL_PACKAGE',
          lat: address.lat,
          lng: address.lng,
          pricing: toJsonSafe(estimate) as unknown as Prisma.InputJsonValue,
          surgeMultiplier: estimate.factors.surge.multiplier,
          urgencyMultiplier: estimate.factors.urgency.multiplier,
          bundleDiscountPercent: estimate.summary.bundleDiscountPercent,
        },
      });

      for (const item of dto.items) {
        const definitionId = definitionIdByKey.get(item.serviceKey);
        if (!definitionId) {
          throw new BadRequestException({
            statusCode: 400,
            message: `سرویس «${item.serviceKey}» فعال نیست.`,
          });
        }
        const breakdown = estimate.items.find((entry) => entry.serviceKey === item.serviceKey);
        await db.orderItem.create({
          data: {
            orderId: order.id,
            serviceDefinitionId: definitionId,
            supplyMode: item.supplyMode ?? dto.supplyMode ?? 'FULL_PACKAGE',
            config: (item.config ?? {}) as unknown as Prisma.InputJsonValue,
            pricingSnapshot: toJsonSafe(breakdown ?? null) as unknown as Prisma.InputJsonValue,
          },
        });
      }

      await db.orderStateTransition.createMany({
        data: [
          { orderId: order.id, fromState: null, toState: 'DRAFT', actorUserId: actor.id, actorRole: actor.role, reason: 'ایجاد سفارش' },
          { orderId: order.id, fromState: 'DRAFT', toState: 'ESTIMATED', actorUserId: actor.id, actorRole: actor.role, reason: 'برآورد قیمت موفق' },
        ],
      });
      return order;
    });

    return { order: created, estimate: toJsonSafe(estimate) };
  }

  // ── Role-scoped reads ─────────────────────────────────────────────────────

  private listWhereFor(actor: AuthenticatedUser): { customerId?: string; technicianId?: string; branchId?: string | null } {
    switch (actor.role) {
      case UserRole.CUSTOMER:
        return { customerId: actor.id };
      case UserRole.TECHNICIAN:
        return { technicianId: actor.id };
      case UserRole.BRANCH_ADMIN:
        // An unassigned branch admin sees NOTHING (never an all-branch query).
        return { branchId: actor.branchId ?? '__none__' };
      case UserRole.SUPER_ADMIN:
      default:
        return {};
    }
  }

  async list(actor: AuthenticatedUser, query: ListOrdersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = this.listWhereFor(actor);
    if (where.branchId === '__none__') {
      return { items: [], total: 0, page, limit };
    }
    const [items, total] = await Promise.all([
      this.prisma.serviceOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          items: { include: { serviceDefinition: { select: { key: true, titleFa: true } } } },
        },
      }),
      this.prisma.serviceOrder.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  private async requireVisibleOrder(actor: AuthenticatedUser, orderId: string) {
    const order = await this.prisma.serviceOrder.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException({ statusCode: 404, message: 'سفارش یافت نشد.' });
    }
    const allowed =
      actor.role === UserRole.SUPER_ADMIN ||
      (actor.role === UserRole.CUSTOMER && order.customerId === actor.id) ||
      (actor.role === UserRole.TECHNICIAN && order.technicianId === actor.id) ||
      (actor.role === UserRole.BRANCH_ADMIN &&
        actor.branchId !== null &&
        order.branchId === actor.branchId);
    if (!allowed) {
      throw new NotFoundException({ statusCode: 404, message: 'سفارش یافت نشد.' });
    }
    return order;
  }

  async getOne(actor: AuthenticatedUser, orderId: string) {
    await this.requireVisibleOrder(actor, orderId);
    return this.prisma.serviceOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { serviceDefinition: { select: { key: true, titleFa: true } } } },
        stateTransitions: { orderBy: { createdAt: 'asc' } },
        review: true,
      },
    });
  }

  // ── Customer & staff actions (guarded transitions) ────────────────────────

  async submit(actor: AuthenticatedUser, orderId: string) {
    const order = await this.requireVisibleOrder(actor, orderId);
    if (order.customerId !== actor.id) {
      throw new ForbiddenException({ statusCode: 403, message: 'فقط سفارش‌های خودتان قابل ارسال هستند.' });
    }
    await this.simpleTransition(order.id, order.state, 'SEARCHING_EXPERT', actor, 'درخواست جستجوی تکنسین');
    await this.notificationsService.send({
      userId: actor.id,
      type: 'ORDER_STATUS_CHANGED',
      titleFa: 'سفارش شما ثبت شد',
      bodyFa: `سفارش ${order.orderNumber} در حال جستجوی تکنسین مناسب است.`,
      data: { orderId: order.id, state: 'SEARCHING_EXPERT' },
    });
    // Part A: auto-kickoff the first dispatch wave without a circular DI
    // dependency — DispatchService listens on this domain event.
    this.eventEmitter.emit('order.searching', { orderId: order.id });
    return { orderId: order.id, state: 'SEARCHING_EXPERT' };
  }

  async branchQueue(actor: AuthenticatedUser, orderId: string) {
    const order = await this.requireVisibleOrder(actor, orderId);
    await this.simpleTransition(order.id, order.state, 'BRANCH_QUEUE', actor, 'ارسال به صف شعبه');
    return { orderId: order.id, state: 'BRANCH_QUEUE' };
  }

  async assignTechnician(actor: AuthenticatedUser, orderId: string, dto: AssignTechnicianDto) {
    const order = await this.requireVisibleOrder(actor, orderId);
    if (order.branchId && actor.role === UserRole.BRANCH_ADMIN && actor.branchId !== order.branchId) {
      throw new ForbiddenException({ statusCode: 403, message: 'شما فقط به سفارش‌های شعبه خودتان دسترسی دارید.' });
    }
    const technician = await this.prisma.technicianProfile.findUnique({
      where: { userId: dto.technicianUserId },
    });
    if (!technician || technician.status !== 'APPROVED') {
      throw new BadRequestException({ statusCode: 400, message: 'تکنسین انتخابی تأیید‌شده نیست.' });
    }
    if (order.branchId && technician.branchId !== order.branchId) {
      throw new BadRequestException({ statusCode: 400, message: 'تکنسین انتخابی متعلق به شعبه این سفارش نیست.' });
    }

    await this.prisma.$transaction(async (db) => {
      await this.transition(db, order.id, order.state, 'EXPERT_ASSIGNED', actor, 'اختصاص تکنسین', {
        technicianUserId: dto.technicianUserId,
      });
      await db.serviceOrder.update({
        where: { id: order.id },
        data: { technicianId: dto.technicianUserId },
      });
    });

    await Promise.all([
      this.notificationsService.send({
        userId: dto.technicianUserId,
        type: 'ORDER_STATUS_CHANGED',
        titleFa: 'سفارش جدید به شما اختصاص یافت',
        bodyFa: `سفارش ${order.orderNumber} به شما اختصاص یافت.`,
        data: { orderId: order.id, state: 'EXPERT_ASSIGNED' },
      }),
      this.notificationsService.send({
        userId: order.customerId,
        type: 'ORDER_STATUS_CHANGED',
        titleFa: 'تکنسین شما انتخاب شد',
        bodyFa: `برای سفارش ${order.orderNumber} تکنسین اختصاص یافت.`,
        data: { orderId: order.id, state: 'EXPERT_ASSIGNED' },
      }),
    ]);
    return { orderId: order.id, state: 'EXPERT_ASSIGNED', technicianId: dto.technicianUserId };
  }

  async enRoute(actor: AuthenticatedUser, orderId: string) {
    return this.technicianTransition(actor, orderId, 'ON_THE_WAY', 'تکنسین در مسیر است');
  }

  async startInspection(actor: AuthenticatedUser, orderId: string) {
    return this.technicianTransition(actor, orderId, 'INSPECTING', 'شروع بازدید و کارشناسی');
  }

  async quote(actor: AuthenticatedUser, orderId: string, dto: QuoteOrderDto) {
    const order = await this.requireAssignedOrder(actor, orderId);
    if (order.state !== 'INSPECTING') {
      throw new BadRequestException({
        statusCode: 400,
        message: `ثبت پیش‌فاکتور فقط در وضعیت «${stateFa('INSPECTING')}» ممکن است.`,
      });
    }
    const finalQuoteAmount = BigInt(dto.finalQuoteAmount);
    // Part A hardening: a non-positive quote is never acceptable.
    if (finalQuoteAmount <= 0n) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'مبلغ پیش‌فاکتور باید بزرگ‌تر از صفر باشد.',
      });
    }
    await this.prisma.serviceOrder.update({
      where: { id: order.id },
      data: { finalQuoteAmount },
    });
    await this.notificationsService.send({
      userId: order.customerId,
      type: 'ORDER_STATUS_CHANGED',
      titleFa: 'پیش‌فاکتور نهایی آماده است',
      bodyFa: `پیش‌فاکتور سفارش ${order.orderNumber} ثبت شد؛ برای شروع نصب، مبلغ را تأیید کنید.`,
      data: { orderId: order.id, finalQuoteAmount: dto.finalQuoteAmount },
    });
    return { orderId: order.id, finalQuoteAmount: dto.finalQuoteAmount };
  }

  async approveQuote(actor: AuthenticatedUser, orderId: string) {
    const order = await this.requireVisibleOrder(actor, orderId);
    if (order.customerId !== actor.id) {
      throw new ForbiddenException({ statusCode: 403, message: 'فقط مشتری سفارش می‌تواند پیش‌فاکتور را تأیید کند.' });
    }
    if (order.state !== 'INSPECTING' || !order.finalQuoteAmount) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'تأیید پیش‌فاکتور نیازمند ثبت مبلغ نهایی توسط تکنسین در وضعیت بازدید است.',
      });
    }
    const escrowAmount = order.finalQuoteAmount;

    const escrowScope: EscrowScope = { customerUserId: actor.id, orderId: order.id };
    await this.prisma.$transaction(async (db) => {
      await this.walletEscrowService.holdEscrow(
        {
          customerUserId: escrowScope.customerUserId,
          orderId: escrowScope.orderId,
          amount: escrowAmount,
          idempotencyKey: `escrow:hold:${order.id}`,
        },
        db,
      );
      await this.transition(db, order.id, order.state, 'QUOTE_APPROVED', actor, 'تأیید پیش‌فاکتور و مسدودسازی اسکرو');
    });

    await this.notificationsService.send({
      userId: order.technicianId ?? actor.id,
      type: 'ORDER_STATUS_CHANGED',
      titleFa: 'پیش‌فاکتور تأیید شد',
      bodyFa: `مشتری پیش‌فاکتور سفارش ${order.orderNumber} را تأیید کرد؛ مبلغ در اسکرو مسدود شد.`,
      data: { orderId: order.id, state: 'QUOTE_APPROVED' },
    });
    return { orderId: order.id, state: 'QUOTE_APPROVED' };
  }

  async startWork(actor: AuthenticatedUser, orderId: string) {
    return this.technicianTransition(actor, orderId, 'IN_PROGRESS', 'شروع عملیات نصب');
  }

  async cancel(actor: AuthenticatedUser, orderId: string, dto: CancelOrderDto) {
    const order = await this.requireVisibleOrder(actor, orderId);
    const isOwner = actor.role === UserRole.CUSTOMER && order.customerId === actor.id;
    const isBranchAdminOfOrder =
      actor.role === UserRole.BRANCH_ADMIN &&
      actor.branchId !== null &&
      order.branchId === actor.branchId;
    if (!isOwner && !isBranchAdminOfOrder && actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException({ statusCode: 403, message: 'شما مجاز به لغو این سفارش نیستید.' });
    }

    assertValidTransition(order.state, 'CANCELLED'); // 409 for IN_PROGRESS+
    const escrowAmount = order.finalQuoteAmount;

    await this.prisma.$transaction(async (db) => {
      if (order.state === 'QUOTE_APPROVED' && escrowAmount !== null) {
        // Escrow already held → refund atomically with the cancellation.
        await this.walletEscrowService.refundEscrow(
          {
            customerUserId: order.customerId,
            orderId: order.id,
            amount: escrowAmount,
            idempotencyKey: `escrow:refund:${order.id}`,
            reason: dto.reason,
          },
          db,
        );
      }
      const updated = await db.serviceOrder.updateMany({
        where: { id: order.id, state: order.state },
        data: {
          state: 'CANCELLED',
          cancelReason: dto.reason,
          cancelledAt: new Date(),
          cancelledByUserId: actor.id,
        },
      });
      if (updated.count === 0) {
        throw new BadRequestException({ statusCode: 409, message: 'وضعیت سفارش تغییر کرده است؛ دوباره تلاش کنید.' });
      }
      await db.orderStateTransition.create({
        data: {
          orderId: order.id,
          fromState: order.state,
          toState: 'CANCELLED',
          actorUserId: actor.id,
          actorRole: actor.role,
          reason: dto.reason ?? 'لغو سفارش',
        },
      });
    });

    return { orderId: order.id, state: 'CANCELLED' };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async technicianTransition(
    actor: AuthenticatedUser,
    orderId: string,
    toState: OrderState,
    reason: string,
  ) {
    const order = await this.requireAssignedOrder(actor, orderId);
    await this.simpleTransition(order.id, order.state, toState, actor, reason);
    return { orderId: order.id, state: toState };
  }

  private async requireAssignedOrder(actor: AuthenticatedUser, orderId: string) {
    if (actor.role !== UserRole.TECHNICIAN) {
      throw new ForbiddenException({ statusCode: 403, message: 'این عملیات مخصوص تکنسین سفارش است.' });
    }
    const order = await this.prisma.serviceOrder.findUnique({ where: { id: orderId } });
    if (!order || order.technicianId !== actor.id) {
      throw new NotFoundException({ statusCode: 404, message: 'سفارش یافت نشد.' });
    }
    return order;
  }

  private async simpleTransition(
    orderId: string,
    fromState: OrderState,
    toState: OrderState,
    actor: AuthenticatedUser,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.$transaction(async (db) => {
      await this.transition(db, orderId, fromState, toState, actor, reason, metadata);
    });
  }

  /** Optimistic guarded transition + append-only audit row (Invariant 8). */
  private async transition(
    db: Prisma.TransactionClient,
    orderId: string,
    fromState: OrderState,
    toState: OrderState,
    actor: AuthenticatedUser,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    assertValidTransition(fromState, toState);
    const updated = await db.serviceOrder.updateMany({
      where: { id: orderId, state: fromState },
      data: { state: toState },
    });
    if (updated.count === 0) {
      throw new BadRequestException({
        statusCode: 409,
        message: 'وضعیت سفارش هم‌زمان تغییر کرده است؛ دوباره تلاش کنید.',
      });
    }
    await db.orderStateTransition.create({
      data: {
        orderId,
        fromState,
        toState,
        actorUserId: actor.id,
        actorRole: actor.role,
        reason,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async requireCustomerProfile(userId: string) {
    const profile = await this.prisma.customerProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new ForbiddenException({ statusCode: 403, message: 'فقط کاربران مشتری می‌توانند سفارش ثبت کنند.' });
    }
    return profile;
  }

  private generateOrderNumber(): string {
    const year = new Date().getFullYear();
    const serial = Math.floor(100_000 + Math.random() * 900_000);
    return `HM-${year}-${serial}`;
  }
}
