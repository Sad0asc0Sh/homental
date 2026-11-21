import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AppConfigService } from '@config/app-config.service';

/**
 * Global JwtModule wiring. Kept separate from AuthModule so EVERY module
 * (notifications inbox, users, cities-branches, …) can use JwtAuthGuard /
 * JwtService without importing AuthModule — which would create a circular
 * dependency (AuthModule imports NotificationsModule for the SMS provider).
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.jwtAccessSecret,
      }),
    }),
  ],
  exports: [JwtModule],
})
export class JwtConfigModule {}
