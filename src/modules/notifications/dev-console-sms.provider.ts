import { Injectable, Logger } from '@nestjs/common';
import type { SmsMessage, SmsProvider } from './sms-provider.interface';

/** Dev/test stub: logs Persian SMS to the console instead of sending. */
@Injectable()
export class DevConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(DevConsoleSmsProvider.name);

  async sendSms(message: SmsMessage): Promise<void> {
    this.logger.log(`[SMS-DEV] به ${message.phone}: ${message.message.replace(/\n/g, ' | ')}`);
  }
}
