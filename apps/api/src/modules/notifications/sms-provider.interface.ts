export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsMessage {
  phone: string;
  message: string;
}

/** Pluggable SMS transport — swap DevConsoleSmsProvider for Kavenegar/SMS.ir in production. */
export interface SmsProvider {
  sendSms(message: SmsMessage): Promise<void>;
}
