import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '@config/app-config.module';
import { AppConfigService } from '@config/app-config.service';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RedisModule } from '@infra/redis/redis.module';
import { RedisService } from '@infra/redis/redis.service';
import { HealthController } from '@modules/health/health.controller';
import { HealthService } from '@modules/health/health.service';
import { HealthModule } from '@modules/health/health.module';

/**
 * Part A hotfix #1 — DI regression guard.
 *
 * `eslint --fix` once rewrote constructor-injected classes to `import type`,
 * which erases `design:paramtypes` under emitDecoratorMetadata and crashes
 * NestFactory.create with "Object" tokens at RUNTIME (tsc/jest pass silently).
 * This smoke test compiles the real module graph, so an erased token makes
 * compile() throw "Nest can't resolve dependencies of X (Object, ...)".
 */
process.env.DATABASE_URL ??= 'postgresql://homental:homental_dev@localhost:5432/homental';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET ??= 'di-smoke-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET ??= 'di-smoke-refresh-secret-0123456789abcdef';

describe('Part A fix #1 — NestJS DI resolution (no Object tokens)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule, RedisModule, HealthModule],
    }).compile();
  });

  it('resolves the full Health graph with real provider classes', () => {
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

  it('wired AppConfigService into RedisService via its real class token', () => {
    const redis = moduleRef.get(RedisService);
    // If AppConfigService were injected as an erased `Object` token this
    // getter would never exist / resolve.
    expect(redis.orderLockKey('order-1')).toBe('dispatch:order:lock:order-1');
  });

  afterAll(async () => {
    // Close the ioredis clients created during compile() (no live Redis in CI).
    await moduleRef.get(RedisService).onModuleDestroy().catch(() => undefined);
    await moduleRef.get(PrismaService).$disconnect().catch(() => undefined);
    // Give the event loop a tick to release closed sockets before jest exits.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});
