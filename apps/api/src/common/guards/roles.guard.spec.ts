import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedRequest } from '../types/authenticated-user';

function createContext(user: unknown): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const request = { user } as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows any authenticated caller when no @Roles metadata is present', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const { context } = createContext({ id: 'u1', role: UserRole.CUSTOMER });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows when the user role is in the required roles', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN]);
    const { context } = createContext({ id: 'a1', role: UserRole.BRANCH_ADMIN });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects unauthenticated requests with 401 Persian message', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SUPER_ADMIN]);
    const { context } = createContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
    try {
      guard.canActivate(context);
    } catch (error) {
      const body = (error as UnauthorizedException).getResponse() as Record<string, unknown>;
      expect(body['message']).toContain('وارد');
    }
  });

  it('rejects a CUSTOMER hitting an admin endpoint with 403 Persian message', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.SUPER_ADMIN, UserRole.BRANCH_ADMIN]);
    const { context } = createContext({ id: 'c1', role: UserRole.CUSTOMER });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    try {
      guard.canActivate(context);
    } catch (error) {
      const body = (error as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(body['message']).toContain('دسترسی ندارید');
    }
  });
});
