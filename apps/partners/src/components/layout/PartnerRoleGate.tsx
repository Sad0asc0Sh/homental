'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, ExternalLink, Loader2, LogIn, LogOut, ShieldAlert } from 'lucide-react';
import { AuthModal } from '@/components/auth/AuthModal';
import { getPartnerRoleConfig, isRouteAllowedForPartnerRole } from '@/lib/role-registry';
import { useAuthStore } from '@/store/auth.store';

const CUSTOMER_URL = process.env.NEXT_PUBLIC_CUSTOMER_URL || 'http://localhost:3001';

/**
 * Strict partner portal role gate:
 * - Blocks CUSTOMER sessions across all routes and redirects them to the customer app.
 * - Enforces per-role route prefixes so TECHNICIAN, SELLER, BRANCH_ADMIN, and SUPER_ADMIN
 *   cannot access workspaces belonging to other roles.
 */
export function PartnerRoleGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [authOpen, setAuthOpen] = useState(false);

  if (pathname === '/offline') {
    return <>{children}</>;
  }

  if (!hasHydrated) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10">
        <div className="card flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="animate-spin" size={24} />
        </div>
      </main>
    );
  }

  if (user?.role === 'CUSTOMER') {
    return (
      <main className="mx-auto max-w-lg px-4 pt-12 text-center">
        <section className="card space-y-4">
          <ShieldAlert size={32} className="mx-auto text-amber-600" />
          <div className="space-y-2">
            <h1 className="text-lg font-extrabold text-primary-950">
              دسترسی ویژه همکاران و مدیران هومنتال
            </h1>
            <p className="text-sm leading-6 text-slate-600">
              این سامانه برای نصاب‌ها، فروشندگان و مدیران هومنتال طراحی شده است. برای ثبت سفارش،
              مشاهده ضمانت دیجیتال و پیگیری پرونده امنیتی به سامانه مشتریان هومنتال بروید.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <a href={CUSTOMER_URL} className="btn-primary text-sm">
              <ExternalLink size={16} />
              ورود به سامانه مشتریان هومنتال
            </a>
            <button
              type="button"
              onClick={logout}
              className="btn-ghost text-sm text-red-600 hover:border-red-200 hover:text-red-700"
            >
              <LogOut size={15} />
              خروج از حساب مشتری
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (user) {
    const config = getPartnerRoleConfig(user.role);
    if (!config) {
      return (
        <main className="mx-auto max-w-lg px-4 pt-12 text-center">
          <section className="card space-y-4">
            <ShieldAlert size={30} className="mx-auto text-red-500" />
            <p className="text-sm font-bold text-red-600">
              نقش حساب شما مجوز دسترسی به سامانه همکاران را ندارد.
            </p>
            <button type="button" onClick={logout} className="btn-ghost mx-auto text-xs">
              <LogOut size={14} />
              خروج از حساب
            </button>
          </section>
        </main>
      );
    }

    if (!isRouteAllowedForPartnerRole(user.role, pathname)) {
      return (
        <main className="mx-auto max-w-lg px-4 pt-12 text-center">
          <section className="card space-y-4">
            <ShieldAlert size={30} className="mx-auto text-red-500" />
            <div className="space-y-1.5">
              <h1 className="text-base font-extrabold text-slate-800">
                عدم دسترسی به این بخش
              </h1>
              <p className="text-sm leading-6 text-slate-600">
                حساب شما با نقش <span className="font-extrabold text-primary-800">{config.labelFa}</span>{' '}
                مجاز به مشاهده این مسیر نیست.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link href={config.defaultRoute} className="btn-primary text-sm">
                <ArrowRight size={15} />
                رفتن به {config.navItems[0]?.labelFa ?? 'پنل کاربری'}
              </Link>
              <button type="button" onClick={logout} className="btn-ghost text-sm">
                <LogOut size={14} />
                خروج و تغییر حساب
              </button>
            </div>
          </section>
        </main>
      );
    }

    return <>{children}</>;
  }

  if (pathname !== '/') {
    return (
      <main className="mx-auto max-w-lg px-4 pt-12 text-center">
        <section className="card space-y-4">
          <h1 className="text-base font-extrabold text-primary-950">ورود به هومنتال همکاران</h1>
          <p className="text-xs leading-6 text-slate-500">
            برای دسترسی به این بخش، با شماره موبایل همکار یا مدیر وارد شوید.
          </p>
          <button type="button" onClick={() => setAuthOpen(true)} className="btn-primary mx-auto text-sm">
            <LogIn size={16} />
            ورود با شماره موبایل
          </button>
        </section>
        {authOpen ? <AuthModal onDone={() => setAuthOpen(false)} /> : null}
      </main>
    );
  }

  return <>{children}</>;
}
