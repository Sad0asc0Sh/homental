import { BadRequestException, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { AuthenticatedUser } from '@common/types/authenticated-user';
import { PrismaService } from '@infra/prisma/prisma.service';
import { OtpService } from './otp.service';
import type { OtpRequestResult } from './otp.service';
import { TokensService } from './tokens.service';
import type { TokenPair } from './tokens.service';

export interface AuthSession extends TokenPair {
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  role: User['role'];
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly otpService: OtpService,
    private readonly tokensService: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  requestOtp(phone: string): Promise<OtpRequestResult> {
    return this.otpService.request(phone);
  }

  /**
   * Verifies the OTP, then — in ONE transaction — consumes the code and
   * provisions the user: new users become role=CUSTOMER / status=ACTIVE and
   * automatically receive a CustomerProfile + CUSTOMER Wallet.
   */
  async verifyOtp(phone: string, code: string, deviceInfo?: string, ip?: string): Promise<AuthSession> {
    const otp = await this.otpService.assertConsumable(phone, code);

    const user = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.user.upsert({
        where: { phone },
        update: {},
        create: { phone, role: 'CUSTOMER', status: 'ACTIVE' },
      });
      await tx.customerProfile.upsert({
        where: { userId: upserted.id },
        update: {},
        create: { userId: upserted.id },
      });
      await tx.wallet.upsert({
        where: { ownerType_ownerId: { ownerType: 'CUSTOMER', ownerId: upserted.id } },
        update: {},
        create: { ownerType: 'CUSTOMER', ownerId: upserted.id },
      });
      await this.otpService.consumeInTransaction(tx, otp.id);
      return upserted;
    });

    return { ...(await this.tokensService.issueTokenPair(user, deviceInfo, ip)), user: toPublicUser(user) };
  }

  async refresh(refreshToken: string, ip?: string, deviceInfo?: string): Promise<TokenPair> {
    const result = await this.tokensService.rotate(refreshToken, ip, deviceInfo);
    return { accessToken: result.accessToken, refreshToken: result.refreshToken };
  }

  async logout(userId: string, refreshToken: string): Promise<{ revoked: boolean }> {
    const revoked = await this.tokensService.revokeByToken(userId, refreshToken);
    if (!revoked) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'نشست فعالی مرتبط با این توکن یافت نشد.',
      });
    }
    return { revoked: true };
  }

  async logoutAll(userId: string): Promise<{ revoked: true }> {
    await this.tokensService.revokeAllForUser(userId);
    return { revoked: true };
  }

  async me(user: AuthenticatedUser): Promise<PublicUser & { status: User['status']; branchId: string | null }> {
    const full = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });
    if (!full) {
      throw new BadRequestException({ statusCode: 400, message: 'کاربر یافت نشد.' });
    }
    return { ...full, branchId: user.branchId };
  }
}
