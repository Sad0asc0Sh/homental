import { ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import type { PrismaService } from '@infra/prisma/prisma.service';
import type { RedisService } from '@infra/redis/redis.service';
import type { RealtimeService } from '@infra/realtime/realtime.service';
import type { NotificationsService } from '@modules/notifications/notifications.service';
import { DispatchService } from './dispatch.service';
import { DispatchSweeperService } from './dispatch-sweeper.service';

const techA = { id: 'tp-a', userId: 't1', status: 'APPROVED', isOnline: true, isAcceptingOffers: true, skills: ['ALARM', 'CCTV'], rating: 4.9, ratingCount: 210, warrantyClaimRate: 0.01, branchId: 'b1' };
const techB = { id: 'tp-b', userId: 't2', status: 'APPROVED', isOnline: true, isAcceptingOffers: true, skills: ['ALARM'], rating: 3.0, ratingCount: 50, warrantyClaimRate: 0.3, branchId: 'b1' };

const actorT1 = { id: 't1', phone: '+989120000010', role: UserRole.TECHNICIAN, branchId: 'b1' } as AuthenticatedUser;
const actorT2 = { id: 't2', phone: '+989120000011', role: UserRole.TECHNICIAN, branchId: 'b1' } as AuthenticatedUser;

function buildDispatch(options?: { lockAcquired?: boolean }) {
  let offerSeq = 0;
  const offers: Array<Record<string, unknown>> = [];
  const orderState = { state: 'SEARCHING_EXPERT' };

  const order = {
    id: 'o1',
    orderNumber: 'HM-2026-000001',
    customerId: 'c1',
    technicianId: null,
    branchId: 'b1',
    state: orderState.state,
    lat: 36.3,
    lng: 59.6,
    address: { city: { slug: 'mashhad' } },
    items: [
      { serviceDefinition: { key: 'ALARM' } },
      { serviceDefinition: { key: 'CCTV' } },
    ],
  };

  const redis = {
    orderLockKey: (orderId: string) => `dispatch:order:lock:${orderId}`,
    acquireOrderLock: jest
      .fn()
      .mockResolvedValue({ acquired: options?.lockAcquired ?? true, token: 'tok-1', key: 'lock' }),
    releaseOrderLock: jest.fn().mockResolvedValue(true),
    findNearbyTechs: jest.fn().mockResolvedValue([
      { techId: 'tp-a', distanceMeters: 4000, longitude: 59.6, latitude: 36.3 },
      { techId: 'tp-b', distanceMeters: 1000, longitude: 59.6, latitude: 36.3 },
    ]),
  };

  const prisma = {
    platformConfig: { findUnique: jest.fn().mockResolvedValue(null) }, // defaults
    serviceOrder: {
      findUnique: jest.fn().mockImplementation(({ include }: { include?: Record<string, unknown> } = {}) => {
        const row: Record<string, unknown> = { ...order, state: orderState.state };
        if (include?.['items']) {
          row['items'] = [
            { serviceDefinition: { key: 'ALARM' } },
            { serviceDefinition: { key: 'CCTV' } },
          ];
        }
        if (include?.['branch']) {
          row['branch'] = { id: 'b1', admin: { id: 'a1' } };
        }
        return row;
      }),
      updateMany: jest.fn(async ({ data }: { data: { state?: string; technicianId?: string } }) => {
        if (data.state) orderState.state = data.state;
        return { count: 1 };
      }),
    },
    technicianProfile: {
      findMany: jest.fn(async ({ where }: { where?: { id?: { in?: string[] } } } = {}) => {
        let rows = [techA, techB];
        if (where?.id?.in) rows = rows.filter((tech) => (where.id!.in as string[]).includes(tech.id));
        return rows;
      }),
      findUnique: jest.fn(async ({ where }: { where: { userId: string } }) =>
        [techA, techB].find((t) => t.userId === where.userId) ?? null,
      ),
    },
    dispatchOffer: {
      findUnique: jest.fn(async ({ where, include }: { where?: { id: string }; include?: Record<string, boolean> } = {}) => {
        const offer = offers.find((o) => o['id'] === where?.id);
        if (!offer) return null;
        const result: Record<string, unknown> = { ...offer };
        if (include?.['technician']) {
          result['technician'] = [techA, techB].find((t) => t.id === offer['technicianId']);
        }
        if (include?.['order']) {
          result['order'] = { id: 'o1', orderNumber: 'HM-2026-000001', customerId: 'c1', state: orderState.state };
        }
        return result;
      }),
      findMany: jest.fn(async ({ where }: { where?: { status?: string; technicianId?: { not?: string } } } = {}) =>
        offers.filter((offer) => {
          if (where?.status && offer['status'] !== where.status) return false;
          if (where?.technicianId?.not && offer['technicianId'] === where.technicianId.not) return false;
          return true;
        }) as Array<Record<string, unknown>> & { length: number },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `offer-${++offerSeq}`, respondedAt: null, ...data };
        offers.push(row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const offer = offers.find((o) => o['id'] === where.id);
        if (offer) Object.assign(offer, data);
        return { ...offer };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { orderId?: string; status?: string; technicianId?: { not?: string } }; data: Record<string, unknown> }) => {
        let count = 0;
        for (const offer of offers) {
          if (where.orderId && offer['orderId'] !== where.orderId) continue;
          if (where.status && offer['status'] !== where.status) continue;
          if (where.technicianId?.not && offer['technicianId'] === where.technicianId.not) continue;
          Object.assign(offer, data);
          count += 1;
        }
        return { count };
      }),
      count: jest.fn(async ({ where }: { where?: { status?: string; orderId?: string } } = {}) =>
        offers.filter((offer) => {
          if (where?.status && offer['status'] !== where.status) return false;
          if (where?.orderId && offer['orderId'] !== where.orderId) return false;
          return true;
        }).length,
      ),
    },
    orderStateTransition: { create: jest.fn().mockResolvedValue({}) },
    branch: { findUnique: jest.fn().mockResolvedValue({ id: 'b1', admin: { id: 'a1' } }) },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  } as unknown as PrismaService;

  const realtimeService = { emitToUser: jest.fn(), emitToOrder: jest.fn() } as unknown as RealtimeService;
  const notificationsService = { send: jest.fn().mockResolvedValue({}) } as unknown as NotificationsService;

  const service = new DispatchService(prisma, redis as unknown as RedisService, realtimeService, notificationsService);
  const sweeper = new DispatchSweeperService(prisma, service);
  return {
    service,
    sweeper,
    prisma,
    redis,
    realtimeService,
    notificationsService,
    offers,
    getOrderState: () => orderState.state,
    seedOffer: (technicianId: string, userId: string) => {
      offers.push({
        id: `offer-${technicianId}`,
        orderId: 'o1',
        technicianId,
        status: 'PENDING',
        radiusMeters: 5000,
        expiresAt: new Date(Date.now() + 30_000),
        respondedAt: null,
        technician: { userId },
        score: 90,
      });
    },
  };
}

describe('DispatchService — atomic single-winner accept (Invariant 5)', () => {
  it('two technicians accepting the same order → exactly ONE wins; loser offer CANCELLED + OFFER_TAKEN emitted', async () => {
    const { service, prisma, realtimeService, offers, seedOffer } = buildDispatch();
    seedOffer('tp-a', 't1');
    seedOffer('tp-b', 't2');

    const winner = await service.acceptOffer(actorT1, 'offer-tp-a');
    expect(winner.state).toBe('EXPERT_ASSIGNED');

    // Winner offer accepted, loser cancelled via updateMany.
    expect(offers.find((o) => o['id'] === 'offer-tp-a')?.['status']).toBe('ACCEPTED');
    expect(offers.find((o) => o['id'] === 'offer-tp-b')?.['status']).toBe('CANCELLED');
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
    expect(offers.find((o) => o['id'] === 'offer-tp-b')?.['status']).toBe('CANCELLED');
  });

  it('a lost lock race → 409 Persian conflict, state untouched, lock released in finally', async () => {
    const { service, redis, seedOffer, getOrderState } = buildDispatch({ lockAcquired: false });
    seedOffer('tp-a', 't1');
    await expect(service.acceptOffer(actorT1, 'offer-tp-a')).rejects.toThrow(/لحظاتی پیش/);
    expect(getOrderState()).toBe('SEARCHING_EXPERT');
    // Lock release is NOT called when acquisition failed (nothing to release).
    expect(redis.releaseOrderLock).not.toHaveBeenCalled();
  });

  it('lock is ALWAYS released after a successful accept (finally)', async () => {
    const { service, redis, seedOffer } = buildDispatch();
    seedOffer('tp-a', 't1');
    await service.acceptOffer(actorT1, 'offer-tp-a');
    expect(redis.releaseOrderLock).toHaveBeenCalledWith('o1', 'tok-1');
  });

  it('an expired offer is marked EXPIRED and rejected', async () => {
    const { service, offers, seedOffer } = buildDispatch();
    seedOffer('tp-a', 't1');
    const offer = offers.find((o) => o['id'] === 'offer-tp-a') as Record<string, unknown>;
    offer['expiresAt'] = new Date(Date.now() - 1000);

    await expect(service.acceptOffer(actorT1, 'offer-tp-a')).rejects.toThrow(/مهلت/);
    expect(offer['status']).toBe('EXPIRED');
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
    const { service, sweeper, prisma, offers, seedOffer } = buildDispatch();
    seedOffer('tp-a', 't1');
    const staleOffer = offers[0] as Record<string, unknown>;
    staleOffer['expiresAt'] = new Date(Date.now() - 1000);
    void service;

    const result = await sweeper.expireStaleOffers();
    expect(result.expired).toBe(1);
    expect(staleOffer['status']).toBe('EXPIRED');
    expect(prisma.serviceOrder.findUnique).toHaveBeenCalled();
    // startSearch is invoked through the sweeper for the affected order.
    expect(prisma.dispatchOffer.create).toHaveBeenCalled();
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
