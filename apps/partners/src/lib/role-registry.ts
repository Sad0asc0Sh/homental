import { ROLE_METADATA, isPartnerRole, type PartnerRole } from '@homental/shared';

export type PartnerNavIconKey =
  | 'dispatch'
  | 'supply'
  | 'wallet'
  | 'store'
  | 'branch'
  | 'admin';

export interface PartnerNavItem {
  href: string;
  labelFa: string;
  mobileLabelFa: string;
  iconKey: PartnerNavIconKey;
}

export interface PartnerRoleConfig {
  role: PartnerRole;
  labelFa: string;
  descriptionFa: string;
  badgeClassName: string;
  defaultRoute: string;
  allowedPrefixes: readonly string[];
  navItems: readonly PartnerNavItem[];
}

/**
 * Extensible role-driven shell configuration for «هومنتال همکاران».
 * Future partner/staff roles (e.g. COURIER, INSPECTOR) can be registered here
 * alongside their `@homental/shared` role metadata in one place.
 */
export const PARTNER_ROLE_REGISTRY: Record<PartnerRole, PartnerRoleConfig> = {
  TECHNICIAN: {
    role: 'TECHNICIAN',
    labelFa: ROLE_METADATA.TECHNICIAN.labelFa,
    descriptionFa: 'اعزام‌های زنده، اجرای پروژه، متراژ و فروشگاه تأمین کالا',
    badgeClassName: ROLE_METADATA.TECHNICIAN.badgeClassName,
    defaultRoute: '/technician',
    allowedPrefixes: ['/technician', '/wallet'],
    navItems: [
      {
        href: '/technician',
        labelFa: 'پنل نصاب',
        mobileLabelFa: 'اعزام',
        iconKey: 'dispatch',
      },
      {
        href: '/technician/supply',
        labelFa: 'تأمین کالا و خدمات همکار',
        mobileLabelFa: 'تأمین کالا',
        iconKey: 'supply',
      },
      {
        href: '/wallet',
        labelFa: 'کیف پول',
        mobileLabelFa: 'کیف پول',
        iconKey: 'wallet',
      },
    ],
  },
  SELLER: {
    role: 'SELLER',
    labelFa: ROLE_METADATA.SELLER.labelFa,
    descriptionFa: 'کاتالوگ قیمت همکار، موجودی، سفارش‌های ارسالی و خدمات پس از فروش',
    badgeClassName: ROLE_METADATA.SELLER.badgeClassName,
    defaultRoute: '/seller',
    allowedPrefixes: ['/seller', '/wallet'],
    navItems: [
      {
        href: '/seller',
        labelFa: 'پنل فروشنده',
        mobileLabelFa: 'پنل فروشنده',
        iconKey: 'store',
      },
      {
        href: '/wallet',
        labelFa: 'کیف پول',
        mobileLabelFa: 'کیف پول',
        iconKey: 'wallet',
      },
    ],
  },
  BRANCH_ADMIN: {
    role: 'BRANCH_ADMIN',
    labelFa: ROLE_METADATA.BRANCH_ADMIN.labelFa,
    descriptionFa: 'مدیریت صف سفارش‌های شعبه، تکنسین‌ها و تیکت‌های ضمانت',
    badgeClassName: ROLE_METADATA.BRANCH_ADMIN.badgeClassName,
    defaultRoute: '/branch',
    allowedPrefixes: ['/branch', '/wallet'],
    navItems: [
      {
        href: '/branch',
        labelFa: 'پنل مدیریت شعبه',
        mobileLabelFa: 'مدیریت شعبه',
        iconKey: 'branch',
      },
    ],
  },
  SUPER_ADMIN: {
    role: 'SUPER_ADMIN',
    labelFa: ROLE_METADATA.SUPER_ADMIN.labelFa,
    descriptionFa: 'داشبورد مالی و صندوق ۵٪ ضمانت، توسعه شهرها و تنظیمات پلتفرم',
    badgeClassName: ROLE_METADATA.SUPER_ADMIN.badgeClassName,
    defaultRoute: '/admin',
    allowedPrefixes: ['/admin', '/branch'],
    navItems: [
      {
        href: '/admin',
        labelFa: 'پنل مدیریت کل',
        mobileLabelFa: 'مدیریت کل',
        iconKey: 'admin',
      },
      {
        href: '/branch',
        labelFa: 'پنل مدیریت شعبه',
        mobileLabelFa: 'مدیریت شعبه',
        iconKey: 'branch',
      },
    ],
  },
};

export function getPartnerRoleConfig(role: string | null | undefined): PartnerRoleConfig | null {
  return isPartnerRole(role) ? PARTNER_ROLE_REGISTRY[role] : null;
}

export function isRouteAllowedForPartnerRole(
  role: string | null | undefined,
  pathname: string,
): boolean {
  const config = getPartnerRoleConfig(role);
  if (!config) return false;
  if (pathname === '/') return true;
  return config.allowedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
