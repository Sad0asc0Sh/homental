import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@prisma/client';
import { PrismaService } from '@infra/prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest, AuthenticatedUser } from '../types/authenticated-user';

export interface AccessJwtPayload {
  sub: string;
  phone: string;
  role: UserRole;
}

/**
 * Validates the Bearer access token, checks the user is ACTIVE and attaches
 * `request.user` (AuthenticatedUser incl. branchId for branch scoping).
 * Endpoints marked @Public() bypass this guard entirely.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.user = await this.authenticate(request);
    return true;
  }

  private async authenticate(request: AuthenticatedRequest): Promise<AuthenticatedUser> {
    const header = request.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'توکن احراز هویت ارسال نشده است.',
      });
    }
    const token = header.slice('Bearer '.length).trim();

    let payload: AccessJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessJwtPayload>(token);
    } catch {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'توکن احراز هویت نامعتبر یا منقضی شده است.',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'حساب کاربری شما فعال نیست.',
      });
    }

    return {
      id: user.id,
      phone: user.phone,
      role: user.role,
      branchId: await this.resolveBranchId(user.id, user.role),
    };
  }

  private async resolveBranchId(userId: string, role: UserRole): Promise<string | null> {
    if (role === 'TECHNICIAN') {
      const profile = await this.prisma.technicianProfile.findUnique({
        where: { userId },
        select: { branchId: true },
      });
      return profile?.branchId ?? null;
    }
    if (role === 'BRANCH_ADMIN') {
      const branch = await this.prisma.branch.findFirst({
        where: { adminId: userId },
        select: { id: true },
      });
      return branch?.id ?? null;
    }
    return null;
  }
}
