import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole, type DispatchOfferStatus, type OrderState } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import type { AppConfigService } from '@config/app-config.service';
import type { PrismaService } from '@infra/prisma/prisma.service';
import type { RedisService } from '@infra/redis/redis.service';
import type { RealtimeService } from '@infra/realtime/realtime.service';
import type { NotificationsService } from '@modules/notifications/notifications.service';
import { DispatchService } from './dispatch.service';
import { DispatchSweeperService } from './dispatch-sweeper.service';

const techA = { id: 'tp-a', userId: 't1', status: 'APPROVED', isOnline: true, isAcceptingOffers: true, skills: ['ALARM', 'CCTV'], rating: 4.9, ratingCount: 210, warrantyClaimRate: 0.01, branchId: 'b1' };
const techB = { id: 'tp-b', userId: 't2', status: 'APPROVED', isOnline: true, isAcceptingOffers: true, skills: ['ALARM', 'CCTV'], rating: 4.8, ratingCount: 5, warrantyClaimRate: 0.3, branchId: 'b1' };

const actorT1 = { id: 't1', phone: '+989120000010', role: UserRole.TECHNICIAN, branchId: 'b1' } as AuthenticatedUser;
const actorT2 = { id: 't2', phone: '+989120000011', role: UserRole.TECHNICIAN, branchId: 'b1' } as AuthenticatedUser;

interface OfferRow {
  id: string;
  orderId: string;
  technicianId: string;
  radiusMeters: number;
  score: number;
  wave: number;
  audience: 'TOP' | 'ALL';
  attempt: number;
  status: DispatchOfferStatus;
  respondedAt: Date | null;
  expiresAt: Date;
  isBranchInvite: boolean;
}

interface OfferFilter {
  id?: string;
  orderId?: string;
  status?: DispatchOfferStatus;
  attempt?: number;
  isBranchInvite?: boolean;
  expiresAt?: { gt: Date } | { lte: Date };
}

function buildDispatch(options?: { lockAcquired?: boolean; sliderBps?: number; revisionStatus?: 'DRAFT' | 'FUNDED' }) {
  let offerSeq = 0;
  let orderState: OrderState = 'SEARCHING_EXPERT';
  const offers: OfferRow[] = [];
  const technicians = [techA, techB];
  let locked = false;

  const order = {
    id: 'o1',
    orderNumber: 'HM-2026-000001',
    customerId: 'c1',
    technicianId: null,
    pricingVersion: options?.sliderBps === undefined ? 1 : 2,
    activeRevision: 1,
    branchId: 'b1',
    lat: 36.3,
    lng: 59.6,
    address: { city: { slug: 'mashhad' } },
    items: [
      { serviceDefinition: { key: 'ALARM' } },
      { serviceDefinition: { key: 'CCTV' } },
    ],
  };

  function findOffers(where: OfferFilter = {}) {
    const { id, orderId, status, attempt, isBranchInvite, expiresAt } = where;
    return offers.filter((offer) =>
      (id === undefined || offer.id === id) &&
      (orderId === undefined || offer.orderId === orderId) &&
      (status === undefined || offer.status === status) &&
      (attempt === undefined || offer.attempt === attempt) &&
      (isBranchInvite === undefined || offer.isBranchInvite === isBranchInvite) &&
      (!expiresAt || ('gt' in expiresAt ? offer.expiresAt > expiresAt.gt : offer.expiresAt <= expiresAt.lte)),
    );
  }

  const redis = {
    orderLockKey: (orderId: string) => `dispatch:order:lock:${orderId}`,
    acquireOrderLock: jest.fn(async () => {
      const acquired = !locked && options?.lockAcquired !== false;
      if (acquired) locked = true;
      return { acquired, token: acquired ? 'tok-1' : null, key: 'lock' };
    }),
    releaseOrderLock: jest.fn(async () => {
      locked = false;
      return true;
    }),
    findNearbyTechs: jest.fn().mockResolvedValue([
      { techId: 'tp-a', distanceMeters: 4000, longitude: 59.6, latitude: 36.3 },
      { techId: 'tp-b', distanceMeters: 1000, longitude: 59.6, latitude: 36.3 },
    ]),
  };

  const prisma = {
    platformConfig: { findUnique: jest.fn().mockResolvedValue(null) }, // defaults
    orderPriceRevision: { findUnique: jest.fn().mockResolvedValue({
      status: options?.revisionStatus ?? 'FUNDED', sliderBps: options?.sliderBps ?? 0, technicianTermsJson: { agreedPackageNet: '4500000' },
    }) },
    serviceOrder: {
      findUnique: jest.fn(async () => ({ ...order, state: orderState })),
      findMany: jest.fn(async () =>
        orderState === 'SEARCHING_EXPERT' && !findOffers({ status: 'PENDING' }).length ? [{ id: order.id }] : [],
      ),
      update: jest.fn(async ({ data }: { data: { state: OrderState } }) => {
        orderState = data.state;
        return { ...order, state: orderState, branch: { adminId: 'a1' } };
      }),
      updateMany: jest.fn(async ({ where, data }: {
        where: { id: string; state: OrderState };
        data: { state: OrderState };
      }) => {
        if (where.id !== order.id || where.state !== orderState) return { count: 0 };
        orderState = data.state;
        return { count: 1 };
      }),
    },
    technicianProfile: {
      findMany: jest.fn(async ({ where }: { where: {
        id: { in: string[] }; skills: { hasEvery: string[] }; rating?: { gte: number }; ratingCount?: { gte: number };
      } }) =>
        technicians.filter((tech) =>
          where.id.in.includes(tech.id) && where.skills.hasEvery.every((skill) => tech.skills.includes(skill)) &&
          tech.rating >= (where.rating?.gte ?? 0) && tech.ratingCount >= (where.ratingCount?.gte ?? 0),
        ),
      ),
      findFirst: jest.fn(async ({ where }: { where: { id: string; userId: string; skills: { hasEvery: string[] } } }) =>
        technicians.find((tech) =>
          tech.id === where.id && tech.userId === where.userId && where.skills.hasEvery.every((skill) => tech.skills.includes(skill)),
        ) ?? null,
      ),
      findUnique: jest.fn(async ({ where }: { where: { userId: string } }) =>
        technicians.find((tech) => tech.userId === where.userId) ?? null,
      ),
    },
    dispatchOffer: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const offer = offers.find((candidate) => candidate.id === where.id);
        if (!offer) return null;
        return {
          ...offer,
          technician: technicians.find((tech) => tech.id === offer.technicianId),
          order: { ...order, state: orderState },
        };
      }),
      findFirst: jest.fn(async ({ where }: { where: OfferFilter }) =>
        findOffers(where).sort((a, b) => b.wave - a.wave)[0] ?? null,
      ),
      findMany: jest.fn(async ({ where }: { where: OfferFilter }) => findOffers(where).map((offer) => ({
        ...offer,
        technician: technicians.find((tech) => tech.id === offer.technicianId),
      }))),
      create: jest.fn(async ({ data }: { data: Omit<OfferRow, 'id' | 'status' | 'respondedAt' | 'attempt' | 'isBranchInvite'> }) => {
        const row: OfferRow = {
          ...data, id: `offer-${++offerSeq}`, attempt: 1, status: 'PENDING', respondedAt: null, isBranchInvite: false,
        };
        offers.push(row);
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: OfferFilter; data: Partial<OfferRow> }) => {
        const matches = findOffers(where);
        for (const offer of matches) Object.assign(offer, data);
        return { count: matches.length };
      }),
      count: jest.fn(async ({ where }: { where: OfferFilter }) => findOffers(where).length),
    },
    orderStateTransition: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn(async () => [{ state: orderState }]),
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  } as unknown as PrismaService;

  const realtimeService = { emitToUser: jest.fn(), emitToOrder: jest.fn() } as unknown as RealtimeService;
  const notificationsService = { send: jest.fn().mockResolvedValue({}) } as unknown as NotificationsService;

  const service = new DispatchService(prisma, redis as unknown as RedisService, realtimeService, notificationsService);
  const sweeper = new DispatchSweeperService(prisma, service, { nodeEnv: 'test' } as AppConfigService);
  return {
    service,
    sweeper,
    prisma,
    redis,
    realtimeService,
    notificationsService,
    offers,
    getOrderState: () => orderState,
    seedOffer: (technicianId: string, expiresAt = new Date(Date.now() + 30_000)) => {
      const offer: OfferRow = {
        id: `offer-${technicianId}`,
        orderId: 'o1',
        technicianId,
        status: 'PENDING',
        radiusMeters: 5000,
        expiresAt,
        respondedAt: null,
        score: 90,
        wave: 1,
        audience: 'ALL',
        attempt: 1,
        isBranchInvite: false,
      };
      offers.push(offer);
      return offer;
    },
  };
}

describe('DispatchService — atomic single-winner accept (Invariant 5)', () => {
  it('two technicians accepting the same order → exactly ONE wins; loser offer CANCELLED + OFFER_TAKEN emitted', async () => {
    const { service, prisma, realtimeService, seedOffer } = buildDispatch();
    const firstOffer = seedOffer('tp-a');
    const secondOffer = seedOffer('tp-b');

    const winner = await service.acceptOffer(actorT1, 'offer-tp-a');
    expect(winner.state).toBe('EXPERT_ASSIGNED');

    // Winner offer accepted, loser cancelled via updateMany.
    expect(firstOffer.status).toBe('ACCEPTED');
    expect(secondOffer.status).toBe('CANCELLED');
    expect(realtimeService.emitToUser).toHaveBeenCalledWith(
      't2',
      'OFFER_TAKEN',
      expect.objectContaining({ orderId: 'o1', offerId: 'offer-tp-b', takenByAnotherExpert: true }),
    );
    expect(prisma.orderStateTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromState: 'SEARCHING_EXPERT',
        toState: 'EXPERT_ASSIGNED',
        actorUserId: 't1',
      }),
    });

    // Second (now-cancelled) offer → 409, never a double win.
    await expect(service.acceptOffer(actorT2, 'offer-tp-b')).rejects.toThrow(ConflictException);
    expect(secondOffer.status).toBe('CANCELLED');
  });

  it('rejects a lost lock race without changing the order state', async () => {
    const { service, redis, seedOffer, getOrderState } = buildDispatch({ lockAcquired: false });
    seedOffer('tp-a');
    await expect(service.acceptOffer(actorT1, 'offer-tp-a')).rejects.toThrow(ConflictException);
    expect(getOrderState()).toBe('SEARCHING_EXPERT');
    // Lock release is NOT called when acquisition failed (nothing to release).
    expect(redis.releaseOrderLock).not.toHaveBeenCalled();
  });

  it('lock is ALWAYS released after a successful accept (finally)', async () => {
    const { service, redis, seedOffer } = buildDispatch();
    seedOffer('tp-a');
    await service.acceptOffer(actorT1, 'offer-tp-a');
    expect(redis.releaseOrderLock).toHaveBeenCalledWith('o1', 'tok-1');
  });

  it('rejects acceptance of an expired offer before acquiring a lock', async () => {
    const { service, redis, seedOffer } = buildDispatch();
    const offer = seedOffer('tp-a', new Date(Date.now() - 1000));
    await expect(service.acceptOffer(actorT1, offer.id)).rejects.toThrow(BadRequestException);
    expect(redis.acquireOrderLock).not.toHaveBeenCalled();
  });
});

describe('Phase 11B funded offer priority', () => {
  it('opens only TOP at +5%, then reopens the same ring after expiry', async () => {
    const { service, sweeper, offers } = buildDispatch({ sliderBps: 500 });
    const startedAt = Date.now();
    await expect(service.startSearch('o1')).resolves.toEqual({ offersCreated: 1, radiusMeters: 5000 });
    expect(offers).toEqual([expect.objectContaining({ wave: 1, audience: 'TOP', technicianId: techA.id })]);
    const [first] = offers;
    if (!first) throw new Error('TOP offer missing');
    expect(first.expiresAt.getTime()).toBeGreaterThanOrEqual(startedAt + 30_000);
    first.expiresAt = new Date(startedAt - 1);
    await expect(sweeper.expireStaleOffers()).resolves.toMatchObject({ expired: 1, reWavedOrders: 1 });
    expect(offers).toEqual([
      expect.objectContaining({ wave: 1, audience: 'TOP', status: 'EXPIRED', technicianId: techA.id, radiusMeters: 5000 }),
      expect.objectContaining({ wave: 2, audience: 'ALL', status: 'PENDING', technicianId: techB.id, radiusMeters: 5000 }),
    ]);
  });

  it('reopens after the last TOP decline', async () => {
    const { service, offers, redis, getOrderState } = buildDispatch({ sliderBps: 2500 });
    await service.startSearch('o1');
    const [first] = offers;
    if (!first) throw new Error('TOP offer missing');
    await expect(service.declineOffer(actorT1, first.id)).resolves.toMatchObject({ status: 'DECLINED' });
    const rookie = offers[1];
    expect(rookie).toMatchObject({ wave: 2, audience: 'ALL', technicianId: techB.id, radiusMeters: 5000 });
    if (!rookie) throw new Error('ALL offer missing');
    await expect(service.declineOffer(actorT2, rookie.id)).resolves.toMatchObject({ status: 'DECLINED' });
    expect(redis.findNearbyTechs.mock.calls.map((call) => call[3])).toEqual([5000, 5000, 12000, 19000]);
    expect(getOrderState()).toBe('BRANCH_QUEUE');
  });

  it('skips straight to ALL in the initial ring when the configured top ratings exclude everyone', async () => {
    const { service, prisma, offers } = buildDispatch({ sliderBps: 500 });
    (prisma.platformConfig.findUnique as jest.Mock).mockResolvedValue({ value: { topMinRating: 5 } });
    await expect(service.startSearch('o1')).resolves.toEqual({ offersCreated: 2, radiusMeters: 5000 });
    expect(offers.every((offer) => offer.wave === 2 && offer.audience === 'ALL')).toBe(true);
    expect(offers.map((offer) => offer.technicianId)).toContain(techB.id);
  });

  it.each([-1500, 0, 400])('opens ALL at %d bps and lets the rookie win the atomic acceptance race', async (sliderBps) => {
    const { service, redis, offers, getOrderState } = buildDispatch({ sliderBps });
    await expect(service.startSearch('o1')).resolves.toEqual({ offersCreated: 2, radiusMeters: 5000 });
    expect(offers.every((offer) => offer.wave === 1 && offer.audience === 'ALL')).toBe(true);
    const rookie = offers.find((offer) => offer.technicianId === techB.id);
    const veteran = offers.find((offer) => offer.technicianId === techA.id);
    if (!rookie || !veteran) throw new Error('Expected one offer per technician');
    const [first, second] = await Promise.allSettled([
      service.acceptOffer(actorT2, rookie.id), service.acceptOffer(actorT1, veteran.id),
    ]);
    expect(first).toMatchObject({ status: 'fulfilled', value: { offerId: rookie.id } });
    expect(second).toMatchObject({ status: 'rejected', reason: expect.any(ConflictException) });
    expect(rookie.status).toBe('ACCEPTED');
    expect(veteran.status).toBe('CANCELLED');
    expect(redis.acquireOrderLock).toHaveBeenCalledTimes(2);
    expect(redis.releaseOrderLock).toHaveBeenCalledTimes(1);
    expect(getOrderState()).toBe('EXPERT_ASSIGNED');
  });

  it('requires an active FUNDED revision for priority', async () => {
    const { service, offers } = buildDispatch({ sliderBps: 2500, revisionStatus: 'DRAFT' });
    await expect(service.startSearch('o1')).resolves.toMatchObject({ offersCreated: 2 });
    expect(offers.every((offer) => offer.audience === 'ALL')).toBe(true);
  });
});

describe('DispatchService — expanding radius & BRANCH_QUEUE fallback', () => {
  it('escalates radius rings 5000 → 12000 → 19000 until candidates are found', async () => {
    const { service, redis, offers } = buildDispatch();
    let call = 0;
    (redis.findNearbyTechs as jest.Mock).mockImplementation(async () => {
      call += 1;
      return call < 3 ? [] : [{ techId: 'tp-a', distanceMeters: 9000, longitude: 59.6, latitude: 36.3 }];
    });

    const result = await service.startSearch('o1');
    expect(result).toMatchObject({ offersCreated: 1, radiusMeters: 19000 });
    expect(offers).toHaveLength(1);
    expect(redis.findNearbyTechs).toHaveBeenNthCalledWith(1, 'mashhad', 36.3, 59.6, 5000, 50);
    expect(redis.findNearbyTechs).toHaveBeenNthCalledWith(2, 'mashhad', 36.3, 59.6, 12000, 50);
    expect(redis.findNearbyTechs).toHaveBeenNthCalledWith(3, 'mashhad', 36.3, 59.6, 19000, 50);
  });

  it('falls back to BRANCH_QUEUE with NO_TECHNICIAN_IN_RADIUS audit + branch-admin notification', async () => {
    const { service, prisma, notificationsService, getOrderState } = buildDispatch();
    (prisma.technicianProfile.findMany as jest.Mock).mockResolvedValue([]);

    const result = await service.startSearch('o1');

    expect(result.queued).toBe(true);
    expect(getOrderState()).toBe('BRANCH_QUEUE');
    expect(prisma.orderStateTransition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromState: 'SEARCHING_EXPERT',
        toState: 'BRANCH_QUEUE',
        reason: 'NO_TECHNICIAN_IN_RADIUS',
      }),
    });
    expect(notificationsService.send).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'a1', titleFa: 'سفارش در صف شعبه' }),
    );
  });
});

describe('DispatchSweeperService — expiry sweeper', () => {
  it('expires stale PENDING offers and re-waves affected SEARCHING_EXPERT orders', async () => {
    const { sweeper, prisma, seedOffer } = buildDispatch();
    const staleOffer = seedOffer('tp-a', new Date(Date.now() - 1000));

    const result = await sweeper.expireStaleOffers();
    expect(result).toEqual({ expired: 1, reWavedOrders: 1 });
    expect(staleOffer.status).toBe('EXPIRED');
    expect(prisma.dispatchOffer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ technicianId: techB.id, wave: 2, radiusMeters: 12000 }),
    });
  });
});

describe('DispatchService — getTechnicianMe', () => {
  it('returns persisted online status, location and rating metrics', async () => {
    const { service, prisma } = buildDispatch();
    (prisma.technicianProfile.findUnique as jest.Mock).mockResolvedValue({
      id: 'tp-a',
      userId: 't1',
      status: 'APPROVED',
      isOnline: true,
      isAcceptingOffers: true,
      lastKnownLat: 36.3105,
      lastKnownLng: 59.5663,
      rating: 4.85,
      ratingCount: 120,
      completedJobs: 140,
      warrantyClaimRate: 0.02,
    });

    const me = await service.getTechnicianMe(actorT1);
    expect(me).toEqual({
      technicianId: 'tp-a',
      status: 'APPROVED',
      isOnline: true,
      isAcceptingOffers: true,
      lastKnownLat: 36.3105,
      lastKnownLng: 59.5663,
      rating: 4.85,
      ratingCount: 120,
      completedJobs: 140,
      warrantyClaimRate: 0.02,
    });
  });

  it('throws 404 when technician profile is missing', async () => {
    const { service, prisma } = buildDispatch();
    (prisma.technicianProfile.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.getTechnicianMe(actorT1)).rejects.toThrow(NotFoundException);
  });
});
