import { Injectable } from '@nestjs/common';
// Value imports REQUIRED for NestJS DI metadata (see Part A hotfix #1).
import { PrismaService } from '@infra/prisma/prisma.service';
import { RedisService } from '@infra/redis/redis.service';

export interface DependencyHealth {
  healthy: boolean;
  detail?: string;
  error?: string;
}

export interface HealthReport {
  healthy: boolean;
  postgres: DependencyHealth;
  redis: DependencyHealth;
  checkedAt: string;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Both dependencies must be healthy for the app to report healthy. */
  async check(): Promise<HealthReport> {
    const [postgres, redis] = await Promise.allSettled([
      this.prisma.ping(),
      this.redis.ping(),
    ]);

    const postgresHealth = this.toDependencyHealth(
      postgres,
      (result) => `PostGIS ${result.postgisVersion}`,
    );
    const redisHealth = this.toDependencyHealth(redis, (result) => `PONG in ${result.latencyMs}ms`);

    return {
      healthy: postgresHealth.healthy && redisHealth.healthy,
      postgres: postgresHealth,
      redis: redisHealth,
      checkedAt: new Date().toISOString(),
    };
  }

  private toDependencyHealth<T>(
    result: PromiseSettledResult<T>,
    detail: (value: T) => string,
  ): DependencyHealth {
    if (result.status === 'fulfilled') {
      return { healthy: true, detail: detail(result.value) };
    }
    const reason: unknown = result.reason;
    return {
      healthy: false,
      error: reason instanceof Error ? reason.message : String(reason),
    };
  }
}
