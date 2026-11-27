import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppConfigModule } from '@config/app-config.module';
import { PrismaModule } from '@infra/prisma/prisma.module';
import { RealtimeModule } from '@infra/realtime/realtime.module';
import { RedisModule } from '@infra/redis/redis.module';
import { AuthModule } from '@modules/auth/auth.module';
import { JwtConfigModule } from '@modules/auth/jwt-config.module';
import { AdminConfigModule } from '@modules/admin-config/admin-config.module';
import { CitiesBranchesModule } from '@modules/cities-branches/cities-branches.module';
import { HealthModule } from '@modules/health/health.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { PartnerSupplyModule } from '@modules/partner-supply/partner-supply.module';
import { PropertiesModule } from '@modules/properties/properties.module';
import { SecurityServicesModule } from '@modules/security-services/security-services.module';
import { UsersModule } from '@modules/users/users.module';
import { WalletEscrowModule } from '@modules/wallet-escrow/wallet-escrow.module';

// Core modules first, verticals last. Core never imports verticals
// (ARCHITECTURE.md Invariant 11).
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    RealtimeModule,
    EventEmitterModule.forRoot(),
    JwtConfigModule,
    HealthModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    CitiesBranchesModule,
    WalletEscrowModule,
    AdminConfigModule,
    PropertiesModule,
    SecurityServicesModule,
    PartnerSupplyModule,
  ],
})
export class AppModule {}
