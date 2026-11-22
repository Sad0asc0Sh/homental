import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ServiceKey } from '@prisma/client';
import { OrderState } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RedisService } from '@infra/redis/redis.service';
import { RealtimeEvent, RealtimeService } from '@infra/realtime/realtime.service';
import { scoreCandidate } from './candidate-scorer';
import type { DispatchWeights } from './candidate-scorer';

interface DispatchOfferConfig {
  ttlSeconds: number;
  initialRadiusMeters: number;
  radiusStepMeters: number;
  maxRadiusMeters: number;
  maxRounds: number;
  maxParallelOffers: number;
  weights: DispatchWeights;
}

const DEFAULT_DISPATCH_CONFIG: DispatchOfferConfig = {
  ttlSeconds: 30,
  initialRadiusMeters: 5000,
  radiusStepMeters: 7000,
  maxRadiusMeters: 20000,
  maxRounds: 3,
  maxParallelOffers: 3,
  weights: { proximity: 0.35, skillMatch: 0.25, rating: 0.2, warrantyClaimRate: 0.2 },
};

export const OFFER_TTL_MS = 15_000; // per-order Redis lock TTL (Invariant 5)

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
   * Runs expanding-radius waves. Radius progression starts at
   * max(initial, lastOfferRadius + step) so decline/expiry escalations never
   * re-offer the same ring. Zero eligible candidates across all rings →
   * BRANCH_QUEUE fallback (audit reason NO_TECHNICIAN_IN_RADIUS).
   */
  async startSearch(orderId: string): Promise<{ offersCreated: number; radiusMeters?: number; queued?: boolean }> {
    const order = await this.prisma.serviceOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { serviceDefinition: { select: { key: true } } } },
        address: { include: { city: true } },
      },
    });
    if (!order || order.state !== OrderState.SEARCHING_EXPERT) return { offersCreated: 0 };
    if (order.lat === null || order.lng === null) {
      await this.queueForBranch(order.id);
      return { queued: true, offersCreated: 0 };
    }

    const config = await this.getDispatchConfig();
    const requiredSkills = [...new Set(order.items.map((item) => item.serviceDefinition.key))];
    const lastRadius = await this.getLastOfferRadius(orderId);
    // Fresh search → start at the initial ring; decline/expiry escalation → next ring.
    let radius =
      lastRadius > 0
        ? Math.min(config.maxRadiusMeters, lastRadius + config.radiusStepMeters)
        : config.initialRadiusMeters;

    for (let round = 0; round < config.maxRounds; round += 1) {
      const offersCreated = await this.runWave(order, requiredSkills, radius, config);
      if (offersCreated > 0) {
        this.realtimeService.emitToOrder(order.id, RealtimeEvent.ORDER_SEARCHING, {
          orderId: order.id,
          radiusMeters: radius,
          offersCreated,
        });
        return { offersCreated, radiusMeters: radius };
      }
      radius += config.radiusStepMeters;
      if (radius > config.maxRadiusMeters) break;
    }

    await this.queueForBranch(order.id);
    return { queued: true, offersCreated: 0 };
  }

  private async runWave(
    order: {
      id: string;
      orderNumber: string;
      lat: unknown;
      lng: unknown;
      address?: { city?: { slug?: string } } | null;
    },
    requiredSkills: string[],
    radiusMeters: number,
    config: DispatchOfferConfig,
  ): Promise<number> {
    const nearby = await this.redis.findNearbyTechs(
      order.address?.city?.slug ?? 'mashhad',
      Number(order.lat),
      Number(order.lng),
      radiusMeters,
      50,
    );
    if (nearby.length === 0) return 0;

    const profiles = await this.prisma.technicianProfile.findMany({
      where: {
        id: { in: nearby.map((n) => n.techId) },
        status: 'APPROVED',
        isOnline: true,
        isAcceptingOffers: true,
        skills: { hasSome: requiredSkills as ServiceKey[] },
      },
    });
    if (profiles.length === 0) return 0;

    const distanceById = new Map(nearby.map((n) => [n.techId, n.distanceMeters]));
    const alreadyOffered = await this.prisma.dispatchOffer.findMany({
      where: { orderId: order.id, technicianId: { in: profiles.map((p) => p.id) } },
      select: { technicianId: true },
    });
    const offeredIds = new Set(alreadyOffered.map((row) => row.technicianId));
    const candidates = profiles.filter((profile) => !offeredIds.has(profile.id));
    if (candidates.length === 0) return 0;

    const scored = candidates
      .map((profile) => ({
        profile,
        ...scoreCandidate(
          {
            distanceMeters: distanceById.get(profile.id) ?? radiusMeters,
            skills: profile.skills,
            rating: Number(profile.rating),
            ratingCount: profile.ratingCount,
            warrantyClaimRate: Number(profile.warrantyClaimRate),
          },
          requiredSkills,
          config.weights,
          radiusMeters,
        ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, config.maxParallelOffers);

    const now = Date.now();
    for (const candidate of scored) {
      const offer = await this.prisma.dispatchOffer.create({
        data: {
          orderId: order.id,
          technicianId: candidate.profile.id,
          status: 'PENDING',
          radiusMeters,
          distanceMeters: distanceById.get(candidate.profile.id) ?? null,
          score: candidate.score,
          scoreBreakdown: candidate.scoreBreakdown,
          orderLockKey: this.redis.orderLockKey(order.id),
          expiresAt: new Date(now + config.ttlSeconds * 1000),
        },
      });
      this.realtimeService.emitToUser(candidate.profile.userId, RealtimeEvent.DISPATCH_OFFER, {
        offerId: offer.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        score: candidate.score,
        expiresInMs: config.ttlSeconds * 1000,
      });
      await this.notificationsService.send({
        userId: candidate.profile.userId,
        type: 'DISPATCH_OFFER',
        titleFa: 'پیشنهاد سفارش جدید',
        bodyFa: `پیشنهاد اجرای سفارش ${order.orderNumber} برای شما ارسال شد (${config.ttlSeconds} ثانیه).`,
        data: { orderId: order.id, offerId: offer.id, score: candidate.score },
      });
    }
    return scored.length;
  }

  private async getLastOfferRadius(orderId: string): Promise<number> {
    const rows = await this.prisma.dispatchOffer.findMany({
      where: { orderId },
      select: { radiusMeters: true },
    });
    return rows.reduce((max, row) => Math.max(max, row.radiusMeters), 0);
  }

  /** SEARCHING_EXPERT → BRANCH_QUEUE with audit + branch-admin notification. */
  private async queueForBranch(orderId: string): Promise<void> {
    const order = await this.prisma.serviceOrder.findUnique({
      where: { id: orderId },
      include: { branch: { include: { admin: { select: { id: true } } } } },
    });
    if (!order || order.state !== OrderState.SEARCHING_EXPERT) return;

    await this.prisma.$transaction(async (db) => {
      const updated = await db.serviceOrder.updateMany({
        where: { id: orderId, state: OrderState.SEARCHING_EXPERT },
        data: { state: OrderState.BRANCH_QUEUE },
      });
      if (updated.count === 0) return;
      await db.orderStateTransition.create({
        data: {
          orderId,
          fromState: OrderState.SEARCHING_EXPERT,
          toState: OrderState.BRANCH_QUEUE,
          actorUserId: null,
          actorRole: null,
          reason: 'NO_TECHNICIAN_IN_RADIUS',
        },
      });
    });

    if (order.branch?.admin?.id) {
      await this.notificationsService.send({
        userId: order.branch.admin.id,
        type: 'ORDER_STATUS_CHANGED',
        titleFa: 'سفارش در صف شعبه',
        bodyFa: `سفارش ${order.orderNumber} در محدوده جستجو تکنسین نداشت و به صف شعبه ارسال شد.`,
        data: { orderId, state: 'BRANCH_QUEUE' },
      });
    }
  }

  // ── Offer accept / decline ────────────────────────────────────────────────

  async acceptOffer(actor: AuthenticatedUser, offerId: string) {
    const offer = await this.prisma.dispatchOffer.findUnique({
      where: { id: offerId },
      include: { technician: true, order: true },
    });
    if (!offer || offer.technician.userId !== actor.id) {
      throw new NotFoundException({ statusCode: 404, message: 'پیشنهاد یافت نشد.' });
    }
    if (offer.status !== 'PENDING') {
      throw new ConflictException({
        statusCode: 409,
        message: 'این پیشنهاد قبلاً پاسخ داده شده است.',
      });
    }
    if (offer.expiresAt.getTime() <= Date.now()) {
      await this.prisma.dispatchOffer.update({
        where: { id: offer.id },
        data: { status: 'EXPIRED', respondedAt: new Date() },
      });
      throw new BadRequestException({ statusCode: 400, message: 'مهلت این پیشنهاد به پایان رسیده است.' });
    }

    // Invariant 5: ONE atomic per-order lock — parallel accepts can never both win.
    const lock = await this.redis.acquireOrderLock(offer.orderId, OFFER_TTL_MS);
    if (!lock.acquired) {
      throw new ConflictException({
        statusCode: 409,
        message: 'این سفارش لحظاتی پیش توسط کارشناس دیگری پذیرفته شد.',
      });
    }

    const losers = await this.prisma.dispatchOffer.findMany({
      where: { orderId: offer.orderId, status: 'PENDING', technicianId: { not: offer.technicianId } },
      include: { technician: { select: { userId: true } } },
    });

    try {
      await this.prisma.$transaction(async (db) => {
        const updated = await db.serviceOrder.updateMany({
          where: { id: offer.orderId, state: OrderState.SEARCHING_EXPERT },
          data: { state: OrderState.EXPERT_ASSIGNED, technicianId: actor.id },
        });
        if (updated.count === 0) {
          throw new ConflictException({
            statusCode: 409,
            message: 'این سفارش لحظاتی پیش توسط کارشناس دیگری پذیرفته شد.',
          });
        }
        await db.dispatchOffer.update({
          where: { id: offer.id },
          data: { status: 'ACCEPTED', respondedAt: new Date() },
        });
        await db.dispatchOffer.updateMany({
          where: { orderId: offer.orderId, status: 'PENDING', technicianId: { not: offer.technicianId } },
          data: { status: 'CANCELLED' },
        });
        await db.orderStateTransition.create({
          data: {
            orderId: offer.orderId,
            fromState: OrderState.SEARCHING_EXPERT,
            toState: OrderState.EXPERT_ASSIGNED,
            actorUserId: actor.id,
            actorRole: actor.role,
            reason: 'پذیرش پیشنهاد توسط تکنسین',
            metadata: { offerId: offer.id, score: offer.score },
          },
        });
      });
    } finally {
      // The lock is ALWAYS released by its own token (Lua compare-and-delete).
      await this.redis.releaseOrderLock(offer.orderId, lock.token as string);
    }

    for (const loser of losers) {
      this.realtimeService.emitToUser(loser.technician.userId, RealtimeEvent.OFFER_TAKEN, {
        orderId: offer.orderId,
        offerId: loser.id,
        takenByAnotherExpert: true,
      });
    }
    this.realtimeService.emitToOrder(offer.orderId, RealtimeEvent.EXPERT_ASSIGNED, {
      orderId: offer.orderId,
      technicianUserId: actor.id,
    });
    await this.notificationsService.send({
      userId: offer.order.customerId,
      type: 'ORDER_STATUS_CHANGED',
      titleFa: 'تکنسین شما انتخاب شد',
      bodyFa: `برای سفارش ${offer.order.orderNumber} تکنسین اختصاص یافت.`,
      data: { orderId: offer.orderId, state: 'EXPERT_ASSIGNED' },
    });

    return { orderId: offer.orderId, state: 'EXPERT_ASSIGNED', offerId: offer.id };
  }

  async declineOffer(actor: AuthenticatedUser, offerId: string) {
    const offer = await this.prisma.dispatchOffer.findUnique({
      where: { id: offerId },
      include: { technician: true },
    });
    if (!offer || offer.technician.userId !== actor.id) {
      throw new NotFoundException({ statusCode: 404, message: 'پیشنهاد یافت نشد.' });
    }
    if (offer.status !== 'PENDING') {
      throw new ConflictException({ statusCode: 409, message: 'این پیشنهاد قبلاً پاسخ داده شده است.' });
    }
    await this.prisma.dispatchOffer.update({
      where: { id: offer.id },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });

    const pending = await this.prisma.dispatchOffer.count({
      where: { orderId: offer.orderId, status: 'PENDING' },
    });
    if (pending === 0) {
      const order = await this.prisma.serviceOrder.findUnique({ where: { id: offer.orderId } });
      if (order?.state === OrderState.SEARCHING_EXPERT) {
        await this.startSearch(offer.orderId);
      }
    }
    return { offerId: offer.id, status: 'DECLINED' };
  }

  // ── Technician status & location sync ─────────────────────────────────────

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
