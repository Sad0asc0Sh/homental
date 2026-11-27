import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser, AuthenticatedRequest } from '../types/authenticated-user';

/** Injects the AuthenticatedUser resolved by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
