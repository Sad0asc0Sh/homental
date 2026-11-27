import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AppConfigService } from '@config/app-config.service';
import { parseDurationToMs } from '@common/utils/duration.util';
import { PrismaService } from '@infra/prisma/prisma.service';
import type { AccessJwtPayload, RefreshJwtPayload } from './auth.jwt-payload';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface RotationResult extends TokenPair {
  user: User;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * JWT access/refresh issuing with STRICT refresh-token rotation:
 *  - Access: signed with JWT_ACCESS_SECRET, TTL jwtAccessTtl.
 *  - Refresh: a JWT signed with JWT_REFRESH_SECRET whose `jti` matches a
 *    RefreshSession row; only the SHA-256 hash of the token is stored.
 *  - Rotation: every refresh revokes the used session and issues a new pair.
 *  - Reuse detection: replaying a revoked/unknown-against-session token
 *    revokes ALL active sessions of that user immediately (session theft).
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async issueTokenPair(user: User, deviceInfo?: string, ip?: string): Promise<TokenPair> {
    const sessionId = randomUUID();
    const refreshToken = await this.signRefreshToken(user.id, sessionId);
    await this.prisma.refreshSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: sha256(refreshToken),
        deviceInfo,
        ip,
        expiresAt: new Date(Date.now() + parseDurationToMs(this.config.jwtRefreshTtl)),
      },
    });
    return { accessToken: await this.signAccessToken(user), refreshToken };
  }

  async rotate(refreshToken: string, ip?: string, deviceInfo?: string): Promise<RotationResult> {
    let payload: RefreshJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshJwtPayload>(refreshToken, {
        secret: this.config.jwtRefreshSecret,
      });
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'توکن تمدید نامعتبر یا منقضی شده است.',
      });
    }

    const tokenHash = sha256(refreshToken);
    const session = payload.jti
      ? await this.prisma.refreshSession.findUnique({
          where: { id: payload.jti },
          include: { user: true },
        })
      : null;

    if (!session || session.tokenHash !== tokenHash || session.userId !== payload.sub) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'توکن تمدید نامعتبر است؛ لطفاً دوباره وارد شوید.',
      });
    }

    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      // REUSE DETECTION: a revoked/expired refresh token is being replayed.
      // Treat as session theft — revoke everything for this user, right now.
      await this.revokeAllForUser(session.userId);
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'به دلیل استفاده مجدد از توکن تمدید، همه نشست‌های شما باطل شد؛ لطفاً دوباره وارد شوید.',
      });
    }

    // Part A hotfix #2: suspended/deactivated users can never rotate tokens.
    if (session.user.status !== 'ACTIVE') {
      await this.revokeAllForUser(session.userId);
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'حساب کاربری شما فعال نیست؛ تمام نشست‌های شما باطل شد.',
      });
    }

    const newSessionId = randomUUID();
    const newRefreshToken = await this.signRefreshToken(session.userId, newSessionId);
    await this.prisma.$transaction([
      this.prisma.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.refreshSession.create({
        data: {
          id: newSessionId,
          userId: session.userId,
          tokenHash: sha256(newRefreshToken),
          deviceInfo,
          ip,
          expiresAt: new Date(Date.now() + parseDurationToMs(this.config.jwtRefreshTtl)),
        },
      }),
    ]);

    return {
      accessToken: await this.signAccessToken(session.user),
      refreshToken: newRefreshToken,
      user: session.user,
    };
  }

  async revokeByToken(userId: string, refreshToken: string): Promise<boolean> {
    const session = await this.prisma.refreshSession.findFirst({
      where: { tokenHash: sha256(refreshToken), userId, revokedAt: null },
    });
    if (!session) return false;
    await this.prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return true;
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** `jsonwebtoken` v9 types TTLs as `number | StringValue` — env strings are valid values. */
  private ttl(value: string): JwtSignOptions['expiresIn'] {
    return value as JwtSignOptions['expiresIn'];
  }

  private async signAccessToken(user: User): Promise<string> {
    const payload: AccessJwtPayload = { sub: user.id, phone: user.phone, role: user.role };
    return this.jwtService.signAsync(payload, {
      secret: this.config.jwtAccessSecret,
      expiresIn: this.ttl(this.config.jwtAccessTtl),
    });
  }

  private signRefreshToken(userId: string, sessionId: string): Promise<string> {
    const payload: RefreshJwtPayload = { sub: userId, type: 'refresh' };
    return this.jwtService.signAsync(payload, {
      secret: this.config.jwtRefreshSecret,
      expiresIn: this.ttl(this.config.jwtRefreshTtl),
      jwtid: sessionId,
    });
  }
}
