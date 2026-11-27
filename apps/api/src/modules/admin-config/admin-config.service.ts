import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import {
  MANAGED_CONFIG_KEYS,
  PLATFORM_CONFIG_DEFAULTS,
  validatePlatformConfig,
} from './platform-config.schemas';

@Injectable()
export class AdminConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async listAll() {
    const rows = await this.prisma.platformConfig.findMany({ orderBy: { key: 'asc' } });
    const rowByKey = new Map(rows.map((r) => [r.key, r]));

    return MANAGED_CONFIG_KEYS.map((key) => {
      const existing = rowByKey.get(key);
      if (existing) return existing;
      return {
        key,
        value: PLATFORM_CONFIG_DEFAULTS[key] ?? {},
        updatedAt: null,
        updatedBy: null,
      };
    });
  }

  async updateByKey(actor: AuthenticatedUser, key: string, value: Record<string, unknown>) {
    const parsed = validatePlatformConfig(key, value);
    return this.prisma.platformConfig.upsert({
      where: { key },
      update: {
        value: parsed as unknown as Prisma.InputJsonValue,
        updatedBy: actor.id,
      },
      create: {
        key,
        value: parsed as unknown as Prisma.InputJsonValue,
        updatedBy: actor.id,
      },
    });
  }
}
