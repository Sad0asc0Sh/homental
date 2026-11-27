import {
  BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { OrderState, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { MANAGED_PRICING_VERSION, validateSliderBps } from '../pricing/managed-pricing';
import { PricingService } from '../pricing/pricing.service';
import type { AssignTechnicianDto, CancelOrderDto, CreateOrderDto, InspectionScopeDto, ListOrdersDto, SubmitOrderDto, UpdateOrderPropertyDto } from './dto/orders.dto';
import { activeManagedRevision, cancelManagedOrder, createManagedRevision, fundManagedOrder, jsonSnapshot } from './managed-order-economics';
import {
  ORDER_PROJECTION_INCLUDE, SELLER_FULFILLMENT_INCLUDE, toAdminFinanceView, toBranchOrderView,
  toCustomerOrderView, toSellerOrderView, toTechnicianOrderView,
} from './order-projections';
import { assertValidTransition } from './order-state-machine';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
    private readonly walletEscrowService: WalletEscrowService,
    private readonly notificationsService: NotificationsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateOrderDto) {
    if (actor.role !== 'CUSTOMER') throw new ForbiddenException();
    const customerProfile = await this.prisma.customerProfile.findUnique({ where: { userId: actor.id } });
    if (!customerProfile) throw new ForbiddenException('برای ثبت سفارش پروفایل مشتری لازم است.');
    const address = await this.prisma.address.findUnique({
      where: { id: dto.addressId },
      include: { city: true },
    });
    if (!address || address.customerId !== customerProfile.id) {
      throw new NotFoundException('نشانی مورد نظر یافت نشد.');
    }
    if (dto.securityProfileId) {
      const securityProfile = await this.prisma.securityProfile.findUnique({ where: { id: dto.securityProfileId } });
      if (!securityProfile || securityProfile.customerId !== customerProfile.id) {
        throw new NotFoundException('پروفایل امنیتی یافت نشد.');
      }
    }
    if (dto.propertyId) {
      const property = await this.prisma.customerProperty.findUnique({ where: { id: dto.propertyId } });
      if (!property) {
        throw new NotFoundException('ملک مورد نظر یافت نشد.');
      }
      if (property.userId !== actor.id) {
        throw new ForbiddenException('شما مجوز استفاده از این ملک را ندارید.');
      }
      if (property.isArchived) {
        throw new NotFoundException('ملک مورد نظر بایگانی شده است.');
      }
    }
    const branch = await this.prisma.branch.findFirst({
      where: { cityId: address.cityId, isActive: true },
      orderBy: { code: 'asc' },
    });
    const price = await this.pricingService.estimateManaged({
      citySlug: address.city.slug,
      lat: Number(address.lat),
      lng: Number(address.lng),
      urgency: dto.urgency,
      supplyMode: dto.supplyMode,
      sliderBps: dto.sliderBps,
      items: dto.items,
    }, { cityId: address.cityId, branchId: branch?.id ?? null });
    const definitions = await this.prisma.serviceDefinition.findMany({
      where: { key: { in: dto.items.map((item) => item.serviceKey) }, isActive: true },
      select: { id: true, key: true },
    });
    const definitionIds = new Map(definitions.map(({ key, id }) => [key, id]));

    const created = await this.prisma.$transaction(async (db) => {
      const order = await db.serviceOrder.create({
        data: {
          orderNumber: this.generateOrderNumber(), customerId: actor.id, branchId: branch?.id,
          addressId: address.id, securityProfileId: dto.securityProfileId,
          ...(dto.propertyId ? { propertyId: dto.propertyId } : {}),
          state: 'ESTIMATED',
          locationType: address.locationType, urgency: dto.urgency ?? 'SCHEDULED',
          supplyMode: dto.supplyMode ?? 'FULL_PACKAGE', lat: address.lat, lng: address.lng,
          pricingVersion: MANAGED_PRICING_VERSION, activeRevision: 1,
          surgeMultiplier: price.customerView.factors.surge.multiplier,
          urgencyMultiplier: price.customerView.factors.urgency.multiplier,
          bundleDiscountPercent: price.customerView.summary.bundleDiscountPercent,
        },
      });
      const orderItemIds = new Map<string, string>();
      for (const item of dto.items) {
        const definitionId = definitionIds.get(item.serviceKey);
        if (!definitionId) throw new BadRequestException('خدمت انتخاب‌شده در دسترس نیست.');
        const saved = await db.orderItem.create({
          data: {
            orderId: order.id, serviceDefinitionId: definitionId, supplyMode: item.supplyMode,
            config: jsonSnapshot(item.config ?? {}),
          },
        });
        orderItemIds.set(item.serviceKey, saved.id);
      }
      await createManagedRevision(db, order.id, price, orderItemIds);
      assertValidTransition('DRAFT', 'ESTIMATED');
      await db.orderStateTransition.createMany({
        data: [
          { orderId: order.id, fromState: null, toState: 'DRAFT', actorUserId: actor.id, actorRole: actor.role, reason: 'ایجاد سفارش' },
          { orderId: order.id, fromState: 'DRAFT', toState: 'ESTIMATED', actorUserId: actor.id, actorRole: actor.role, reason: 'ثبت برآورد سفارش' },
        ],
      });
      return db.serviceOrder.findUniqueOrThrow({ where: { id: order.id }, include: ORDER_PROJECTION_INCLUDE });
    });
    return { order: toCustomerOrderView(created), estimate: price.customerView };
  }

  private orderScope(actor: AuthenticatedUser): Prisma.ServiceOrderWhereInput | null {
    switch (actor.role) {
      case 'CUSTOMER': return { customerId: actor.id };
      case 'TECHNICIAN': return { technicianId: actor.id };
      case 'BRANCH_ADMIN': return actor.branchId ? { branchId: actor.branchId } : null;
      case 'SUPER_ADMIN': return {};
      default: throw new ForbiddenException();
    }
  }

  async list(actor: AuthenticatedUser, query: ListOrdersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    if (actor.role === 'SELLER') return this.listSellerFulfillments(actor, page, limit);
    const where = this.orderScope(actor);
    if (!where) return { items: [], total: 0, page, limit };
    const [orders, total] = await Promise.all([
      this.prisma.serviceOrder.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        include: { ...ORDER_PROJECTION_INCLUDE, transactions: actor.role === 'SUPER_ADMIN' },
      }),
      this.prisma.serviceOrder.count({ where }),
    ]);
    return { items: orders.map((order) => this.projectOrder(actor, order)), total, page, limit };
  }

  async getOne(actor: AuthenticatedUser, orderId: string) {
    if (actor.role === 'SELLER') {
      const shipment = await this.prisma.supplyFulfillment.findFirst({
        where: { orderId, seller: { userId: actor.id } },
        include: SELLER_FULFILLMENT_INCLUDE,
      });
      if (!shipment) throw new NotFoundException('سفارش یافت نشد.');
      return toSellerOrderView(shipment);
    }
    const where = this.orderScope(actor);
    if (!where) throw new NotFoundException('سفارش یافت نشد.');
    const order = await this.prisma.serviceOrder.findUnique({
      where: { id: orderId, AND: [where] },
      include: {
        ...ORDER_PROJECTION_INCLUDE, review: true,
        stateTransitions: { orderBy: { createdAt: 'asc' } },
        transactions: actor.role === 'SUPER_ADMIN',
      },
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد.');
    return this.projectOrder(actor, order);
  }

  async listSellerFulfillments(actor: AuthenticatedUser, page?: number, limit?: number) {
    if (actor.role !== 'SELLER') throw new ForbiddenException();
    const where = { seller: { userId: actor.id } };
    const shipments = await this.prisma.supplyFulfillment.findMany({
      where, orderBy: { createdAt: 'desc' }, include: SELLER_FULFILLMENT_INCLUDE,
      ...(page !== undefined && limit !== undefined ? { skip: (page - 1) * limit, take: limit } : {}),
    });
    const items = shipments.map(toSellerOrderView);
    if (page === undefined || limit === undefined) return items;
    const total = await this.prisma.supplyFulfillment.count({ where });
    return { items, total, page, limit };
  }

  private projectOrder(actor: AuthenticatedUser, order: Parameters<typeof toAdminFinanceView>[1]) {
    // Recheck ownership at projection time as well as in the database query.
    switch (actor.role) {
      case 'CUSTOMER':
        if (order.customerId === actor.id) return toCustomerOrderView(order);
        break;
      case 'TECHNICIAN':
        if (order.technicianId === actor.id) return toTechnicianOrderView(order);
        break;
      case 'BRANCH_ADMIN':
        if (actor.branchId && order.branchId === actor.branchId) return toBranchOrderView(order);
        break;
      case 'SUPER_ADMIN': return toAdminFinanceView(actor.role, order);
      default: throw new ForbiddenException();
    }
    throw new NotFoundException('سفارش یافت نشد.');
  }

  private async requireVisibleOrder(actor: AuthenticatedUser, orderId: string) {
    const where = this.orderScope(actor);
    if (!where) throw new NotFoundException('سفارش یافت نشد.');
    const order = await this.prisma.serviceOrder.findUnique({ where: { id: orderId, AND: [where] } });
    if (!order ||
        (actor.role === 'CUSTOMER' && order.customerId !== actor.id) ||
        (actor.role === 'TECHNICIAN' && order.technicianId !== actor.id) ||
        (actor.role === 'BRANCH_ADMIN' && order.branchId !== actor.branchId)) {
      throw new NotFoundException('سفارش یافت نشد.');
    }
    return order;
  }

  async submit(actor: AuthenticatedUser, orderId: string, dto: SubmitOrderDto = {}) {
    if (actor.role !== 'CUSTOMER') throw new ForbiddenException();
    if (dto.sliderBps !== undefined) validateSliderBps(dto.sliderBps);
    const order = await this.requireVisibleOrder(actor, orderId);
    if (order.pricingVersion !== MANAGED_PRICING_VERSION) {
      throw new ConflictException('این برآورد متعلق به نسخه قدیمی قیمت‌گذاری است. سفارش تازه‌ای ثبت کنید.');
    }
    if (order.state !== 'ESTIMATED') {
      const position = await this.prisma.escrowPosition.findUnique({ where: { orderId } });
      if (position && position.status !== 'REFUNDED') {
        if (dto.sliderBps !== undefined) {
          const revision = await activeManagedRevision(this.prisma, order);
          if (revision?.sliderBps !== dto.sliderBps) {
            throw new ConflictException('درصد بسته پس از ثبت سفارش قابل تغییر نیست.');
          }
        }
        return { orderId, state: order.state };
      }
    }
    await this.prisma.$transaction(async (db) => {
      await this.transition(db, order.id, order.state, 'SEARCHING_EXPERT', actor, 'تأمین مالی و درخواست اعزام تکنسین');
      await fundManagedOrder(db, this.walletEscrowService, order, dto.sliderBps);
    });
    this.eventEmitter.emit('order.searching', { orderId });
    await this.notify({
      userId: actor.id, type: 'ORDER_STATUS_CHANGED', titleFa: 'سفارش ثبت شد',
      bodyFa: `وجه سفارش ${order.orderNumber} در امانت است و جستجوی تکنسین شروع شد.`,
      data: { orderId, state: 'SEARCHING_EXPERT' },
    });
    return { orderId, state: 'SEARCHING_EXPERT' };
  }

  async updateProperty(actor: AuthenticatedUser, orderId: string, dto: UpdateOrderPropertyDto) {
    if (actor.role !== 'CUSTOMER') throw new ForbiddenException();
    const order = await this.requireVisibleOrder(actor, orderId);
    if (order.state === 'COMPLETED_WARRANTY_ACTIVE' || order.state === 'CANCELLED') {
      throw new ConflictException('برای سفارش تکمیل‌شده یا لغوشده امکان تغییر ملک وجود ندارد.');
    }
    if (dto.propertyId) {
      const property = await this.prisma.customerProperty.findUnique({ where: { id: dto.propertyId } });
      if (!property) throw new NotFoundException('ملک مورد نظر یافت نشد.');
      if (property.userId !== actor.id) throw new ForbiddenException('شما مجوز استفاده از این ملک را ندارید.');
      if (property.isArchived) throw new NotFoundException('ملک مورد نظر بایگانی شده است.');
    }
    const updated = await this.prisma.serviceOrder.update({
      where: { id: order.id },
      data: { propertyId: dto.propertyId ?? null },
      include: {
        ...ORDER_PROJECTION_INCLUDE,
        review: true,
        stateTransitions: { orderBy: { createdAt: 'asc' } },
      },
    });
    return toCustomerOrderView(updated);
  }

  async branchQueue(actor: AuthenticatedUser, orderId: string) {
    this.assertDispatcher(actor);
    const order = await this.requireVisibleOrder(actor, orderId);
    await this.prisma.$transaction(async (db) => {
      await this.transition(db, order.id, order.state, 'BRANCH_QUEUE', actor, 'انتقال به صف شعبه', { technicianId: null });
      await db.dispatchOffer.updateMany({
        where: { orderId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() },
      });
    });
    return { orderId, state: 'BRANCH_QUEUE' };
  }

  async assignTechnician(actor: AuthenticatedUser, orderId: string, dto: AssignTechnicianDto) {
    this.assertDispatcher(actor);
    const order = await this.requireVisibleOrder(actor, orderId);
    if (order.pricingVersion === MANAGED_PRICING_VERSION) {
      throw new GoneException('برای سفارش تأمین‌شده، دعوت‌نامه پذیرش برای تکنسین ارسال کنید.');
    }
    const technician = await this.prisma.technicianProfile.findUnique({ where: { userId: dto.technicianUserId } });
    if (!technician || technician.status !== 'APPROVED' || (order.branchId && technician.branchId !== order.branchId)) {
      throw new BadRequestException('تکنسین انتخابی برای این شعبه قابل اعزام نیست.');
    }
    await this.prisma.$transaction((db) =>
      this.transition(db, order.id, order.state, 'EXPERT_ASSIGNED', actor, 'تخصیص تکنسین', { technicianId: dto.technicianUserId }),
    );
    await Promise.all([
      this.notify({
        userId: dto.technicianUserId, type: 'ORDER_STATUS_CHANGED', titleFa: 'سفارش جدید',
        bodyFa: `سفارش ${order.orderNumber} به شما اختصاص یافت.`, data: { orderId, state: 'EXPERT_ASSIGNED' },
      }),
      this.notify({
        userId: order.customerId, type: 'ORDER_STATUS_CHANGED', titleFa: 'تکنسین انتخاب شد',
        bodyFa: `تکنسین سفارش ${order.orderNumber} انتخاب شد.`, data: { orderId, state: 'EXPERT_ASSIGNED' },
      }),
    ]);
    return { orderId, state: 'EXPERT_ASSIGNED', technicianId: dto.technicianUserId };
  }

  async enRoute(actor: AuthenticatedUser, orderId: string) {
    return this.technicianTransition(actor, orderId, 'ON_THE_WAY', 'تکنسین در راه است');
  }

  async startInspection(actor: AuthenticatedUser, orderId: string) {
    return this.technicianTransition(actor, orderId, 'INSPECTING', 'شروع بازدید محل');
  }

  quote(): never {
    throw new GoneException('تعیین قیمت دستی توسط تکنسین غیرفعال شده است؛ از تأیید دامنه کار استفاده کنید.');
  }

  async inspectionScope(actor: AuthenticatedUser, orderId: string, dto: InspectionScopeDto) {
    if (actor.role !== 'TECHNICIAN') throw new ForbiddenException();
    const order = await this.requireVisibleOrder(actor, orderId);
    if (!dto.matchesFrozenScope || dto.revision !== order.activeRevision || order.pricingVersion !== MANAGED_PRICING_VERSION) {
      throw new ConflictException('دامنه کار با نسخه توافق‌شده مطابقت ندارد.');
    }
    if (order.state === 'IN_PROGRESS') return { orderId, state: 'IN_PROGRESS' };
    await this.prisma.$transaction(async (db) => {
      const [revision, escrow] = await Promise.all([
        activeManagedRevision(db, order),
        db.escrowPosition.findUnique({ where: { orderId } }),
      ]);
      if (revision?.status !== 'FUNDED' || escrow?.status !== 'OPEN' || escrow.activeRevision !== dto.revision) {
        throw new ConflictException('نسخه تأمین مالی شده سفارش در دسترس نیست.');
      }
      const guard = { activeRevision: dto.revision, technicianId: actor.id };
      await this.transition(db, orderId, order.state, 'QUOTE_APPROVED', actor, 'تأیید تطابق دامنه کار', {}, guard);
      await this.transition(db, orderId, 'QUOTE_APPROVED', 'IN_PROGRESS', actor, 'شروع اجرای سفارش', {}, guard);
    });
    return { orderId, state: 'IN_PROGRESS' };
  }

  async approveQuote(actor: AuthenticatedUser, orderId: string) {
    if (actor.role !== 'CUSTOMER') throw new ForbiddenException();
    const order = await this.requireVisibleOrder(actor, orderId);
    if (order.pricingVersion === MANAGED_PRICING_VERSION) {
      throw new GoneException('وجه این سفارش هنگام ثبت در امانت قرار می‌گیرد.');
    }
    if (order.state !== 'INSPECTING' || !order.finalQuoteAmount) {
      throw new BadRequestException('پیش‌فاکتور قابل تأیید برای این سفارش یافت نشد.');
    }
    const amount = order.finalQuoteAmount;
    await this.prisma.$transaction(async (db) => {
      await this.transition(db, order.id, order.state, 'QUOTE_APPROVED', actor, 'تأیید پیش‌فاکتور و امانت وجه');
      await this.walletEscrowService.holdEscrow({
        customerUserId: actor.id, orderId, amount, idempotencyKey: `escrow:hold:${order.id}`,
      }, db);
    });
    await this.notify({
      userId: order.technicianId ?? actor.id, type: 'ORDER_STATUS_CHANGED', titleFa: 'پیش‌فاکتور تأیید شد',
      bodyFa: `پیش‌فاکتور سفارش ${order.orderNumber} تأیید شد.`, data: { orderId, state: 'QUOTE_APPROVED' },
    });
    return { orderId, state: 'QUOTE_APPROVED' };
  }

  async startWork(actor: AuthenticatedUser, orderId: string) {
    return this.technicianTransition(actor, orderId, 'IN_PROGRESS', 'شروع اجرای سفارش');
  }

  async cancel(actor: AuthenticatedUser, orderId: string, dto: CancelOrderDto) {
    if (actor.role !== 'CUSTOMER' && actor.role !== 'BRANCH_ADMIN' && actor.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException();
    }
    const order = await this.requireVisibleOrder(actor, orderId);
    if (order.state === 'CANCELLED') return { orderId, state: 'CANCELLED' };
    await this.prisma.$transaction(async (db) => {
      await this.transition(db, orderId, order.state, 'CANCELLED', actor, dto.reason ?? 'لغو سفارش', {
        cancelReason: dto.reason, cancelledAt: new Date(), cancelledByUserId: actor.id,
      });
      if (order.pricingVersion === MANAGED_PRICING_VERSION) {
        await cancelManagedOrder(db, this.walletEscrowService, order, dto.reason);
      } else if (order.state === 'QUOTE_APPROVED' && order.finalQuoteAmount !== null) {
        await this.walletEscrowService.refundEscrow({
          customerUserId: order.customerId, orderId, amount: order.finalQuoteAmount,
          idempotencyKey: `escrow:refund:${order.id}`, reason: dto.reason,
        }, db);
      }
      await db.dispatchOffer.updateMany({
        where: { orderId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() },
      });
    });
    return { orderId, state: 'CANCELLED' };
  }

  private async technicianTransition(actor: AuthenticatedUser, orderId: string, toState: OrderState, reason: string) {
    if (actor.role !== 'TECHNICIAN') throw new ForbiddenException();
    const order = await this.requireVisibleOrder(actor, orderId);
    await this.prisma.$transaction((db) =>
      this.transition(db, order.id, order.state, toState, actor, reason, {}, { technicianId: actor.id }),
    );
    return { orderId, state: toState };
  }

  private async transition(
    db: Prisma.TransactionClient,
    orderId: string,
    fromState: OrderState,
    toState: OrderState,
    actor: AuthenticatedUser,
    reason: string,
    data: Prisma.ServiceOrderUncheckedUpdateManyInput = {},
    guard: Prisma.ServiceOrderWhereInput = {},
  ) {
    assertValidTransition(fromState, toState);
    const updated = await db.serviceOrder.updateMany({
      where: { id: orderId, state: fromState, ...guard },
      data: { ...data, state: toState },
    });
    if (updated.count !== 1) throw new ConflictException('وضعیت سفارش تغییر کرده است. دوباره تلاش کنید.');
    await db.orderStateTransition.create({
      data: { orderId, fromState, toState, actorUserId: actor.id, actorRole: actor.role, reason },
    });
  }

  private assertDispatcher(actor: AuthenticatedUser) {
    if (actor.role !== 'BRANCH_ADMIN' && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
  }

  private async notify(notification: Parameters<NotificationsService['send']>[0]) {
    try {
      await this.notificationsService.send(notification);
    } catch (error) {
      this.logger.warn(`Order notification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private generateOrderNumber() {
    const serial = Math.floor(100_000 + Math.random() * 900_000);
    return `HM-${new Date().getFullYear()}-${serial}`;
  }
}
