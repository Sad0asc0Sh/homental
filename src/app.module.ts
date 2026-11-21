import { Module } from '@nestjs/common';
import { AppConfigModule } from '@config/app-config.module';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { RedisModule } from '@infra/redis/redis.module';
import { HealthModule } from '@modules/health/health.module';

@Module({
  imports: [AppConfigModule, PrismaModule, RedisModule, HealthModule],
})
export class AppModule {}
