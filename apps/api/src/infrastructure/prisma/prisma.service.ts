import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export interface PrismaPingResult {
  postgisVersion: string;
}

/**
 * Global Prisma client wrapper.
 * `ping()` verifies PostgreSQL connectivity AND that the PostGIS extension is
 * actually usable (`PostGIS_Version()`) — required by the geo-sync triggers.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async ping(): Promise<PrismaPingResult> {
    await this.$queryRaw`SELECT 1`;
    const rows = await this.$queryRaw<{ postgisVersion: string }[]>`SELECT PostGIS_Version() AS "postgisVersion"`;
    const postgisVersion = rows[0]?.postgisVersion;
    if (!postgisVersion) {
      throw new Error('PostGIS is not available on the connected PostgreSQL instance');
    }
    return { postgisVersion };
  }
}
