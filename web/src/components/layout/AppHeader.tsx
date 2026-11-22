'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, MapPin, ShieldCheck, Wallet, Wrench } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';

const ROLE_BADGES: Record<string, { labelFa: string; className: string }> = {
  CUSTOMER: { labelFa: 'مشتری', className: 'bg-emerald-50 text-emerald-700' },
  TECHNICIAN: { labelFa: 'نصاب', className: 'bg-sky-50 text-sky-700' },
  BRANCH_ADMIN: { labelFa: 'مدیر شعبه', className: 'bg-primary-50 text-primary-700' },
  SUPER_ADMIN: { labelFa: 'ابرادمین', className: 'bg-primary-900 text-white' },
};

const NAV_BY_ROLE: Record<string, Array<{ href: string; labelFa: string }>> = {
  guest: [
    { href: '/', labelFa: 'طراحی امنیت' },
    { href: '/brief', labelFa: 'کارنامه من' },
  ],
  CUSTOMER: [
    { href: '/', labelFa: 'طراحی امنیت' },
    { href: '/orders', labelFa: 'سفارش‌های من' },
    { href: '/warranties', labelFa: 'ضمانت دیجیتال' },
    { href: '/wallet', labelFa: 'کیف پول' },
  ],
  TECHNICIAN: [{ href: '/technician', labelFa: 'پنل نصاب' }],
  BRANCH_ADMIN: [{ href: '/branch', labelFa: 'پنل مدیریت شعبه' }],
  SUPER_ADMIN: [
    { href: '/branch', labelFa: 'پنل مدیریت شعبه' },
    { href: '/orders', labelFa: 'همه سفارش‌ها' },
  ],
};

export function AppHeader() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const role = user?.role ?? 'guest';
  const nav = NAV_BY_ROLE[role] ?? NAV_BY_ROLE['guest'];
  const badge = ROLE_BADGES[role];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/95 backdrop-blur">
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
          {nav.map((item) => {
            const active = pathname === item.href;
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
          {badge ? (
            <span className={`chip text-xs font-bold ${badge.className}`}>{badge.labelFa}</span>
          ) : null}
          {user ? (
            <button
              type="button"
              onClick={logout}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-red-200 hover:text-red-600"
            >
              <LogOut size={13} />
              خروج
            </button>
          ) : (
            <Link href="/brief" className="btn-ghost !px-3 !py-1.5 text-xs">
              ورود
            </Link>
          )}
        </div>
      </div>
      {/* Mobile nav strip */}
      <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-1.5 md:hidden">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold ${
              pathname === item.href ? 'bg-primary-50 text-primary-800' : 'text-slate-600'
            }`}
          >
            {item.labelFa}
          </Link>
        ))}
        {role === 'CUSTOMER' ? (
          <Link
            href="/wallet"
            className="flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold text-slate-600"
          >
            <Wallet size={13} />
            کیف پول
          </Link>
        ) : null}
        {role === 'TECHNICIAN' ? (
          <span className="flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs text-slate-400">
            <Wrench size={13} />
            ابزار نصب
          </span>
        ) : null}
        {role === 'BRANCH_ADMIN' ? (
          <span className="flex items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs text-slate-400">
            <MapPin size={13} />
            مشهد
          </span>
        ) : null}
      </nav>
    </header>
  );
}
