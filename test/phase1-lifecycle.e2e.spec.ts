/**
 * Covers catalog and advisory, then resumes a saved Phase 1 dispatch order
 * through quote approval, handover, review and warranty claims. New managed
 * order creation and funding run against PostgreSQL in the Phase 11A suite.
 */
import { ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma, ServiceKey } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { AppConfigService } from '@config/app-config.service';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RealtimeService } from '@infra/realtime/realtime.service';
import { RedisService } from '@infra/redis/redis.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { CatalogService } from '@modules/security-services/catalog/catalog.service';
import { AdvisoryService } from '@modules/security-services/advisory/advisory.service';
import { JsonLogicEvaluator } from '@modules/security-services/shared/json-logic.evaluator';
import { PricingSchemaInterpreter } from '@modules/security-services/pricing/pricing-schema.interpreter';
import { DynamicFactorsService } from '@modules/security-services/pricing/dynamic-factors.service';
import { PricingService } from '@modules/security-services/pricing/pricing.service';
import { OrdersService } from '@modules/security-services/orders/orders.service';
import { DispatchService } from '@modules/security-services/dispatch/dispatch.service';
import { WarrantyService } from '@modules/security-services/warranty/warranty.service';
import { ReviewsService } from '@modules/security-services/reviews/reviews.service';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';
import { PLATFORM_WALLET_OWNER_ID } from '@modules/wallet-escrow/wallet-escrow.constants';
import {
  advisoryRules as advisoryRulesSeed,
  platformConfigs as platformConfigSeed,
  serviceDefinitions as serviceDefinitionsSeed,
} from '../prisma/seed';

const customer = { id: 'c1', phone: '+989120000020', role: UserRole.CUSTOMER, branchId: null } as AuthenticatedUser;
const techA = { id: 't1', phone: '+989120000010', role: UserRole.TECHNICIAN, branchId: 'b1' } as AuthenticatedUser;
const techB = { id: 't2', phone: '+989120000011', role: UserRole.TECHNICIAN, branchId: 'b1' } as AuthenticatedUser;
const branchAdmin = { id: 'a1', phone: '+989120000002', role: UserRole.BRANCH_ADMIN, branchId: 'b1' } as AuthenticatedUser;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function createInMemoryRedis() {
  const geoByCity = new Map<string, Map<string, { lat: number; lng: number }>>();
  const locks = new Map<string, string>();
  return {
    async geoadd(key: string, lng: number, lat: number, member: string): Promise<number> {
      const members = geoByCity.get(key) ?? new Map();
      geoByCity.set(key, members);
      members.set(member, { lat, lng });
      return 1;
    },
    async zrem(key: string, member: string): Promise<number> {
      return geoByCity.get(key)?.delete(member) ? 1 : 0;
    },
    async zcard(key: string): Promise<number> {
      return geoByCity.get(key)?.size ?? 0;
    },
    // RedisService API wrappers (used directly by DispatchService):
    async addTechLocation(citySlug: string, techId: string, lat: number, lng: number): Promise<void> {
      await this.geoadd(`homental:geo:technicians:${citySlug}`, lng, lat, techId);
    },
    async removeTechLocation(citySlug: string, techId: string): Promise<void> {
      await this.zrem(`homental:geo:technicians:${citySlug}`, techId);
    },
    async countOnlineTechs(citySlug: string): Promise<number> {
      return this.zcard(`homental:geo:technicians:${citySlug}`);
    },
    async findNearbyTechs(
      citySlug: string,
      lat: number,
      lng: number,
      radiusMeters: number,
      limit: number,
    ) {
      const members = [...(geoByCity.get(`homental:geo:technicians:${citySlug}`) ?? new Map()).entries()];
      return members
        .map(([techId, coords]) => ({
          techId,
          distanceMeters: haversineMeters(lat, lng, coords.lat, coords.lng),
          longitude: coords.lng,
          latitude: coords.lat,
        }))
        .filter((entry) => entry.distanceMeters <= radiusMeters)
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, limit);
    },
    async acquireOrderLock(orderId: string, _ttlMs: number) {
      const key = `dispatch:order:lock:${orderId}`;
      if (locks.has(key)) return { acquired: false, token: null, key };
      const token = `tok-${locks.size + 1}`;
      locks.set(key, token);
      return { acquired: true, token, key };
    },
    async releaseOrderLock(orderId: string, token: string): Promise<boolean> {
      const key = `dispatch:order:lock:${orderId}`;
      if (locks.get(key) === token) {
        locks.delete(key);
        return true;
      }
      return false;
    },
    orderLockKey: (orderId: string) => `dispatch:order:lock:${orderId}`,
    async subscribePattern(): Promise<void> {},
    async unsubscribePattern(): Promise<void> {},
    async publish(): Promise<void> {},
    async subscribe(): Promise<void> {},
    async unsubscribe(): Promise<void> {},
    async ping(): Promise<{ latencyMs: number }> {
      return { latencyMs: 1 };
    },
    async rateLimit() {
      return { allowed: true, remaining: 0, retryAfterMs: 0 };
    },
    async onModuleDestroy(): Promise<void> {},
  };
}

type Row = Record<string, unknown> & { id: string };

function createInMemoryPrisma() {
  const serviceDefinitions = serviceDefinitionsSeed.map((definition) => ({
    ...definition,
    id: `def-${definition.key}`,
    version: 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const defById = new Map(serviceDefinitions.map((d) => [d.id as string, d]));
  const advisoryRulesRows: Array<Record<string, unknown>> = advisoryRulesSeed.map((rule) => ({
    ...(rule as unknown as Record<string, unknown>),
    id: `rule-${rule.code}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const platformConfigRows = platformConfigSeed.map((config) => ({ ...config }));

  const cities = [
    { id: 'city-mashhad', slug: 'mashhad', nameFa: 'مشهد', isActive: true, centerLat: 36.2972, centerLng: 59.6067 },
  ];
  const branches = [
    {
      id: 'b1',
      code: 'MSHD-C1',
      cityId: 'city-mashhad',
      isActive: true,
      commissionRateOverride: 0.1, // showroom partner (dual-commission)
      warrantyReserveOverride: null,
      adminId: 'a1',
    },
  ];
  const customerProfiles = [{ id: 'cp1', userId: 'c1' }];
  const technicianProfiles: Row[] = [
    {
      id: 'tp-a', userId: 't1', status: 'APPROVED', isOnline: false, isAcceptingOffers: true,
      skills: ['ALARM', 'CCTV'], rating: 4.9, ratingCount: 210, warrantyClaimRate: 0.01,
      completedJobs: 233, branchId: 'b1', lastKnownLat: null, lastKnownLng: null,
    },
    {
      id: 'tp-b', userId: 't2', status: 'APPROVED', isOnline: false, isAcceptingOffers: true,
      skills: ['ALARM', 'CCTV'], rating: 3.0, ratingCount: 50, warrantyClaimRate: 0.3,
      completedJobs: 97, branchId: 'b1', lastKnownLat: null, lastKnownLng: null,
    },
  ];
  const addresses: Row[] = [];
  const serviceOrders: Row[] = [];
  const orderItems: Row[] = [];
  const hardwareUnits: Row[] = [];
  const transitions: Row[] = [];
  const dispatchOffers: Row[] = [];
  const wallets = new Map<string, Row>([
    ['CUSTOMER:c1', { id: 'w-c1', ownerType: 'CUSTOMER', ownerId: 'c1', balance: 50_000_000n, heldInEscrow: 0n }],
    ['TECHNICIAN:t1', { id: 'w-t1', ownerType: 'TECHNICIAN', ownerId: 't1', balance: 0n, heldInEscrow: 0n }],
    ['TECHNICIAN:t2', { id: 'w-t2', ownerType: 'TECHNICIAN', ownerId: 't2', balance: 0n, heldInEscrow: 0n }],
    [`PLATFORM:${PLATFORM_WALLET_OWNER_ID}`, { id: 'w-platform', ownerType: 'PLATFORM', ownerId: PLATFORM_WALLET_OWNER_ID, balance: 0n, heldInEscrow: 0n, restrictedReserve: 0n }],
  ]);
  const walletTransactions: Row[] = [];
  const warranties: Row[] = [];
  const claims: Row[] = [];
  const reviews: Row[] = [];
  let idSeq = 0;
  const nextId = (prefix: string) => `${prefix}-${++idSeq}`;

  const orderWithIncludes = (row: Row): Row => {
    const items = orderItems
      .filter((item) => item['orderId'] === row.id)
      .map((item) => ({
        ...item,
        serviceDefinition: defById.get(item['serviceDefinitionId'] as string),
        hardwareUnits: hardwareUnits.filter((unit) => unit['orderItemId'] === item.id),
      }));
    const address = addresses.find((a) => a.id === row['addressId']);
    return {
      ...row,
      items,
      ...(address ? { address: { ...address, city: cities.find((c) => c.id === address['cityId']) } } : {}),
    };
  };

  const eligibleTechnicians = (where: Prisma.TechnicianProfileWhereInput = {}) => {
    const ids = typeof where.id === 'object' && Array.isArray(where.id.in) ? where.id.in : undefined;
    const skills = Array.isArray(where.skills?.hasEvery) ? where.skills.hasEvery : [];
    return technicianProfiles.filter((row) =>
      (typeof where.id !== 'string' || row.id === where.id) &&
      (!ids || ids.includes(row.id)) &&
      (!where.userId || row['userId'] === where.userId) &&
      (!where.status || row['status'] === where.status) &&
      (!where.isOnline || row['isOnline'] === where.isOnline) &&
      (!where.isAcceptingOffers || row['isAcceptingOffers'] === where.isAcceptingOffers) &&
      skills.every((skill) => (row['skills'] as ServiceKey[]).includes(skill)),
    );
  };

  type BalanceChange = { increment?: bigint; decrement?: bigint };
  type WalletMutation = {
    where: { id: string; balance?: { gte?: bigint }; heldInEscrow?: { gte?: bigint } };
    data: { balance?: BalanceChange; heldInEscrow?: BalanceChange; restrictedReserve?: BalanceChange };
  };
  const updateWallet = ({ where, data }: WalletMutation) => {
    const row = [...wallets.values()].find((wallet) => wallet.id === where.id);
    if (!row) return null;
    if (where.balance?.gte !== undefined && (row['balance'] as bigint) < where.balance.gte) return null;
    if (where.heldInEscrow?.gte !== undefined && (row['heldInEscrow'] as bigint) < where.heldInEscrow.gte) return null;
    for (const key of ['balance', 'heldInEscrow', 'restrictedReserve'] as const) {
      const change = data[key];
      if (change) row[key] = (row[key] as bigint) + (change.increment ?? 0n) - (change.decrement ?? 0n);
    }
    return { ...row };
  };

  const db: Record<string, unknown> = {
    serviceDefinition: {
      findMany: jest.fn(async (args?: { where?: { isActive?: boolean; key?: { in?: string[] }; supportedLocationTypes?: { has?: string } } }) => {
        let rows = [...serviceDefinitions];
        const where = args?.where;
        if (where?.isActive === true) rows = rows.filter((row) => row.isActive === true);
        if (where?.key?.in) rows = rows.filter((row) => (where.key!.in as string[]).includes(row.key as string));
        if (where?.supportedLocationTypes?.has) {
          const location = where.supportedLocationTypes.has;
          rows = rows.filter((row) => (row.supportedLocationTypes as string[]).includes(location));
        }
        return rows;
      }),
    },
    advisoryRule: {
      findMany: jest.fn(async (args?: { where?: { isActive?: boolean; OR?: Array<{ appliesToLocationTypes?: { isEmpty?: boolean } | { has?: string } }> } }) => {
        let rows = [...advisoryRulesRows];
        const where = args?.where;
        if (where?.isActive === true) rows = rows.filter((rule) => rule.isActive !== false);
        const or = where?.OR ?? [];
        const allowsEmpty = or.some((c) => c.appliesToLocationTypes && 'isEmpty' in c.appliesToLocationTypes && c.appliesToLocationTypes.isEmpty === true);
        const hasClause = or.find((c) => c.appliesToLocationTypes && 'has' in c.appliesToLocationTypes)?.appliesToLocationTypes as { has?: string } | undefined;
        if (allowsEmpty || hasClause) {
          rows = rows.filter((rule) => {
            const list = (rule.appliesToLocationTypes as string[] | undefined) ?? [];
            return (allowsEmpty && list.length === 0) || (hasClause?.has !== undefined && list.includes(hasClause.has));
          });
        }
        return rows;
      }),
    },
    platformConfig: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
        platformConfigRows.find((config) => config.key === where.key) ?? null,
      ),
    },
    city: {
      findFirst: jest.fn(async ({ where }: { where: { slug: string } }) => cities.find(({ slug }) => slug === where.slug) ?? null),
    },
    installationRateCard: {
      findMany: jest.fn(async () => ['ALARM', 'CCTV'].map((serviceKey) => ({
        id: `rate-${serviceKey}`, serviceKey, version: 1, cityId: 'city-mashhad', branchId: 'b1',
        standardMinutes: 60, hourlyRate: 1_000_000n, minVisitWage: 1_000_000n, normalAllowance: 30_000n,
        effortBps: 10_000, physicalDifficultyBps: 10_000, technicalDifficultyBps: 10_000, meteredLaborPerMeter: 1_000n,
      }))),
    },
    branch: {
      findFirst: jest.fn(async ({ where }: { where: { cityId?: string; isActive?: boolean } }) =>
        branches.find((b) =>
          (where.cityId === undefined || b.cityId === where.cityId) &&
          (where.isActive === undefined || b.isActive === where.isActive),
        ) ?? null,
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        branches.find((b) => b.id === where.id) ?? null,
      ),
    },
    customerProfile: {
      findUnique: jest.fn(async ({ where }: { where: { userId: string } }) =>
        customerProfiles.find((p) => p.userId === where.userId) ?? null,
      ),
    },
    address: {
      findUnique: jest.fn(async ({ where, include }: { where: { id: string }; include?: { city?: boolean } }) => {
        const row = addresses.find((a) => a.id === where.id);
        if (!row) return null;
        return include?.city ? { ...row, city: cities.find((c) => c.id === row['cityId']) } : { ...row };
      }),
    },
    technicianProfile: {
      findUnique: jest.fn(async ({ where }: { where: { userId: string } }) => {
        const row = technicianProfiles.find((p) => p.userId === where.userId);
        return row ? { ...row } : null;
      }),
      findMany: jest.fn(async ({ where }: { where?: Prisma.TechnicianProfileWhereInput } = {}) => eligibleTechnicians(where)),
      findFirst: jest.fn(async ({ where }: { where?: Prisma.TechnicianProfileWhereInput } = {}) => eligibleTechnicians(where)[0] ?? null),
      update: jest.fn(async ({ where, data }: { where: { userId?: string; id?: string }; data: Record<string, unknown> }) => {
        const row = technicianProfiles.find(
          (p) => (where.userId !== undefined ? p.userId === where.userId : p.id === where.id),
        ) as Row | undefined;
        if (!row) return null;
        const increment = (data['completedJobs'] as { increment?: number } | undefined)?.increment;
        if (increment) row['completedJobs'] = ((row['completedJobs'] as number) ?? 0) + increment;
        if (typeof data['warrantyClaimRate'] === 'number') row['warrantyClaimRate'] = data['warrantyClaimRate'];
        if (typeof data['rating'] === 'number') row['rating'] = data['rating'];
        if (data['ratingCount']) row['ratingCount'] = ((row['ratingCount'] as number) ?? 0) + 1;
        if (typeof data['isOnline'] === 'boolean') row['isOnline'] = data['isOnline'];
        if (data['lastKnownLat'] !== undefined) row['lastKnownLat'] = data['lastKnownLat'];
        if (data['lastKnownLng'] !== undefined) row['lastKnownLng'] = data['lastKnownLng'];
        if (data['lastLocationAt']) row['lastLocationAt'] = data['lastLocationAt'];
        return { ...row };
      }),
    },
    serviceOrder: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { ...data, id: nextId('order') };
        serviceOrders.push(row);
        return { ...row };
      }),
      findUnique: jest.fn(async ({ where, include }: { where?: { id: string }; include?: Record<string, boolean | object> } = {}) => {
        const row = serviceOrders.find((o) => o.id === where?.id);
        if (!row) return null;
        const result: Row = { ...row };
        if (include?.['items']) {
          result['items'] = orderItems
            .filter((item) => item['orderId'] === row.id)
            .map((item) => ({
              ...item,
              serviceDefinition: defById.get(item['serviceDefinitionId'] as string),
              hardwareUnits: hardwareUnits.filter((unit) => unit['orderItemId'] === item.id),
            }));
        }
        if (include?.['address']) {
          const address = addresses.find((a) => a.id === row['addressId']);
          result['address'] = address ? { ...address, city: cities.find((c) => c.id === address['cityId']) } : null;
        }
        return result;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = serviceOrders.find((o) => o.id === where.id) as Row;
        Object.assign(row, data);
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id: string; state: string }; data: Row }) => {
        const row = serviceOrders.find((o) => o.id === where.id);
        if (!row || row['state'] !== where.state) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      count: jest.fn(async ({ where }: { where?: { customerId?: string; technicianId?: string } } = {}) => {
        let rows = [...serviceOrders];
        if (where?.customerId) rows = rows.filter((o) => o['customerId'] === where.customerId);
        if (where?.technicianId) rows = rows.filter((o) => o['technicianId'] === where.technicianId);
        return rows.length;
      }),
      findMany: jest.fn(async ({ where }: { where?: { customerId?: string; technicianId?: string } } = {}) => {
        let rows = [...serviceOrders];
        if (where?.customerId) rows = rows.filter((o) => o['customerId'] === where.customerId);
        if (where?.technicianId) rows = rows.filter((o) => o['technicianId'] === where.technicianId);
        return rows;
      }),
    },
    orderItem: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { ...data, id: nextId('item'), createdAt: new Date() };
        orderItems.push(row);
        return { ...row };
      }),
      findMany: jest.fn(async ({ where }: { where?: { orderId?: string } } = {}) =>
        orderItems.filter((item) => !where?.orderId || item['orderId'] === where.orderId).map((item) => ({ id: item.id })),
      ),
    },
    hardwareUnit: {
      createMany: jest.fn(async ({ data }: { data: Row[] }) => {
        for (const row of data) hardwareUnits.push({ ...row, id: nextId('hu') });
        return { count: data.length };
      }),
    },
    orderStateTransition: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { ...data, id: nextId('tr') };
        transitions.push(row);
        return row;
      }),
      createMany: jest.fn(async ({ data }: { data: Row[] }) => {
        for (const row of data) transitions.push({ ...row, id: nextId('tr') });
        return { count: data.length };
      }),
    },
    dispatchOffer: {
      findUnique: jest.fn(async ({ where, include }: { where?: { id: string }; include?: Record<string, boolean> } = {}) => {
        const row = dispatchOffers.find((o) => o.id === where?.id);
        if (!row) return null;
        const result: Row = { ...row };
        if (include?.['technician']) {
          result['technician'] = technicianProfiles.find((p) => p.id === row['technicianId']);
        }
        const order = serviceOrders.find((o) => o.id === row['orderId']);
        if (include?.['order'] && order) result['order'] = orderWithIncludes(order);
        return result;
      }),
      findMany: jest.fn(async (args?: { where?: { orderId?: string; status?: string; technicianId?: { in?: string[]; not?: string } }; include?: Record<string, boolean>; select?: Record<string, boolean> }) => {
        const where = args?.where ?? {};
        let rows = dispatchOffers.filter((offer) => {
          if (where.orderId && offer['orderId'] !== where.orderId) return false;
          if (where.status && offer['status'] !== where.status) return false;
          if (where.technicianId?.not && offer['technicianId'] === where.technicianId.not) return false;
          if (where.technicianId?.in && !where.technicianId.in.includes(offer['technicianId'] as string)) return false;
          return true;
        });
        if (args?.include?.['technician']) {
          rows = rows.map((row) => ({ ...row, technician: technicianProfiles.find((p) => p.id === row['technicianId']) }));
        }
        return rows.map((row) => ({ ...row }));
      }),
      findFirst: jest.fn(async ({ where }: { where: { orderId: string } }) =>
        dispatchOffers.filter((offer) => offer['orderId'] === where.orderId).at(-1) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { ...data, id: nextId('offer'), status: 'PENDING', respondedAt: null };
        dispatchOffers.push(row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = dispatchOffers.find((o) => o.id === where.id) as Row;
        Object.assign(row, data);
        return { ...row };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { orderId?: string; status?: string; technicianId?: { not?: string }; id?: string | { in?: string[] }; expiresAt?: { gt: Date } }; data: Row }) => {
        let count = 0;
        for (const row of dispatchOffers) {
          if (where.orderId && row['orderId'] !== where.orderId) continue;
          if (where.status && row['status'] !== where.status) continue;
          if (where.technicianId?.not && row['technicianId'] === where.technicianId.not) continue;
          if (typeof where.id === 'string' && where.id !== row.id) continue;
          if (typeof where.id === 'object' && where.id.in && !where.id.in.includes(row.id)) continue;
          if (where.expiresAt && (row['expiresAt'] as Date) <= where.expiresAt.gt) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      }),
      count: jest.fn(async ({ where }: { where?: { orderId?: string; status?: string } } = {}) =>
        dispatchOffers.filter((offer) => {
          if (where?.orderId && offer['orderId'] !== where.orderId) return false;
          if (where?.status && offer['status'] !== where.status) return false;
          return true;
        }).length,
      ),
    },
    warranty: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { ...data, id: 'w1', createdAt: new Date() };
        warranties.push(row);
        return { ...row };
      }),
      findUnique: jest.fn(async ({ where, include }: { where?: { id: string }; include?: Record<string, boolean | object> } = {}) => {
        const row = warranties.find((w) => w.id === where?.id);
        if (!row) return null;
        const result: Row = { ...row };
        if (include?.['order']) result['order'] = { ...serviceOrders.find((o) => o.id === row['orderId']) };
        return result;
      }),
      findMany: jest.fn(async ({ where, include }: { where?: { order?: { customerId?: string } }; include?: Record<string, boolean | object> } = {}) => {
        let rows = [...warranties];
        if (where?.order?.customerId) {
          rows = rows.filter((row) => serviceOrders.find((o) => o.id === row['orderId'])?.['customerId'] === where.order!.customerId);
        }
        if (include?.['order']) {
          rows = rows.map((row) => ({ ...row, order: { ...serviceOrders.find((o) => o.id === row['orderId']) } }));
        }
        if (include?.['claims']) {
          rows = rows.map((row) => ({ ...row, claims: claims.filter((c) => c['warrantyId'] === row.id) }));
        }
        return rows;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = warranties.find((w) => w.id === where.id) as Row;
        Object.assign(row, data);
        return { ...row };
      }),
    },
    warrantyClaim: {
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { ...data, id: nextId('claim'), createdAt: new Date() };
        claims.push(row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
        const row = claims.find((c) => c.id === where.id) as Row;
        Object.assign(row, data);
        return { ...row };
      }),
      count: jest.fn(async ({ where }: { where?: { status?: { in?: string[] }; warrantyId?: string; warranty?: { order?: { technicianId?: string } } } } = {}) => {
        return claims.filter((claim) => {
          if (where?.warrantyId && claim['warrantyId'] !== where.warrantyId) return false;
          if (where?.status?.in && !where.status.in.includes(claim['status'] as string)) return false;
          if (where?.warranty?.order?.technicianId) {
            const warranty = warranties.find((w) => w.id === claim['warrantyId']);
            const order = warranty ? serviceOrders.find((o) => o.id === warranty['orderId']) : undefined;
            if (order?.['technicianId'] !== where.warranty.order.technicianId) return false;
          }
          return true;
        }).length;
      }),
      findUnique: jest.fn(async ({ where, include }: { where?: { id: string }; include?: Record<string, object> } = {}) => {
        const row = claims.find((c) => c.id === where?.id);
        if (!row) return null;
        const result: Row = { ...row };
        if (include?.['warranty']) {
          const warranty = warranties.find((w) => w.id === row['warrantyId']);
          result['warranty'] = {
            ...warranty,
            order: warranty ? { ...serviceOrders.find((o) => o.id === warranty['orderId']) } : null,
          };
        }
        return result;
      }),
    },
    review: {
      findUnique: jest.fn(async ({ where }: { where: { orderId: string } }) =>
        reviews.find((r) => r['orderId'] === where.orderId) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { ...data, id: nextId('review'), createdAt: new Date() };
        reviews.push(row);
        return row;
      }),
    },
    wallet: {
      findUnique: jest.fn(async ({ where }: { where: { ownerType_ownerId: { ownerType: string; ownerId: string } } }) => {
        const row = wallets.get(`${where.ownerType_ownerId.ownerType}:${where.ownerType_ownerId.ownerId}`);
        return row ? { ...row } : null;
      }),
      update: jest.fn(async (mutation: WalletMutation) => updateWallet(mutation)),
      updateMany: jest.fn(async (mutation: WalletMutation) => ({ count: updateWallet(mutation) ? 1 : 0 })),
      updateManyAndReturn: jest.fn(async (mutation: WalletMutation) => {
        const row = updateWallet(mutation);
        return row ? [row] : [];
      }),
    },
    walletTransaction: {
      findUnique: jest.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
        walletTransactions.find((tx) => tx['idempotencyKey'] === where.idempotencyKey) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Row }) => {
        const row = { ...data, id: nextId('tx'), createdAt: new Date() };
        walletTransactions.push(row);
        return row;
      }),
    },
    $queryRaw: jest.fn(async (query: TemplateStringsArray, id: string) => {
      const rows = query[0]?.includes('"ServiceOrder"') ? serviceOrders : technicianProfiles;
      return rows.filter((row) => row.id === id);
    }),
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  // Expose the raw stores for test assertions & seeding.
  Object.assign(db, {
    serviceOrders,
    orderItems,
    hardwareUnits,
    transitions,
    dispatchOffers,
    warranties,
    claims,
    reviews,
    walletTransactions,
    technicianProfiles,
    wallets,
    addresses,
    branches,
  });
  return db as unknown as PrismaService & {
    serviceOrders: Row[];
    orderItems: Row[];
    hardwareUnits: Row[];
    transitions: Row[];
    dispatchOffers: Row[];
    warranties: Row[];
    claims: Row[];
    reviews: Row[];
    walletTransactions: Row[];
    technicianProfiles: Row[];
    wallets: Map<string, Row>;
    addresses: Row[];
    branches: Row[];
  };
}

describe('PHASE 1 — full lifecycle e2e (Catalog → … → Review → Claim)', () => {
  const redis = createInMemoryRedis();
  const prisma = createInMemoryPrisma();
  const evaluator = new JsonLogicEvaluator();
  const catalog = new CatalogService(prisma);
  const factorsStub = {
    getSurge: jest.fn().mockResolvedValue({ multiplier: 1, activeTechs: 2, pendingOrders: 1, reasonFa: 'تعرفه عادی' }),
    getUrgency: jest.fn().mockResolvedValue({ urgency: 'SCHEDULED', multiplier: 1 }),
    getBundleDiscountPercent: jest.fn(async (count: number) => (count >= 3 ? 10 : count === 2 ? 6 : 0)),
  } as unknown as DynamicFactorsService;
  const pricing = new PricingService(prisma, new PricingSchemaInterpreter(evaluator), factorsStub);
  const advisory = new AdvisoryService(prisma, evaluator, pricing);
  const notifications = { send: jest.fn().mockResolvedValue({}) } as unknown as NotificationsService & { send: jest.Mock };
  const realtime = { emitToUser: jest.fn(), emitToOrder: jest.fn() } as unknown as RealtimeService & { emitToUser: jest.Mock; emitToOrder: jest.Mock };
  const walletEscrow = new WalletEscrowService(prisma);
  const config = { isProduction: false, otpDevEcho: true } as unknown as AppConfigService;
  const orders = new OrdersService(prisma, pricing, walletEscrow, notifications, new EventEmitter2());
  const dispatch = new DispatchService(prisma, redis as unknown as RedisService, realtime, notifications);
  const warranty = new WarrantyService(
    prisma,
    walletEscrow,
    notifications,
    realtime,
    config,
    redis as unknown as import('@infra/redis/redis.service').RedisService,
  );
  const reviews = new ReviewsService(prisma);

  let orderId = '';
  let handoverOtp = '';

  it('STEP 1 — catalog serves the 3 engineering pillars for SHOP', async () => {
    const result = await catalog.listSchemas('SHOP');
    expect(result.pillars).toHaveLength(3);
    expect(result.pillars.map((p) => p.pillar)).toEqual(['PHYSICAL', 'INTRUSION', 'MONITORING']);
  });

  it('STEP 2 — advisory detects the SHOP CCTV-without-alarm gap', async () => {
    const result = await advisory.evaluate({
      locationType: 'SHOP',
      servicesConfig: { CCTV: { active: true } },
    });
    expect(result.advisories.map((a) => a.code)).toContain('SHOP_CCTV_NO_ALARM');
  });

  it('STEP 3 — pricing estimates the install-only ALARM+CCTV bundle in BigInt Toman', async () => {
    const result = await pricing.estimate({
      citySlug: 'mashhad',
      supplyMode: 'INSTALL_ONLY',
      items: [
        { serviceKey: 'ALARM', config: {} },
        { serviceKey: 'CCTV', config: {} },
      ],
    });
    expect(result.currency).toBe('TOMAN');
    expect(typeof result.netEstimated).toBe('bigint');
    expect(result.summary).toEqual({ totalHardware: 0n, bundleDiscountPercent: 6 });
    expect(result.invoice.buckets.map(({ bucket }) => bucket)).toEqual(['FIXED', 'SERVICE_PACKAGE', 'METERED']);
  });

  it('STEP 4 — resumes a saved Phase 1 order in SEARCHING_EXPERT', async () => {
    prisma['addresses'].push({
      id: 'addr1', customerId: 'cp1', cityId: 'city-mashhad', locationType: 'SHOP',
      lat: 36.3, lng: 59.6, isDefault: true,
    });
    orderId = 'legacy-order';
    prisma.serviceOrders.push({
      id: orderId, orderNumber: 'HM-2026-000001', customerId: customer.id, branchId: 'b1',
      addressId: 'addr1', state: 'SEARCHING_EXPERT', technicianId: null, pricingVersion: 1,
      urgency: 'SCHEDULED', supplyMode: 'FULL_PACKAGE', locationType: 'SHOP', lat: 36.3, lng: 59.6,
    });
    prisma.orderItems.push(
      { id: 'legacy-alarm', orderId, serviceDefinitionId: 'def-ALARM' },
      { id: 'legacy-cctv', orderId, serviceDefinitionId: 'def-CCTV' },
    );
    await expect(orders.getOne(customer, orderId)).resolves.toMatchObject({ state: 'SEARCHING_EXPERT', pricingVersion: 1 });
  });

  it('STEP 5 — resumes auto-dispatch and sends two weighted offers to nearby technicians', async () => {
    // Both technicians go online inside the first 5000m ring.
    await dispatch.setTechnicianStatus(techA, { isOnline: true, lat: 36.3015, lng: 59.6 });
    await dispatch.setTechnicianStatus(techB, { isOnline: true, lat: 36.3025, lng: 59.6 });

    await expect(dispatch.startSearch(orderId)).resolves.toMatchObject({ offersCreated: 2 });

    const offers = prisma['dispatchOffers'].filter((offer) => offer['orderId'] === orderId);
    expect(offers).toHaveLength(2);
    expect(offers.every((offer) => offer['status'] === 'PENDING')).toBe(true);
    expect(offers.every((offer) => offer['orderLockKey'] === redis.orderLockKey(orderId))).toBe(true);
    // Quality technician scored above the sloppy closer one.
    const scored = offers.map((offer) => ({ tech: offer['technicianId'], score: offer['score'] as number }));
    expect(scored.find((s) => s.tech === 'tp-a')!.score).toBeGreaterThan(scored.find((s) => s.tech === 'tp-b')!.score);
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DISPATCH_OFFER' }),
    );
  });

  it('STEP 6 — atomic single-winner accept: techA wins, techB cancelled + OFFER_TAKEN', async () => {
    const offers = prisma['dispatchOffers'].filter((offer) => offer['orderId'] === orderId);
    const offerA = offers.find((offer) => offer['technicianId'] === 'tp-a') as Row;
    const offerB = offers.find((offer) => offer['technicianId'] === 'tp-b') as Row;
    expect(offerA).toBeDefined();
    expect(offerB).toBeDefined();

    const result = await dispatch.acceptOffer(techA, offerA.id as string);
    expect(result.state).toBe('EXPERT_ASSIGNED');

    const order = prisma['serviceOrders'].find((o) => o.id === orderId) as Row;
    expect(order['state']).toBe('EXPERT_ASSIGNED');
    expect(order['technicianId']).toBe('t1');
    expect(offerA['status']).toBe('ACCEPTED');
    expect(offerB['status']).toBe('CANCELLED');
    expect(realtime.emitToUser).toHaveBeenCalledWith('t2', 'OFFER_TAKEN', expect.objectContaining({ orderId }));

    // The losing technician cannot accept afterwards.
    await expect(dispatch.acceptOffer(techB, offerB.id as string)).rejects.toThrow(ConflictException);
  });

  it('STEP 7 — en route → inspection, where an existing saved quote can still be approved', async () => {
    await orders.enRoute(techA, orderId);
    await orders.startInspection(techA, orderId);
    const order = prisma.serviceOrders.find((o) => o.id === orderId);
    if (!order) throw new Error('Legacy order missing');
    expect(order['state']).toBe('INSPECTING');
    order['finalQuoteAmount'] = 2_000_000n;
  });

  it('STEP 8 — approve-quote holds the escrow INSIDE the transition', async () => {
    await orders.approveQuote(customer, orderId);
    const order = prisma['serviceOrders'].find((o) => o.id === orderId) as Row;
    expect(order['state']).toBe('QUOTE_APPROVED');

    const wallet = prisma['wallets'].get('CUSTOMER:c1') as Row;
    expect(wallet['balance']).toBe(48_000_000n); // 50M − 2M quote
    expect(wallet['heldInEscrow']).toBe(2_000_000n);
    expect(prisma['walletTransactions'].some((tx) => tx['type'] === 'ESCROW_HOLD' && tx['idempotencyKey'] === `escrow:hold:${orderId}`)).toBe(true);
  });

  it('STEP 9 — start work → IN_PROGRESS (not cancellable anymore)', async () => {
    await orders.startWork(techA, orderId);
    const order = prisma['serviceOrders'].find((o) => o.id === orderId) as Row;
    expect(order['state']).toBe('IN_PROGRESS');
    await expect(orders.cancel(customer, orderId, { reason: 'late' })).rejects.toThrow(ConflictException);
  });

  it('STEP 10 — handover gate: serials (FULL_PACKAGE) → checklist + OTP → SMS to customer', async () => {
    const items = prisma['orderItems'].filter((item) => item['orderId'] === orderId);
    await warranty.registerHardwareUnits(techA, orderId, {
      units: [
        { orderItemId: (items[0] as Row).id as string, categoryFa: 'پنل دزدگیر', brand: 'FGuard', model: 'X100', serialNumber: 'SN-ALARM-0001' },
        { orderItemId: (items[0] as Row).id as string, categoryFa: 'آژیر بیرونی', serialNumber: 'SN-SIREN-0001' },
        { orderItemId: (items[1] as Row).id as string, categoryFa: 'دوربین مداربسته', serialNumber: 'SN-CCTV-0001' },
      ],
    });
    expect(prisma['hardwareUnits']).toHaveLength(3);

    const result = await warranty.requestHandover(techA, orderId, {
      defaultPasswordsChanged: true,
      technicianAccessRevoked: true,
    });
    expect(result.state).toBe('HANDOVER_OTP_PENDING');
    expect(result.devHandoverOtp).toMatch(/^\d{6}$/);
    handoverOtp = result.devHandoverOtp as string;
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'HANDOVER_OTP', channel: 'SMS', userId: 'c1' }),
    );
  });

  it('STEP 11 — complete handover: warranty WR-… ACTIVE + escrow split (10% showroom override, 5% reserve)', async () => {
    const result = await warranty.completeHandover(techA, orderId, { otp: handoverOtp });

    expect(result.state).toBe('COMPLETED_WARRANTY_ACTIVE');
    const order = prisma['serviceOrders'].find((o) => o.id === orderId) as Row;
    expect(order['state']).toBe('COMPLETED_WARRANTY_ACTIVE');
    expect(order['completedAt']).toBeInstanceOf(Date);

    // Digital warranty — per-item coverage min(12, 18) = 12 months.
    expect(result.warrantyPolicyNumber).toMatch(/^WR-\d{4}-\d{6}$/);
    expect(result.coverageMonths).toBe(12);
    expect(result.guaranteedNetPayout).toBe(1_700_000n);
    expect(prisma.warranties).toEqual([expect.objectContaining({
      policyNumber: result.warrantyPolicyNumber, warrantyReserveAmount: 100_000n, status: 'ACTIVE',
    })]);

    const platformWallet = prisma['wallets'].get(`PLATFORM:${PLATFORM_WALLET_OWNER_ID}`) as Row;
    const techWallet = prisma['wallets'].get('TECHNICIAN:t1') as Row;
    const customerWallet = prisma['wallets'].get('CUSTOMER:c1') as Row;
    expect(platformWallet['balance']).toBe(200_000n);
    expect(platformWallet['restrictedReserve']).toBe(100_000n);
    expect(techWallet['balance']).toBe(1_700_000n);
    expect(customerWallet['heldInEscrow']).toBe(0n);

    const techProfile = prisma['technicianProfiles'].find((p) => p.userId === 't1') as Row;
    expect(techProfile['completedJobs']).toBe(234);

    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'WARRANTY_ACTIVATED', userId: 'c1' }),
    );
    expect(realtime.emitToOrder).toHaveBeenCalledWith(orderId, 'WARRANTY_ACTIVATED', expect.anything());
  });

  it('STEP 12 — customer review updates the technician rating & count (dispatch feedback)', async () => {
    const review = await reviews.reviewOrder(customer, orderId, { rating: 5, commentFa: 'نصب حرفه‌ای بود.' });
    expect(review.rating).toBe(5);
    const techProfile = prisma['technicianProfiles'].find((p) => p.userId === 't1') as Row;
    expect(techProfile['ratingCount']).toBe(211);
    expect(techProfile['rating']).toBe(4.9); // ((4.9×210)+5)/211 = 4.9005 → 4.9

    await expect(reviews.reviewOrder(customer, orderId, { rating: 1 })).rejects.toThrow(/فقط یک‌بار/);
  });

  it('STEP 13 — digital warranty card, claim lifecycle & claim-rate feedback', async () => {
    const list = await warranty.myWarranties(customer);
    expect(list).toHaveLength(1);
    const warrantyCard = list[0] as Record<string, unknown>;
    expect(warrantyCard['policyNumber']).toMatch(/^WR-\d{4}-\d{6}$/);
    expect(warrantyCard['daysRemaining'] as number).toBeGreaterThan(300);

    const claimResult = await warranty.createClaim(customer, 'w1', {
      descriptionFa: 'آژیر بیرونی صدا ندارد.',
    });
    expect(claimResult.warrantyStatus).toBe('IN_CLAIM');

    const updated = await warranty.updateClaim(branchAdmin, (claimResult.claim as Row).id as string, {
      status: 'APPROVED',
      resolutionNoteFa: 'تعویض آژیر تحت گارانتی.',
    });
    expect(updated.warrantyStatus).toBe('ACTIVE'); // restored after resolution
    const techProfile = prisma['technicianProfiles'].find((p) => p.userId === 't1') as Row;
    // 1 approved claim / 234 completed jobs
    expect(techProfile['warrantyClaimRate']).toBeCloseTo(1 / 234, 4);
  });
});
