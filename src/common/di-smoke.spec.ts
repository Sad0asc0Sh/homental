import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigService } from '@config/app-config.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RedisService } from '@infra/redis/redis.service';
import { HealthController } from '@modules/health/health.controller';
import { HealthService } from '@modules/health/health.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { WalletEscrowService } from '@modules/wallet-escrow/wallet-escrow.service';
import { B2BSupplyService } from '@modules/partner-supply/b2b-supply.service';
import { SellerPortalService } from '@modules/partner-supply/seller-portal.service';
import { SupplierCasesService } from '@modules/partner-supply/supplier-cases.service';
import { AppModule } from '../app.module';
import { OrdersService } from '@modules/security-services/orders/orders.service';
import { DispatchService } from '@modules/security-services/dispatch/dispatch.service';
import { WarrantyService } from '@modules/security-services/warranty/warranty.service';
import { ReviewsService } from '@modules/security-services/reviews/reviews.service';
import { PricingService } from '@modules/security-services/pricing/pricing.service';
import { CatalogService } from '@modules/security-services/catalog/catalog.service';
import { AdvisoryService } from '@modules/security-services/advisory/advisory.service';

/**
 * Part A hotfix #1 — DI regression guard.
 *
 * `eslint --fix` once rewrote constructor-injected classes to `import type`,
 * which erases `design:paramtypes` under emitDecoratorMetadata and crashes
 * NestFactory.create with "Object" tokens at RUNTIME (tsc/jest pass silently).
 * This smoke test compiles the real module graph, so an erased token makes
 * compile() throw "Nest can't resolve dependencies of X (Object, ...)".
 *
 * Extended in Phase 2: compiles the FULL AppModule (core + verticals), which
 * additionally catches cross-module wiring bugs — e.g. SecurityServicesModule
 * forgetting to import NotificationsModule while OrdersService injects
 * NotificationsService. compile() instantiates every provider but does NOT run
 * lifecycle hooks, so nothing actually connects to PostgreSQL/Redis here.
 */
process.env.DATABASE_URL ??= 'postgresql://homental:homental_dev@localhost:5432/homental';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET ??= 'di-smoke-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET ??= 'di-smoke-refresh-secret-0123456789abcdef';

describe('Part A fix #1 — NestJS DI resolution (full AppModule graph)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  });

  it('resolves the Health graph with real provider classes', () => {
    expect(moduleRef.get(HealthController)).toBeInstanceOf(HealthController);
    expect(moduleRef.get(HealthService)).toBeInstanceOf(HealthService);
    expect(moduleRef.get(RedisService)).toBeInstanceOf(RedisService);
    // NOTE: Prisma v6's generated client constructor returns an internal
    // wrapper object, so `instanceof` is unreliable for PrismaService — exact
    // constructor identity is the stricter, correct assertion here.
    const prisma = moduleRef.get(PrismaService);
    expect(prisma.constructor).toBe(PrismaService);
    expect(typeof prisma.ping).toBe('function');
    expect(moduleRef.get(AppConfigService)).toBeInstanceOf(AppConfigService);
  });

  it('resolves the core NotificationsService and WalletEscrowService', () => {
    expect(moduleRef.get(NotificationsService)).toBeInstanceOf(NotificationsService);
    expect(moduleRef.get(WalletEscrowService)).toBeInstanceOf(WalletEscrowService);
  });

  it('resolves the full security-services vertical (Orders → Notifications wiring)', () => {
    // If any constructor param token is erased or a module import is missing,
    // compile() above already threw "Nest can't resolve dependencies".
    expect(moduleRef.get(OrdersService)).toBeInstanceOf(OrdersService);
    expect(moduleRef.get(DispatchService)).toBeInstanceOf(DispatchService);
    expect(moduleRef.get(WarrantyService)).toBeInstanceOf(WarrantyService);
    expect(moduleRef.get(ReviewsService)).toBeInstanceOf(ReviewsService);
    expect(moduleRef.get(PricingService)).toBeInstanceOf(PricingService);
    expect(moduleRef.get(CatalogService)).toBeInstanceOf(CatalogService);
    expect(moduleRef.get(AdvisoryService)).toBeInstanceOf(AdvisoryService);
  });

  it('wired AppConfigService into RedisService via its real class token', () => {
    const redis = moduleRef.get(RedisService);
    // If AppConfigService were injected as an erased `Object` token this
    // getter would never exist / resolve.
    expect(redis.orderLockKey('order-1')).toBe('dispatch:order:lock:order-1');
  });

  it('resolves the partner-supply vertical in the full application', () => {
    expect(moduleRef.get(B2BSupplyService)).toBeInstanceOf(B2BSupplyService);
    expect(moduleRef.get(SellerPortalService)).toBeInstanceOf(SellerPortalService);
    expect(moduleRef.get(SupplierCasesService)).toBeInstanceOf(SupplierCasesService);
  });

  afterAll(async () => {
    // Close the ioredis clients created during compile() (no live Redis in CI).
    await moduleRef.get(RedisService).onApplicationShutdown().catch(() => undefined);
    await moduleRef.get(PrismaService).$disconnect().catch(() => undefined);
    // Give the event loop a tick to release closed sockets before jest exits.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
