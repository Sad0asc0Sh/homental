import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DispatchOffer, Prisma, ServiceKey, ServiceOrder } from '@prisma/client';
import { OrderState } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RedisService } from '@infra/redis/redis.service';
import { RealtimeEvent, RealtimeService } from '@infra/realtime/realtime.service';
import { scoreCandidate } from './candidate-scorer';
import type { DispatchWeights } from './candidate-scorer';
import { assertValidTransition } from '../orders/order-state-machine';
import { guaranteedPackageNet } from '../orders/order-projections';
import { MANAGED_PRICING_VERSION } from '../pricing/managed-pricing';
import { dispatchPriorityPolicy } from './dispatch-priority-policy';

type DispatchAudience = 'TOP' | 'ALL';
type DispatchOfferConfig = ReturnType<typeof dispatchPriorityPolicy> & {
  ttlSeconds: number;
  initialRadiusMeters: number;
  radiusStepMeters: number;
  maxRadiusMeters: number;
  maxRounds: number;
  maxParallelOffers: number;
  weights: DispatchWeights;
};

const DEFAULT_DISPATCH_CONFIG = {
  ttlSeconds: 30,
  initialRadiusMeters: 5000,
  radiusStepMeters: 7000,
  maxRadiusMeters: 20000,
  maxRounds: 3,
  maxParallelOffers: 3,
  weights: { proximity: 0.35, skillMatch: 0.25, rating: 0.2, warrantyClaimRate: 0.2 },
};

export const OFFER_TTL_MS = 15_000; // per-order Redis lock TTL (Invariant 5)
const BRANCH_INVITE_TTL_MS = 5 * 60 * 1000;
const ACTIVE_TECHNICIAN_STATES: OrderState[] = [
  'EXPERT_ASSIGNED', 'ON_THE_WAY', 'INSPECTING', 'QUOTE_APPROVED', 'IN_PROGRESS', 'HANDOVER_OTP_PENDING',
];

/**
 * Snapp-like dispatch: expanding-radius waves over the Redis GEO technician
 * index, Postgres eligibility filtering, weighted scoring, parallel offers
 * with a 30s TTL — and an ATOMIC per-order lock for single-winner acceptance
 * (Invariant 5).
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly realtimeService: RealtimeService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async getDispatchConfig(): Promise<DispatchOfferConfig> {
    const row = await this.prisma.platformConfig.findUnique({ where: { key: 'dispatch.offer' } });
    const value = (row?.value as Partial<DispatchOfferConfig> | undefined) ?? {};
    return {
      ...DEFAULT_DISPATCH_CONFIG,
      ...value,
      weights: { ...DEFAULT_DISPATCH_CONFIG.weights, ...(value.weights ?? {}) },
      ...dispatchPriorityPolicy(row?.value),
    };
  }

  /** Auto-kickoff listener wired by OrdersService.submit() (no DI cycle). */
  @OnEvent('order.searching')
  async onOrderSearching(payload: { orderId: string }): Promise<void> {
    try {
      await this.startSearch(payload.orderId);
    } catch (error: unknown) {
      this.logger.error(
        `Dispatch search failed for ${payload.orderId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * High funded offers open the initial radius to TOP first. ALL then starts
   * at the initial radius and advances past previously opened ALL rings.
   * Exhausted rings move the order to the branch queue.
   */
  async startSearch(orderId: string): Promise<{ offersCreated: number; radiusMeters?: number; queued?: boolean }> {
    const order = await this.prisma.serviceOrder.findUnique({
      where: { id: orderId },
      include: { items: { include: { serviceDefinition: { select: { key: true } } } }, address: { include: { city: true } } },
    });
    if (!order || order.state !== OrderState.SEARCHING_EXPERT) return { offersCreated: 0 };
    if (order.lat === null || order.lng === null) {
      return { queued: await this.queueForBranch(order.id), offersCreated: 0 };
    }

    const [config, revision, history] = await Promise.all([
      this.getDispatchConfig(),
      this.offerRevision(this.prisma, order),
      this.prisma.dispatchOffer.findMany({ where: { orderId, isBranchInvite: false } }),
    ]);
    const requiredSkills = [...new Set(order.items.map((item) => item.serviceDefinition.key))];
    if (history.some((offer) => offer.status === 'PENDING')) return { offersCreated: 0 };
    const topFirst = revision?.status === 'FUNDED' && revision.sliderBps >= config.priorityThresholdBps;
    const net = guaranteedPackageNet(revision?.technicianTermsJson);
    const previouslyOffered = new Set(history.map((offer) => offer.technicianId));
    const tryWave = async (radiusMeters: number, audience: DispatchAudience, firstWave: number) => {
      const offersCreated = await this.runWave(order, requiredSkills, config, {
        radiusMeters, previouslyOffered, net, audience, firstWave,
      });
      if (offersCreated === null) return { offersCreated: 0 };
      if (offersCreated === 0) return null;
      this.realtimeService.emitToOrder(order.id, RealtimeEvent.ORDER_SEARCHING, { orderId, radiusMeters, offersCreated });
      return { offersCreated, radiusMeters };
    };

    if (topFirst && history.length === 0) {
      const first = await tryWave(config.initialRadiusMeters, 'TOP', 1);
      if (first) return first;
    }
    const lastAllRadius = history.reduce(
      (max, offer) => offer.audience === 'TOP' ? max : Math.max(max, offer.radiusMeters),
      0,
    );
    for (let round = 0; round < config.maxRounds; round += 1) {
      const radius = Math.min(config.initialRadiusMeters + round * config.radiusStepMeters, config.maxRadiusMeters);
      if (radius > lastAllRadius) {
        const result = await tryWave(radius, 'ALL', topFirst ? 2 : 1);
        if (result) return result;
      }
      if (radius === config.maxRadiusMeters) break;
    }
    return { queued: await this.queueForBranch(order.id), offersCreated: 0 };
  }

  private async runWave(
    order: Pick<ServiceOrder, 'id' | 'orderNumber' | 'lat' | 'lng'> &
      { address?: { city?: { slug?: string } } | null },
    requiredSkills: ServiceKey[],
    config: DispatchOfferConfig,
    wavePlan: {
      radiusMeters: number; previouslyOffered: ReadonlySet<string>; net: string | null;
      audience: DispatchAudience; firstWave: number;
    },
  ): Promise<number | null> {
    const { radiusMeters, previouslyOffered, net, audience, firstWave } = wavePlan;
    const nearby = await this.redis.findNearbyTechs(
      order.address?.city?.slug ?? 'mashhad', Number(order.lat), Number(order.lng), radiusMeters, 50,
    );
    const techIds = nearby.map(({ techId }) => techId).filter((id) => !previouslyOffered.has(id));
    if (techIds.length === 0) return 0;
    const profiles = await this.prisma.technicianProfile.findMany({
      where: {
        id: { in: techIds }, isOnline: true, ...this.eligibleTechnician(requiredSkills),
        ...(audience === 'TOP' ? { rating: { gte: config.topMinRating }, ratingCount: { gte: config.topMinReviews } } : {}),
      },
    });
    if (profiles.length === 0) return 0;
    const distanceById = new Map(nearby.map(({ techId, distanceMeters }) => [techId, distanceMeters]));
    const scored = profiles.map((profile) => ({
      profile,
      ...scoreCandidate({
        distanceMeters: distanceById.get(profile.id) ?? radiusMeters, skills: profile.skills,
        rating: Number(profile.rating), ratingCount: profile.ratingCount, warrantyClaimRate: Number(profile.warrantyClaimRate),
      }, requiredSkills, config.weights, radiusMeters),
    })).sort((a, b) => b.score - a.score || a.profile.id.localeCompare(b.profile.id))
      .slice(0, config.maxParallelOffers);

    const result = await this.prisma.$transaction(async (db) => {
      if (await this.lockOrderState(db, order.id) !== 'SEARCHING_EXPERT') return null;
      const pending = await db.dispatchOffer.count({ where: { orderId: order.id, status: 'PENDING' } });
      if (pending > 0) return null;
      const history = await db.dispatchOffer.findMany({ where: { orderId: order.id, isBranchInvite: false } });
      // TOP at the initial radius still leaves that radius open to ALL tiers.
      if (history.some((offer) => audience === 'TOP' || (offer.audience !== 'TOP' && offer.radiusMeters >= radiusMeters))) {
        return null;
      }
      const seen = new Set(history.map((offer) => offer.technicianId));
      const wave = Math.max(firstWave, await this.nextWave(db, order.id));
      const expiresAt = new Date(Date.now() + (audience === 'TOP' ? 30 : config.ttlSeconds) * 1000);
      const offers: { offer: DispatchOffer; userId: string }[] = [];
      for (const candidate of scored) {
        if (seen.has(candidate.profile.id)) continue;
        const offer = await db.dispatchOffer.create({
          data: {
            orderId: order.id, technicianId: candidate.profile.id, wave, audience,
            radiusMeters, distanceMeters: distanceById.get(candidate.profile.id) ?? null,
            score: candidate.score, scoreBreakdown: candidate.scoreBreakdown,
            orderLockKey: this.redis.orderLockKey(order.id), expiresAt,
          },
        });
        offers.push({ offer, userId: candidate.profile.userId });
      }
      return offers;
    });
    if (!result) return null;
    await Promise.all(result.map(({ offer, userId }) => this.publishOffer(userId, order.orderNumber, offer, net)));
    return result.length;
  }

  async inviteTechnician(actor: AuthenticatedUser, orderId: string, technicianUserId: string) {
    if (actor.role !== 'BRANCH_ADMIN' && actor.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const result = await this.prisma.$transaction(async (db) => {
      await this.lockOrderState(db, orderId);
      const order = await db.serviceOrder.findUnique({
        where: { id: orderId },
        include: { items: { include: { serviceDefinition: { select: { key: true } } } } },
      });
      if (!order || (actor.role === 'BRANCH_ADMIN' && (!actor.branchId || order.branchId !== actor.branchId))) {
        throw new NotFoundException('سفارش یافت نشد.');
      }
      if (order.state !== 'BRANCH_QUEUE') throw new ConflictException('فقط برای سفارش‌های صف شعبه می‌توان دعوت‌نامه فرستاد.');
      const profile = await db.technicianProfile.findUnique({ where: { userId: technicianUserId } });
      if (!profile || !order.branchId || profile.branchId !== order.branchId) {
        throw new BadRequestException('تکنسین انتخاب‌شده در این شعبه قابل اعزام نیست.');
      }
      const now = new Date();
      const scope = { orderId, technicianId: profile.id, status: 'PENDING' as const };
      await db.dispatchOffer.updateMany({
        where: { ...scope, expiresAt: { lte: now } }, data: { status: 'EXPIRED', respondedAt: now },
      });
      const existing = await db.dispatchOffer.findFirst({ where: scope });
      if (existing?.isBranchInvite) return { offer: existing, alreadySent: true, order, net: null };
      if (existing) throw new ConflictException('تکنسین برای این سفارش پیشنهاد فعالی دارد.');
      const skills = order.items.map((item) => item.serviceDefinition.key);
      const eligible = await db.technicianProfile.findFirst({
        where: { id: profile.id, branchId: order.branchId, ...this.eligibleTechnician(skills) },
      });
      if (!eligible) throw new BadRequestException('تکنسین ظرفیت آزاد یا تمام مهارت‌های لازم برای این سفارش را ندارد.');
      const wave = await this.nextWave(db, order.id);
      const net = await this.offerGuarantee(db, order);
      const offer = await db.dispatchOffer.create({
        data: {
          orderId, technicianId: profile.id, wave, audience: 'BRANCH', isBranchInvite: true,
          radiusMeters: 0, score: 0, scoreBreakdown: {}, orderLockKey: this.redis.orderLockKey(orderId),
          expiresAt: new Date(now.getTime() + BRANCH_INVITE_TTL_MS),
        },
      });
      return { offer, alreadySent: false, order, net };
    });
    if (!result.alreadySent) {
      await this.publishOffer(technicianUserId, result.order.orderNumber, result.offer, result.net);
    }
    return { orderId, offerId: result.offer.id, expiresAt: result.offer.expiresAt };
  }

  async listMyOffers(actor: AuthenticatedUser) {
    if (actor.role !== 'TECHNICIAN') throw new ForbiddenException();
    const offers = await this.prisma.dispatchOffer.findMany({
      where: { technician: { userId: actor.id }, status: 'PENDING', expiresAt: { gt: new Date() },
        order: { state: { in: ['SEARCHING_EXPERT', 'BRANCH_QUEUE'] } } },
      include: { order: true },
      orderBy: { expiresAt: 'asc' },
    });
    return Promise.all(offers.map(async (offer) => this.offerView(
      offer.order.orderNumber, offer, await this.offerGuarantee(this.prisma, offer.order),
    )));
  }

  private async nextWave(db: Prisma.TransactionClient, orderId: string) {
    const previous = await db.dispatchOffer.findFirst({ where: { orderId, attempt: 1 }, orderBy: { wave: 'desc' } });
    return (previous?.wave ?? 0) + 1;
  }

  private async lockOrderState(db: Prisma.TransactionClient, orderId: string) {
    const [order] = await db.$queryRaw<{ state: OrderState }[]>`
      SELECT "state" FROM "ServiceOrder" WHERE "id" = ${orderId}::uuid FOR UPDATE
    `;
    return order?.state;
  }

  private eligibleTechnician(skills: ServiceKey[]): Prisma.TechnicianProfileWhereInput {
    return {
      status: 'APPROVED', isAcceptingOffers: true, skills: { hasEvery: skills },
      user: {
        role: 'TECHNICIAN', status: 'ACTIVE',
        assignedOrders: { none: { state: { in: ACTIVE_TECHNICIAN_STATES } } },
      },
    };
  }

  private offerRevision(db: Prisma.TransactionClient, order: Pick<ServiceOrder, 'id' | 'activeRevision' | 'pricingVersion'>) {
    if (order.pricingVersion !== MANAGED_PRICING_VERSION) return null;
    return db.orderPriceRevision.findUnique({
      where: { orderId_revision: { orderId: order.id, revision: order.activeRevision } },
      select: { technicianTermsJson: true, sliderBps: true, status: true },
    });
  }

  private async offerGuarantee(db: Prisma.TransactionClient, order: Pick<ServiceOrder, 'id' | 'activeRevision' | 'pricingVersion'>) {
    const revision = await this.offerRevision(db, order);
    return guaranteedPackageNet(revision?.technicianTermsJson);
  }

  private offerView(orderNumber: string, offer: DispatchOffer, net: string | null) {
    return {
      offerId: offer.id, orderId: offer.orderId, orderNumber, score: Number(offer.score),
      expiresAt: offer.expiresAt.toISOString(), expiresInMs: Math.max(0, offer.expiresAt.getTime() - Date.now()),
      isBranchInvite: offer.isBranchInvite, guaranteedPackageNet: net,
    };
  }

  private async publishOffer(userId: string, orderNumber: string, offer: DispatchOffer, net: string | null) {
    const data = this.offerView(orderNumber, offer, net);
    this.realtimeService.emitToUser(userId, RealtimeEvent.DISPATCH_OFFER, data);
    try {
      await this.notificationsService.send({
        userId, type: 'DISPATCH_OFFER',
        titleFa: offer.isBranchInvite ? 'دعوت‌نامه شعبه' : 'پیشنهاد سفارش جدید',
        bodyFa: `پیشنهاد اجرای سفارش ${orderNumber} برای شما ارسال شد.`,
        data,
      });
    } catch (error) {
      this.logger.warn(`Dispatch notification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async queueForBranch(orderId: string): Promise<boolean> {
    const order = await this.prisma.$transaction(async (db) => {
      if (await this.lockOrderState(db, orderId) !== 'SEARCHING_EXPERT') return null;
      if (await db.dispatchOffer.count({ where: { orderId, status: 'PENDING' } })) return null;
      assertValidTransition('SEARCHING_EXPERT', 'BRANCH_QUEUE');
      const queuedOrder = await db.serviceOrder.update({
        where: { id: orderId }, data: { state: 'BRANCH_QUEUE' },
        include: { branch: { select: { adminId: true } } },
      });
      await db.orderStateTransition.create({
        data: { orderId, fromState: 'SEARCHING_EXPERT', toState: 'BRANCH_QUEUE', reason: 'NO_TECHNICIAN_IN_RADIUS' },
      });
      return queuedOrder;
    });
    if (order?.branch?.adminId) {
      await this.notificationsService.send({
        userId: order.branch.adminId, type: 'ORDER_STATUS_CHANGED',
        titleFa: 'سفارش در صف شعبه',
        bodyFa: `سفارش ${order.orderNumber} به صف شعبه ارسال شد.`, data: { orderId, state: 'BRANCH_QUEUE' },
      });
    }
    return order !== null;
  }

  async acceptOffer(actor: AuthenticatedUser, offerId: string) {
    if (actor.role !== 'TECHNICIAN') throw new ForbiddenException();
    const offer = await this.prisma.dispatchOffer.findUnique({
      where: { id: offerId },
      include: {
        technician: true,
        order: { include: { items: { include: { serviceDefinition: { select: { key: true } } } } } },
      },
    });
    if (!offer || offer.technician.userId !== actor.id) throw new NotFoundException('پیشنهاد یافت نشد.');
    if (offer.status !== 'PENDING') throw new ConflictException('این پیشنهاد قبلاً پاسخ داده شده است.');
    if (offer.expiresAt.getTime() <= Date.now()) throw new BadRequestException('مهلت این پیشنهاد به پایان رسیده است.');

    const lock = await this.redis.acquireOrderLock(offer.orderId, OFFER_TTL_MS);
    if (!lock.acquired || !lock.token) throw new ConflictException('سفارش در حال بررسی توسط کارشناس دیگری است.');
    const fromState = offer.isBranchInvite ? 'BRANCH_QUEUE' : 'SEARCHING_EXPERT';
    const toState = 'EXPERT_ASSIGNED';
    let losers;
    try {
      losers = await this.prisma.$transaction(async (db) => {
        assertValidTransition(fromState, toState);
        const state = await this.lockOrderState(db, offer.orderId);
        if (state !== fromState) throw new ConflictException('این سفارش دیگر قابل پذیرش نیست.');
        await db.$queryRaw`SELECT "id" FROM "TechnicianProfile" WHERE "id" = ${offer.technicianId}::uuid FOR UPDATE`;
        const skills = offer.order.items.map((item) => item.serviceDefinition.key);
        const eligible = await db.technicianProfile.findFirst({
          where: { id: offer.technicianId, userId: actor.id, ...this.eligibleTechnician(skills),
            ...(offer.isBranchInvite ? { branchId: offer.order.branchId } : {}) },
        });
        if (!eligible) throw new ConflictException('ظرفیت یا شرایط پذیرش سفارش تغییر کرده است.');

        const now = new Date();
        const accepted = await db.dispatchOffer.updateMany({
          where: { id: offer.id, status: 'PENDING', expiresAt: { gt: now } },
          data: { status: 'ACCEPTED', respondedAt: now },
        });
        if (accepted.count !== 1) throw new ConflictException('این پیشنهاد دیگر قابل پذیرش نیست.');
        const updated = await db.serviceOrder.updateMany({
          where: { id: offer.orderId, state: fromState },
          data: { state: toState, technicianId: actor.id },
        });
        if (updated.count !== 1) throw new ConflictException('این سفارش دیگر قابل پذیرش نیست.');

        const pending = { orderId: offer.orderId, status: 'PENDING' as const };
        const otherOffers = await db.dispatchOffer.findMany({
          where: pending, include: { technician: { select: { userId: true } } },
        });
        await db.dispatchOffer.updateMany({ where: pending, data: { status: 'CANCELLED', respondedAt: now } });
        await db.orderStateTransition.create({
          data: {
            orderId: offer.orderId, fromState, toState, actorUserId: actor.id, actorRole: actor.role,
            reason: 'پذیرش پیشنهاد توسط تکنسین', metadata: { offerId, isBranchInvite: offer.isBranchInvite },
          },
        });
        return otherOffers;
      });
    } finally {
      try {
        await this.redis.releaseOrderLock(offer.orderId, lock.token);
      } catch (error) {
        this.logger.warn(`Dispatch lock release failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    for (const loser of losers) {
      this.realtimeService.emitToUser(loser.technician.userId, RealtimeEvent.OFFER_TAKEN, {
        orderId: offer.orderId, offerId: loser.id, takenByAnotherExpert: true,
      });
    }
    this.realtimeService.emitToOrder(offer.orderId, RealtimeEvent.EXPERT_ASSIGNED, {
      orderId: offer.orderId, technicianUserId: actor.id,
    });
    try {
      await this.notificationsService.send({
        userId: offer.order.customerId, type: 'ORDER_STATUS_CHANGED',
        titleFa: 'تکنسین شما انتخاب شد', bodyFa: `برای سفارش ${offer.order.orderNumber} تکنسین اختصاص یافت.`,
        data: { orderId: offer.orderId, state: toState },
      });
    } catch (error) {
      this.logger.warn(`Assignment notification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { orderId: offer.orderId, state: toState, offerId };
  }

  async declineOffer(actor: AuthenticatedUser, offerId: string) {
    if (actor.role !== 'TECHNICIAN') throw new ForbiddenException();
    const offer = await this.prisma.dispatchOffer.findUnique({ where: { id: offerId }, include: { technician: true } });
    if (!offer || offer.technician.userId !== actor.id) throw new NotFoundException('پیشنهاد یافت نشد.');
    const now = new Date();
    const declined = await this.prisma.dispatchOffer.updateMany({
      where: { id: offerId, status: 'PENDING', expiresAt: { gt: now } }, data: { status: 'DECLINED', respondedAt: now },
    });
    if (declined.count !== 1) throw new ConflictException('این پیشنهاد دیگر قابل پاسخ نیست.');
    if (!offer.isBranchInvite) await this.onOrderSearching({ orderId: offer.orderId });
    return { offerId, status: 'DECLINED' };
  }

  async getTechnicianMe(actor: AuthenticatedUser) {
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { userId: actor.id },
    });
    if (!profile) {
      throw new NotFoundException({ statusCode: 404, message: 'پروفایل تکنسین یافت نشد.' });
    }
    return {
      technicianId: profile.id,
      status: profile.status,
      isOnline: profile.isOnline,
      isAcceptingOffers: profile.isAcceptingOffers,
      lastKnownLat: profile.lastKnownLat !== null ? Number(profile.lastKnownLat) : null,
      lastKnownLng: profile.lastKnownLng !== null ? Number(profile.lastKnownLng) : null,
      rating: Number(profile.rating),
      ratingCount: profile.ratingCount,
      completedJobs: profile.completedJobs,
      warrantyClaimRate: Number(profile.warrantyClaimRate),
    };
  }

  async setTechnicianStatus(
    actor: AuthenticatedUser,
    params: { isOnline: boolean; isAcceptingOffers?: boolean; lat?: number; lng?: number },
  ) {
    const profile = await this.requireApprovedProfile(actor.id);
    const citySlug = await this.resolveCitySlug(profile.branchId);

    if (params.isOnline && typeof params.lat === 'number' && typeof params.lng === 'number') {
      await this.prisma.technicianProfile.update({
        where: { id: profile.id },
        data: {
          isOnline: true,
          isAcceptingOffers: params.isAcceptingOffers ?? profile.isAcceptingOffers,
          lastKnownLat: params.lat,
          lastKnownLng: params.lng,
          lastLocationAt: new Date(),
        },
      });
      await this.redis.addTechLocation(citySlug, profile.id, params.lat, params.lng);
    } else {
      await this.prisma.technicianProfile.update({
        where: { id: profile.id },
        data: {
          isOnline: false,
          ...(params.isAcceptingOffers !== undefined ? { isAcceptingOffers: params.isAcceptingOffers } : {}),
        },
      });
      await this.redis.removeTechLocation(citySlug, profile.id);
    }
    return {
      technicianId: profile.id,
      isOnline: params.isOnline,
      isAcceptingOffers: params.isAcceptingOffers ?? profile.isAcceptingOffers,
    };
  }

  async updateTechnicianLocation(
    actor: AuthenticatedUser,
    params: { lat: number; lng: number },
  ) {
    const profile = await this.requireApprovedProfile(actor.id);
    const citySlug = await this.resolveCitySlug(profile.branchId);
    await this.prisma.technicianProfile.update({
      where: { id: profile.id },
      data: {
        lastKnownLat: params.lat,
        lastKnownLng: params.lng,
        lastLocationAt: new Date(),
      },
    });
    await this.redis.addTechLocation(citySlug, profile.id, params.lat, params.lng);

    const activeOrder = await this.prisma.serviceOrder.findFirst({
      where: {
        technicianId: actor.id,
        state: { in: [OrderState.EXPERT_ASSIGNED, OrderState.ON_THE_WAY] },
      },
      select: { id: true },
    });
    if (activeOrder) {
      this.realtimeService.emitToOrder(activeOrder.id, RealtimeEvent.EXPERT_LOCATION_UPDATE, {
        orderId: activeOrder.id,
        lat: params.lat,
        lng: params.lng,
        timestamp: new Date().toISOString(),
      });
    }
    return { technicianId: profile.id, lat: params.lat, lng: params.lng };
  }

  private async requireApprovedProfile(userId: string) {
    const profile = await this.prisma.technicianProfile.findUnique({ where: { userId } });
    if (!profile || profile.status !== 'APPROVED') {
      throw new BadRequestException({ statusCode: 400, message: 'فقط تکنسین‌های تأییدشده می‌توانند آنلاین شوند.' });
    }
    return profile;
  }

  private async resolveCitySlug(branchId: string | null): Promise<string> {
    if (!branchId) return 'mashhad';
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      include: { city: { select: { slug: true } } },
    });
    return branch?.city?.slug ?? 'mashhad';
  }
}
