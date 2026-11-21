import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { OtpCode, Prisma } from '@prisma/client';
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '@config/app-config.service';
import { PrismaService } from '@infra/prisma/prisma.service';
import { RedisService } from '@infra/redis/redis.service';
import type { SmsProvider } from '../notifications/sms-provider.interface';
import { SMS_PROVIDER } from '../notifications/sms-provider.interface';

const OTP_RATE_PER_MINUTE = 1;
const OTP_RATE_PER_HOUR = 5;

export interface OtpRequestResult {
  sent: boolean;
  /** ONLY present when OTP_DEV_ECHO=true outside production (Invariant: dev convenience). */
  devCode?: string;
  expiresInSeconds: number;
}

function tooManyRequests(retryAfterMs: number): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: 'درخواست کد تأیید بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * OTP generation, hashed persistence (scrypt + per-code random salt) and
 * Redis-backed rate limiting (1/minute, 5/hour per phone).
 */
@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {}

  async request(phone: string): Promise<OtpRequestResult> {
    const perMinute = await this.redis.rateLimit(
      `auth:otp:req:1m:${phone}`,
      OTP_RATE_PER_MINUTE,
      60_000,
    );
    if (!perMinute.allowed) throw tooManyRequests(perMinute.retryAfterMs);

    const perHour = await this.redis.rateLimit(
      `auth:otp:req:1h:${phone}`,
      OTP_RATE_PER_HOUR,
      3_600_000,
    );
    if (!perHour.allowed) throw tooManyRequests(perHour.retryAfterMs);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const salt = randomBytes(16).toString('hex');
    await this.prisma.otpCode.create({
      data: {
        phone,
        codeHash: `${salt}:${this.hashCode(code, salt)}`,
        purpose: 'LOGIN',
        expiresAt: new Date(Date.now() + this.config.otpTtlSeconds * 1000),
      },
    });

    await this.smsProvider.sendSms({
      phone,
      message: `کد ورود شما به هومنتال: ${code}\nاعتبار: ${Math.ceil(this.config.otpTtlSeconds / 60)} دقیقه`,
    });

    return {
      sent: true,
      devCode: this.config.otpDevEcho ? code : undefined,
      expiresInSeconds: this.config.otpTtlSeconds,
    };
  }

  /**
   * Finds the latest unconsumed, unexpired OTP and verifies the code.
   * Mismatches increment `attempts`; after OTP_MAX_ATTEMPTS the code is
   * invalidated. Returns the record to be consumed atomically by AuthService.
   */
  async assertConsumable(phone: string, code: string): Promise<OtpCode> {
    const record = await this.prisma.otpCode.findFirst({
      where: { phone, purpose: 'LOGIN', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'کد تأیید فعالی یافت نشد یا منقضی شده است؛ دوباره درخواست بدهید.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (record.attempts >= this.config.otpMaxAttempts) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'تعداد تلاش‌های ناموفق بیش از حد مجاز است؛ کد جدید درخواست کنید.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    const [salt, storedHash] = record.codeHash.split(':');
    if (!salt || !storedHash || !this.safeEqual(code, salt, storedHash)) {
      const attempts = record.attempts + 1;
      const invalidated = attempts >= this.config.otpMaxAttempts;
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { attempts, ...(invalidated ? { consumedAt: new Date() } : {}) },
      });
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'کد واردشده نادرست است.' },
        HttpStatus.BAD_REQUEST,
      );
    }
    return record;
  }

  /** Marks the OTP consumed — MUST run inside the provisioning transaction. */
  consumeInTransaction(tx: Prisma.TransactionClient, otpId: string): Promise<OtpCode> {
    return tx.otpCode.update({ where: { id: otpId }, data: { consumedAt: new Date() } });
  }

  private hashCode(code: string, salt: string): string {
    return scryptSync(code, salt, 32).toString('hex');
  }

  private safeEqual(code: string, salt: string, storedHex: string): boolean {
    const actual = Buffer.from(this.hashCode(code, salt), 'hex');
    const stored = Buffer.from(storedHex, 'hex');
    return actual.length === stored.length && timingSafeEqual(actual, stored);
  }
}
