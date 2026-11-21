import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokensService } from './tokens.service';

// JWT wiring lives in the global JwtConfigModule (imported by AppModule) so
// other core modules can use JwtAuthGuard without importing AuthModule.
@Module({
  imports: [NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService, TokensService],
  exports: [AuthService],
})
export class AuthModule {}
