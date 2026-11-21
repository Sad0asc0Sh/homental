import { HttpException } from '@nestjs/common';
import type { AppConfigService } from '@config/app-config.service';
import type { PrismaService } from '@infra/prisma/prisma.service';
import type { RedisService } from '@infra/redis/redis.service';
import { OtpService } from './otp.service';
import type { SmsProvider } from '../notifications/sms-provider.interface';

const PHONE = '+989123456789';

function buildService(rateLimitResults: Array<{ allowed: boolean; remaining: number; retryAfterMs: number }>) {
  const prisma = {
    otpCode: { create: jest.fn().mockResolvedValue({}), findFirst: jest.fn(), update: jest.fn() },
  } as unknown as PrismaService;
  const redis = { rateLimit: jest.fn() } as unknown as RedisService;
  (redis.rateLimit as jest.Mock).mockImplementation(async () => {
    const next = rateLimitResults.shift();
    return next ?? { allowed: true, remaining: 0, retryAfterMs: 60_000 };
  });
  const config = {
    otpTtlSeconds: 120,
    otpMaxAttempts: 5,
    otpDevEcho: true,
  } as unknown as AppConfigService;
  const sms = { sendSms: jest.fn().mockResolvedValue(undefined) } as unknown as SmsProvider;
  return { service: new OtpService(prisma, redis, config, sms), prisma, redis, sms };
}

describe('OtpService — request rate limiting (Part B #3)', () => {
  it('rejects with 429 + retryAfterSeconds when the 1/minute limit is hit', async () => {
    const { service, prisma, sms } = buildService([
      { allowed: false, remaining: 0, retryAfterMs: 45_000 },
    ]);

    const error = (await service.request(PHONE).catch((e: unknown) => e)) as HttpException;
    expect(error).toBeInstanceOf(HttpException);
    const body = error.getResponse() as Record<string, unknown>;
    expect(body['statusCode']).toBe(429);
    expect(body['retryAfterSeconds']).toBe(45);
    expect(body['message']).toContain('بیش از حد مجاز');
    expect(prisma.otpCode.create).not.toHaveBeenCalled();
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it('rejects with 429 when the 5/hour limit is hit (after minute passes)', async () => {
    const { service } = buildService([
      { allowed: true, remaining: 0, retryAfterMs: 60_000 },
      { allowed: false, remaining: 0, retryAfterMs: 1_200_000 },
    ]);

    const error = (await service.request(PHONE).catch((e: unknown) => e)) as HttpException;
    const body = error.getResponse() as Record<string, unknown>;
    expect(body['statusCode']).toBe(429);
    expect(body['retryAfterSeconds']).toBe(1200);
  });

  it('creates a salted hash, sends SMS and echoes devCode only when enabled', async () => {
    const { service, prisma, sms } = buildService([
      { allowed: true, remaining: 1, retryAfterMs: 60_000 },
      { allowed: true, remaining: 4, retryAfterMs: 3_600_000 },
    ]);

    const result = await service.request(PHONE);
    expect(result.sent).toBe(true);
    expect(result.devCode).toMatch(/^\d{6}$/);
    expect(result.expiresInSeconds).toBe(120);

    expect(prisma.otpCode.create).toHaveBeenCalledTimes(1);
    const createArgs = (prisma.otpCode.create as jest.Mock).mock.calls[0][0] as {
      data: { phone: string; codeHash: string; purpose: string };
    };
    expect(createArgs.data.phone).toBe(PHONE);
    // scrypt salt:hash — 16-byte salt + 32-byte digest, hex encoded
    expect(createArgs.data.codeHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(createArgs.data.purpose).toBe('LOGIN');

    expect(sms.sendSms).toHaveBeenCalledTimes(1);
    const smsArgs = (sms.sendSms as jest.Mock).mock.calls[0][0] as { phone: string; message: string };
    expect(smsArgs.phone).toBe(PHONE);
    expect(smsArgs.message).toContain('کد ورود');
  });
});

describe('OtpService — assertConsumable (Part B #3 verify flow)', () => {
  function buildVerifiedService() {
    const prisma = {
      otpCode: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const redis = { rateLimit: jest.fn() } as unknown as RedisService;
    const config = { otpTtlSeconds: 120, otpMaxAttempts: 5, otpDevEcho: false } as unknown as AppConfigService;
    const sms = { sendSms: jest.fn() } as unknown as SmsProvider;
    return { service: new OtpService(prisma, redis, config, sms), prisma, config };
  }

  it('returns the record when the code matches (scrypt + timing-safe compare)', async () => {
    const { service, prisma } = buildVerifiedService();
    const { scryptSync, randomBytes } = await import('node:crypto');
    const salt = randomBytes(16).toString('hex');
    const correctCode = '123456';
    const record = {
      id: 'otp1',
      phone: PHONE,
      codeHash: `${salt}:${scryptSync(correctCode, salt, 32).toString('hex')}`,
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    (prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(record);

    await expect(service.assertConsumable(PHONE, correctCode)).resolves.toBe(record);
  });

  it('increments attempts on a wrong code and throws the Persian mismatch error', async () => {
    const { service, prisma } = buildVerifiedService();
    const { scryptSync, randomBytes } = await import('node:crypto');
    const salt = randomBytes(16).toString('hex');
    const record = {
      id: 'otp1',
      phone: PHONE,
      codeHash: `${salt}:${scryptSync('999999', salt, 32).toString('hex')}`,
      attempts: 0,
    };
    (prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(record);

    await expect(service.assertConsumable(PHONE, '123456')).rejects.toThrow(HttpException);
    expect(prisma.otpCode.update).toHaveBeenCalledWith({
      where: { id: 'otp1' },
      data: { attempts: 1 },
    });
  });

  it('invalidates the OTP after OTP_MAX_ATTEMPTS mismatches', async () => {
    const { service, prisma } = buildVerifiedService();
    const { scryptSync, randomBytes } = await import('node:crypto');
    const salt = randomBytes(16).toString('hex');
    const record = {
      id: 'otp2',
      phone: PHONE,
      codeHash: `${salt}:${scryptSync('999999', salt, 32).toString('hex')}`,
      attempts: 4, // one more failure hits max (5)
    };
    (prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(record);

    await expect(service.assertConsumable(PHONE, '123456')).rejects.toThrow(HttpException);
    expect(prisma.otpCode.update).toHaveBeenCalledWith({
      where: { id: 'otp2' },
      data: { attempts: 5, consumedAt: expect.any(Date) },
    });
  });

  it('blocks verification when the attempt counter is already exhausted', async () => {
    const { service, prisma } = buildVerifiedService();
    (prisma.otpCode.findFirst as jest.Mock).mockResolvedValue({ id: 'otp3', attempts: 5 });
    await expect(service.assertConsumable(PHONE, '123456')).rejects.toThrow(/بیش از حد مجاز/);
    expect(prisma.otpCode.update).not.toHaveBeenCalled();
  });

  it('rejects when there is no unconsumed, unexpired OTP for the phone', async () => {
    const { service, prisma } = buildVerifiedService();
    (prisma.otpCode.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.assertConsumable(PHONE, '123456')).rejects.toThrow(/منقضی شده/);
  });
});
