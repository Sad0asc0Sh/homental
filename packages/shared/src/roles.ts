export const USER_ROLES = [
  'CUSTOMER',
  'TECHNICIAN',
  'SELLER',
  'BRANCH_ADMIN',
  'SUPER_ADMIN',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const PARTNER_ROLES = [
  'TECHNICIAN',
  'SELLER',
  'BRANCH_ADMIN',
  'SUPER_ADMIN',
] as const;

export type PartnerRole = (typeof PARTNER_ROLES)[number];

export interface RoleMetadata {
  role: UserRole;
  labelFa: string;
  badgeClassName: string;
  isPartner: boolean;
}

export const ROLE_METADATA: Record<UserRole, RoleMetadata> = {
  CUSTOMER: {
    role: 'CUSTOMER',
    labelFa: 'مشتری',
    badgeClassName: 'bg-emerald-50 text-emerald-700',
    isPartner: false,
  },
  TECHNICIAN: {
    role: 'TECHNICIAN',
    labelFa: 'نصاب',
    badgeClassName: 'bg-sky-50 text-sky-700',
    isPartner: true,
  },
  SELLER: {
    role: 'SELLER',
    labelFa: 'فروشنده',
    badgeClassName: 'bg-amber-50 text-amber-800',
    isPartner: true,
  },
  BRANCH_ADMIN: {
    role: 'BRANCH_ADMIN',
    labelFa: 'مدیر شعبه',
    badgeClassName: 'bg-primary-50 text-primary-700',
    isPartner: true,
  },
  SUPER_ADMIN: {
    role: 'SUPER_ADMIN',
    labelFa: 'ابرادمین',
    badgeClassName: 'bg-primary-900 text-white',
    isPartner: true,
  },
};

export function isUserRole(role: string | null | undefined): role is UserRole {
  return Boolean(role && role in ROLE_METADATA);
}

export function isPartnerRole(role: string | null | undefined): role is PartnerRole {
  return isUserRole(role) && ROLE_METADATA[role].isPartner;
}

export function getRoleMetadata(role: string | null | undefined): RoleMetadata | null {
  return isUserRole(role) ? ROLE_METADATA[role] : null;
}
