'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ExternalLink, LogOut, ShieldAlert } from 'lucide-react';
import { getRoleMetadata } from '@homental/shared';
import { useAuthStore } from '@/store/auth.store';

const PARTNERS_URL = process.env.NEXT_PUBLIC_PARTNERS_URL || 'http://localhost:3002';

/**
 * Customer app role gate: allows unauthenticated guests, `/offline`, and CUSTOMER role.
 * Non-customer partner/staff roles (TECHNICIAN, SELLER, BRANCH_ADMIN, SUPER_ADMIN)
 * are directed to «هومنتال همکاران» without exposing any partner/admin UI here.
 */
export function CustomerRoleGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  if (pathname === '/offline') {
    return <>{children}</>;
  }

  if (hasHydrated && user && user.role !== 'CUSTOMER') {
    const meta = getRoleMetadata(user.role);
    return (
      <main className="mx-auto max-w-lg px-4 pt-12 text-center">
        <section className="card space-y-4">
          <ShieldAlert size={32} className="mx-auto text-amber-600" />
          <div className="space-y-2">
            <h1 className="text-lg font-extrabold text-primary-950">
              این برنامه ویژه مشتریان هومنتال است
            </h1>
            <p className="text-sm leading-6 text-slate-600">
              شما با حساب{' '}
              <span className="font-extrabold text-primary-800">
                {meta?.labelFa ?? user.role}
              </span>{' '}
              وارد شده‌اید. برای دسترسی به پنل همکاران و مدیریت، به سامانه{' '}
              <span className="font-bold">هومنتال همکاران</span> بروید.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <a href={PARTNERS_URL} className="btn-primary text-sm">
              <ExternalLink size={16} />
              ورود به هومنتال همکاران
            </a>
            <button
              type="button"
              onClick={logout}
              className="btn-ghost text-sm text-red-600 hover:border-red-200 hover:text-red-700"
            >
              <LogOut size={15} />
              خروج از این حساب
            </button>
          </div>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
