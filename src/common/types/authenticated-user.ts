import type { UserRole } from '@prisma/client';
import type { Request } from 'express';

/** The verified identity attached to the request by JwtAuthGuard. */
export interface AuthenticatedUser {
  id: string;
  phone: string;
  role: UserRole;
  /** TECHNICIAN → TechnicianProfile.branchId, BRANCH_ADMIN → their Branch.id, else null. */
  branchId: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
