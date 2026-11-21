import { Module } from '@nestjs/common';
import { DevConsoleSmsProvider } from './dev-console-sms.provider';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { SMS_PROVIDER } from './sms-provider.interface';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    { provide: SMS_PROVIDER, useClass: DevConsoleSmsProvider },
  ],
  exports: [NotificationsService, SMS_PROVIDER],
})
export class NotificationsModule {}
