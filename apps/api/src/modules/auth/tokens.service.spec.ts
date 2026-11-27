import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { AppConfigService } from '@config/app-config.service';
import type { PrismaService } from '@infra/prisma/prisma.service';
import { TokensService } from './tokens.service';

const ACCESS_SECRET = 'unit-access-secret-0123456789abcdef';
const REFRESH_SECRET = 'unit-refresh-secret-0123456789abcdef';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const fakeUser = {
  id: 'u1',
  phone: '+989120000020',
  firstName: 'سارا',
  lastName: 'محمدی',
  avatarUrl: null,
  role: 'CUSTOMER',
  status: 'ACTIVE',
  lastSeenAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
} as User;

function buildService() {
  const jwtService = new JwtService({ secret: ACCESS_SECRET });
  const prisma = {
    refreshSession: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;
  const config = {
    jwtAccessSecret: ACCESS_SECRET,
    jwtRefreshSecret: REFRESH_SECRET,
    jwtAccessTtl: '15m',
    jwtRefreshTtl: '30d',
  } as unknown as AppConfigService;
  return {
    service: new TokensService(jwtService, prisma, config),
    jwtService,
    prisma,
  };
}

describe('TokensService — issueTokenPair', () => {
  it('stores only the SHA-256 hash of the refresh token and signs correct payloads', async () => {
    const { service, prisma, jwtService } = buildService();
    const result = await service.issueTokenPair(fakeUser, 'Pixel 8 / app', '127.0.0.1');

    const access = await jwtService.verifyAsync(result.accessToken);
    expect(access['sub']).toBe('u1');
    expect(access['role']).toBe('CUSTOMER');

    const refresh = await jwtService.verifyAsync(result.refreshToken, {
      secret: REFRESH_SECRET,
    });
    expect(refresh['sub']).toBe('u1');
    expect(refresh['type']).toBe('refresh');

    const createArgs = (prisma.refreshSession.create as jest.Mock).mock.calls[0][0] as {
      data: { tokenHash: string; deviceInfo?: string; ip?: string };
    };
    expect(createArgs.data.tokenHash).toBe(sha256(result.refreshToken));
    expect(createArgs.data.tokenHash).not.toContain(result.refreshToken);
    expect(createArgs.data.deviceInfo).toBe('Pixel 8 / app');
    expect(createArgs.data.ip).toBe('127.0.0.1');
  });
});

describe('TokensService — strict rotation (Part B #3)', () => {
  it('revokes the old session and issues a NEW pair with a new session id', async () => {
    const { service, prisma, jwtService } = buildService();
    const oldToken = await jwtService.signAsync(
      { sub: 'u1', type: 'refresh' },
      { secret: REFRESH_SECRET, jwtid: 's1', expiresIn: '30d' },
    );
    (prisma.refreshSession.findUnique as jest.Mock).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      tokenHash: sha256(oldToken),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1_000_000_000),
      user: fakeUser,
    });

    const result = await service.rotate(oldToken, '10.0.0.2');

    expect(prisma.refreshSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { revokedAt: expect.any(Date) },
    });
    const createArgs = (prisma.refreshSession.create as jest.Mock).mock.calls[0][0] as {
      data: { id: string; tokenHash: string };
    };
    expect(createArgs.data.id).not.toBe('s1');
    expect(createArgs.data.tokenHash).toBe(sha256(result.refreshToken));
    expect(result.refreshToken).not.toBe(oldToken);

    const newPayload = await jwtService.verifyAsync(result.refreshToken, {
      secret: REFRESH_SECRET,
    });
    expect(newPayload['jti']).toBe(createArgs.data.id);
  });

  it('REUSE DETECTION: replaying a revoked session revokes ALL sessions and returns 401', async () => {
    const { service, prisma, jwtService } = buildService();
    const stolenToken = await jwtService.signAsync(
      { sub: 'u1', type: 'refresh' },
      { secret: REFRESH_SECRET, jwtid: 's1', expiresIn: '30d' },
    );
    (prisma.refreshSession.findUnique as jest.Mock).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      tokenHash: sha256(stolenToken),
      revokedAt: new Date(), // already rotated/revoked → replay!
      expiresAt: new Date(Date.now() + 1_000_000_000),
      user: fakeUser,
    });

    await expect(service.rotate(stolenToken)).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects a token whose hash does not match the session (forged/foreign token)', async () => {
    const { service, prisma, jwtService } = buildService();
    const token = await jwtService.signAsync(
      { sub: 'u1', type: 'refresh' },
      { secret: REFRESH_SECRET, jwtid: 's1', expiresIn: '30d' },
    );
    (prisma.refreshSession.findUnique as jest.Mock).mockResolvedValue({
      id: 's1',
      userId: 'u1',
      tokenHash: sha256('a-different-token'),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1_000_000_000),
      user: fakeUser,
    });

    await expect(service.rotate(token)).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshSession.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an expired/garbage refresh token before any DB lookup', async () => {
    const { service, prisma } = buildService();
    await expect(service.rotate('not-a-jwt')).rejects.toThrow(UnauthorizedException);
    expect(prisma.refreshSession.findUnique).not.toHaveBeenCalled();
  });

  // ── Part A hotfix #2: suspended users can never rotate tokens ──────────────

  it.each(['SUSPENDED', 'DEACTIVATED'] as const)(
    'blocks rotation for a %s user: revokes ALL sessions and returns 401',
    async (status) => {
      const { service, prisma, jwtService } = buildService();
      const token = await jwtService.signAsync(
        { sub: 'u1', type: 'refresh' },
        { secret: REFRESH_SECRET, jwtid: 's1', expiresIn: '30d' },
      );
      (prisma.refreshSession.findUnique as jest.Mock).mockResolvedValue({
        id: 's1',
        userId: 'u1',
        tokenHash: sha256(token),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1_000_000_000),
        user: { ...fakeUser, status },
      });

      await expect(service.rotate(token)).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.refreshSession.update).not.toHaveBeenCalled(); // no rotation
    },
  );
});

describe('TokensService — logout helpers', () => {
  it('revokeByToken revokes the matching active session of the caller', async () => {
    const { service, prisma } = buildService();
    (prisma.refreshSession.findFirst as jest.Mock).mockResolvedValue({ id: 's9' });
    const result = await service.revokeByToken('u1', 'any-token');
    expect(result).toBe(true);
    expect(prisma.refreshSession.update).toHaveBeenCalledWith({
      where: { id: 's9' },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('revokeByToken returns false when no active session matches', async () => {
    const { service, prisma } = buildService();
    (prisma.refreshSession.findFirst as jest.Mock).mockResolvedValue(null);
    expect(await service.revokeByToken('u1', 'any-token')).toBe(false);
    expect(prisma.refreshSession.update).not.toHaveBeenCalled();
  });
});
