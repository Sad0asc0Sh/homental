'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { getRoleMetadata } from '@homental/shared';
import { AuthModal } from '@/components/brief/AuthModal';
import { useAuthStore } from '@/store/auth.store';

const CUSTOMER_NAV: Array<{ href: string; labelFa: string }> = [
  { href: '/', labelFa: 'طراحی امنیت' },
  { href: '/orders', labelFa: 'سفارش‌های من' },
  { href: '/warranties', labelFa: 'ضمانت دیجیتال' },
  { href: '/properties', labelFa: 'املاک من' },
  { href: '/wallet', labelFa: 'کیف پول' },
];

export function CustomerHeader() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [authOpen, setAuthOpen] = useState(false);

  // Bulletproof hydration flag: zustand v4's onRehydrateStorage callback can
  // be skipped when localStorage is empty (first visit), which left
  // hasHydrated false forever and froze every authed page on its spinner.
  // Flipping it after the first client mount guarantees progress everywhere.
  useEffect(() => {
    useAuthStore.getState().setHasHydrated();
  }, []);

  const badge = getRoleMetadata(user?.role);

  const isActive = (href: string) =>
    pathname === href || (href === '/orders' && pathname.startsWith('/order/'));

  return (
    <>
      <header className="safe-pt sticky top-0 z-40 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-900 text-white">
              <ShieldCheck size={20} />
            </span>
            <span>
              <span className="block text-base font-extrabold text-primary-950">هومنتال</span>
              <span className="hidden text-[10px] text-slate-500 sm:block">مشاور و طراح هوشمند امنیت</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {CUSTOMER_NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
                    active ? 'bg-primary-50 text-primary-800' : 'text-slate-600 hover:text-primary-700'
                  }`}
                >
                  {item.labelFa}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href="/properties"
              aria-label="املاک و مکان‌های من"
              className="flex min-h-[40px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:border-primary-300 hover:text-primary-700 md:hidden"
            >
              <Building2 size={14} />
              <span>املاک</span>
            </Link>
            {badge ? (
              <span className={`chip text-xs font-bold ${badge.badgeClassName}`}>{badge.labelFa}</span>
            ) : null}
            {user ? (
              <button
                type="button"
                onClick={logout}
                className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-red-200 hover:text-red-600"
              >
                <LogOut size={13} />
                خروج
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="btn-ghost !min-h-[40px] !px-3 !py-1.5 text-xs"
              >
                <LogIn size={13} />
                ورود
              </button>
            )}
          </div>
        </div>
      </header>
      {authOpen ? <AuthModal onDone={() => setAuthOpen(false)} /> : null}
    </>
  );
}
