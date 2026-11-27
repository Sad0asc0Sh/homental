'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { AuthModal } from '@/components/auth/AuthModal';
import { ConnectionStatusPill } from '@/components/layout/ConnectionStatusPill';
import { getPartnerRoleConfig } from '@/lib/role-registry';
import { useAuthStore } from '@/store/auth.store';

export function PartnersHeader() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [authOpen, setAuthOpen] = useState(false);

  // Flip hydration flag after first client mount so empty localStorage never
  // leaves authed/gated views stuck on a loading spinner.
  useEffect(() => {
    useAuthStore.getState().setHasHydrated();
  }, []);

  const roleConfig = getPartnerRoleConfig(user?.role);
  const nav = roleConfig?.navItems ?? [];

  const isActive = (href: string) => {
    if (href === '/technician') return pathname === '/technician';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <>
      <header className="safe-pt sticky top-0 z-40 border-b border-slate-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
          <Link href={roleConfig?.defaultRoute ?? '/'} className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-900 text-amber-300">
              <ShieldCheck size={20} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-base font-extrabold text-primary-950">
                هومنتال همکاران
              </span>
              <span className="hidden text-[10px] text-slate-500 sm:block">
                پنل کارشناسان، فروشندگان و مدیریت
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
                    active
                      ? 'bg-emerald-50 text-emerald-900'
                      : 'text-slate-600 hover:text-emerald-800'
                  }`}
                >
                  {item.labelFa}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <ConnectionStatusPill />
            {roleConfig ? (
              <span className={`chip hidden text-xs font-bold sm:inline-flex ${roleConfig.badgeClassName}`}>
                {roleConfig.labelFa}
              </span>
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
                ورود همکار
              </button>
            )}
          </div>
        </div>
      </header>
      {authOpen ? <AuthModal onDone={() => setAuthOpen(false)} /> : null}
    </>
  );
}
