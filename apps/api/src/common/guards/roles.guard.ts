import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-user';

/**
 * Enforces @Roles(...). Endpoints without @Roles() are open to any
 * authenticated caller (JwtAuthGuard still applies).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'ابتدا وارد حساب خود شوید.',
      });
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'شما به این بخش دسترسی ندارید.',
      });
    }
    return true;
  }
}
