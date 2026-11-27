'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BadgeCheck, ClipboardList, ShieldCheck, Wallet } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';

const CUSTOMER_TABS = [
  { href: '/', labelFa: 'طراحی امنیت', Icon: ShieldCheck },
  { href: '/orders', labelFa: 'سفارش‌ها', Icon: ClipboardList },
  { href: '/warranties', labelFa: 'ضمانت', Icon: BadgeCheck },
  { href: '/wallet', labelFa: 'کیف پول', Icon: Wallet },
] as const;

export function CustomerBottomNav() {
  const pathname = usePathname();
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);

  if (pathname === '/offline') return null;
  if (hasHydrated && user && user.role !== 'CUSTOMER') return null;

  const isActive = (href: string) =>
    pathname === href || (href === '/orders' && pathname.startsWith('/order/'));

  return (
    <nav
      aria-label="منوی پایین هومنتال"
      className="safe-pb fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 backdrop-blur md:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-4">
        {CUSTOMER_TABS.map(({ href, labelFa, Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-bold transition-colors ${
                active ? 'text-primary-900' : 'text-slate-500 hover:text-primary-700'
              }`}
            >
              <span
                className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                  active ? 'bg-primary-50 text-primary-900' : ''
                }`}
              >
                <Icon size={18} />
              </span>
              <span className="truncate">{labelFa}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
