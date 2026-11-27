import { HttpException } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { PrismaService } from '@infra/prisma/prisma.service';
import { AuthService } from './auth.service';
import type { OtpService } from './otp.service';
import type { TokensService } from './tokens.service';

const PHONE = '+989120000020';
const fakeUser = {
  id: 'u1',
  phone: PHONE,
  firstName: null,
  lastName: null,
  avatarUrl: null,
  role: 'CUSTOMER',
  status: 'ACTIVE',
  lastSeenAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
} as User;

interface TxMock {
  user: { upsert: jest.Mock; findUnique: jest.Mock };
  customerProfile: { upsert: jest.Mock };
  wallet: { upsert: jest.Mock };
  otpCode: { update: jest.Mock };
}

function buildService() {
  const otpService = {
    request: jest.fn().mockResolvedValue({ sent: true }),
    assertConsumable: jest.fn().mockResolvedValue({ id: 'otp1' }),
    consumeInTransaction: jest.fn().mockResolvedValue(undefined),
  } as unknown as OtpService;
  const tokensService = {
    issueTokenPair: jest
      .fn()
      .mockResolvedValue({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
  } as unknown as TokensService;

  const tx: TxMock = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null), // new user by default
      upsert: jest.fn().mockResolvedValue(fakeUser),
    },
    customerProfile: { upsert: jest.fn().mockResolvedValue({}) },
    wallet: { upsert: jest.fn().mockResolvedValue({}) },
    otpCode: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (tx: TxMock) => Promise<User>) => fn(tx)),
  } as unknown as PrismaService;

  const service = new AuthService(otpService, tokensService, prisma);
  return { service, otpService, tokensService, prisma, tx };
}

describe('AuthService.verifyOtp — atomic provisioning (Part B #3)', () => {
  it('upserts the user as ACTIVE CUSTOMER with CustomerProfile + CUSTOMER wallet, consumes OTP, issues tokens', async () => {
    const { service, otpService, tokensService, tx } = buildService();

    const result = await service.verifyOtp(PHONE, '123456', 'Pixel 8', '127.0.0.1');

    expect(tx.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { phone: PHONE },
        create: expect.objectContaining({ role: 'CUSTOMER', status: 'ACTIVE' }),
      }),
    );
    expect(tx.customerProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      update: {},
      create: { userId: 'u1' },
    });
    expect(tx.wallet.upsert).toHaveBeenCalledWith({
      where: { ownerType_ownerId: { ownerType: 'CUSTOMER', ownerId: 'u1' } },
      update: {},
      create: { ownerType: 'CUSTOMER', ownerId: 'u1' },
    });
    // OTP consumption runs INSIDE the same transaction (atomic gate)
    expect(otpService.consumeInTransaction).toHaveBeenCalledWith(tx, 'otp1');
    expect(tokensService.issueTokenPair).toHaveBeenCalledWith(fakeUser, 'Pixel 8', '127.0.0.1');

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(result.user).toEqual({
      id: 'u1',
      phone: PHONE,
      firstName: null,
      lastName: null,
      role: 'CUSTOMER',
    });
  });

  it('does not provision anything when the OTP is not consumable', async () => {
    const { service, otpService, tx } = buildService();
    (otpService.assertConsumable as jest.Mock).mockRejectedValue(
      new HttpException({ statusCode: 400, message: 'کد واردشده نادرست است.' }, 400),
    );

    await expect(service.verifyOtp(PHONE, '000000')).rejects.toThrow(HttpException);
    expect(tx.user.upsert).not.toHaveBeenCalled();
    expect(tx.wallet.upsert).not.toHaveBeenCalled();
  });

  it('delegates requestOtp to OtpService with the normalized phone', async () => {
    const { service, otpService } = buildService();
    (otpService.request as jest.Mock).mockResolvedValue({ sent: true });
    await expect(service.requestOtp(PHONE)).resolves.toEqual({ sent: true });
    expect(otpService.request).toHaveBeenCalledWith(PHONE);
  });

  // ── Part A hotfix #2: suspended/deactivated users can never log in ─────────

  it.each(['SUSPENDED', 'DEACTIVATED'] as const)(
    'blocks a %s user at verify with 403 and issues NO tokens',
    async (status) => {
      const { service, tx, tokensService } = buildService();
      (tx.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', status });

      await expect(service.verifyOtp(PHONE, '123456')).rejects.toThrow(/مسدود یا غیرفعال/);
      expect(tx.user.upsert).not.toHaveBeenCalled();
      expect(tokensService.issueTokenPair).not.toHaveBeenCalled();
    },
  );

  it('activates a PENDING_VERIFICATION user on successful verify', async () => {
    const { service, tx } = buildService();
    (tx.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1',
      phone: PHONE,
      status: 'PENDING_VERIFICATION',
    });

    await service.verifyOtp(PHONE, '123456');
    expect(tx.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { status: 'ACTIVE' } }),
    );
  });
});
