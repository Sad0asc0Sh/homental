import type { UserRole } from '@prisma/client';

export interface AccessJwtPayload {
  sub: string;
  phone: string;
  role: UserRole;
}

export interface RefreshJwtPayload {
  sub: string;
  type: 'refresh';
  /** Matches RefreshSession.id (set via the `jwtid` sign option). */
  jti?: string;
}
