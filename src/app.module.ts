import { Module } from '@nestjs/common';
import { AppConfigModule } from '@config/app-config.module';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { RedisModule } from '@infra/redis/redis.module';
import { AuthModule } from '@modules/auth/auth.module';
import { JwtConfigModule } from '@modules/auth/jwt-config.module';
import { CitiesBranchesModule } from '@modules/cities-branches/cities-branches.module';
import { HealthModule } from '@modules/health/health.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { SecurityServicesModule } from '@modules/security-services/security-services.module';
import { UsersModule } from '@modules/users/users.module';

// Core modules first, verticals last. Core never imports verticals
// (ARCHITECTURE.md Invariant 11).
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    JwtConfigModule,
    HealthModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    CitiesBranchesModule,
    SecurityServicesModule,
  ],
})
export class AppModule {}
