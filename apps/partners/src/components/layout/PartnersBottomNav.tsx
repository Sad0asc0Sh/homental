'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  Package,
  Radio,
  ShieldCheck,
  Store,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import {
  getPartnerRoleConfig,
  type PartnerNavIconKey,
} from '@/lib/role-registry';
import { useAuthStore } from '@/store/auth.store';

const ICON_BY_KEY: Record<PartnerNavIconKey, LucideIcon> = {
  dispatch: Radio,
  supply: Package,
  wallet: Wallet,
  store: Store,
  branch: Building2,
  admin: ShieldCheck,
};

const GRID_COLS_BY_COUNT: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

export function PartnersBottomNav() {
  const pathname = usePathname();
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);

  const roleConfig = hasHydrated ? getPartnerRoleConfig(user?.role) : null;

  if (!roleConfig || roleConfig.navItems.length === 0 || pathname === '/offline') {
    return null;
  }

  const isActive = (href: string) => {
    if (href === '/technician') return pathname === '/technician';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const gridClass = GRID_COLS_BY_COUNT[roleConfig.navItems.length] ?? 'grid-cols-3';

  return (
    <nav
      aria-label="منوی پایین همکاران هومنتال"
      className="safe-pb fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 backdrop-blur md:hidden"
    >
      <div className={`mx-auto grid max-w-lg ${gridClass}`}>
        {roleConfig.navItems.map((item) => {
          const Icon = ICON_BY_KEY[item.iconKey];
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-bold transition-colors ${
                active ? 'text-emerald-900' : 'text-slate-500 hover:text-emerald-800'
              }`}
            >
              <span
                className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                  active ? 'bg-emerald-50 text-emerald-800' : ''
                }`}
              >
                <Icon size={18} />
              </span>
              <span className="truncate">{item.mobileLabelFa}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
