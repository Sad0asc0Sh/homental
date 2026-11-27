'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Loader2, LogIn, ShieldCheck } from 'lucide-react';
import { AuthModal } from '@/components/auth/AuthModal';
import { getPartnerRoleConfig, PARTNER_ROLE_REGISTRY } from '@/lib/role-registry';
import { useAuthStore } from '@/store/auth.store';

const CUSTOMER_URL = process.env.NEXT_PUBLIC_CUSTOMER_URL || 'http://localhost:3001';

export default function PartnersLandingPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [authOpen, setAuthOpen] = useState(false);

  const roleConfig = getPartnerRoleConfig(user?.role);

  useEffect(() => {
    if (roleConfig) {
      router.replace(roleConfig.defaultRoute);
    }
  }, [roleConfig, router]);

  if (roleConfig) {
    return (
      <main className="mx-auto max-w-lg px-4 pt-12 text-center">
        <section className="card space-y-4">
          <Loader2 size={26} className="mx-auto animate-spin text-primary-700" />
          <p className="text-sm font-bold text-slate-700">
            در حال انتقال به پنل {roleConfig.labelFa}…
          </p>
          <Link href={roleConfig.defaultRoute} className="btn-primary mx-auto text-sm">
            ورود مستقیم به پنل
            <ArrowLeft size={16} />
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 pb-16 pt-8">
      <section className="card space-y-4 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-900 text-white">
          <ShieldCheck size={24} />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-xl font-extrabold text-primary-950">سامانه همکاران هومنتال</h1>
          <p className="text-sm text-slate-600">
            با شماره موبایل همکار یا مدیر وارد شوید تا به‌صورت خودکار به پنل نقش خود هدایت شوید.
          </p>
        </div>
        <button type="button" onClick={() => setAuthOpen(true)} className="btn-primary mx-auto">
          <LogIn size={16} />
          ورود با شماره موبایل (OTP)
        </button>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {Object.values(PARTNER_ROLE_REGISTRY).map((entry) => (
          <div key={entry.role} className="card space-y-2">
            <span className={`chip text-xs font-bold ${entry.badgeClassName}`}>{entry.labelFa}</span>
            <p className="text-xs leading-6 text-slate-600">{entry.descriptionFa}</p>
          </div>
        ))}
      </section>

      <footer className="text-center text-xs text-slate-500">
        مشتری هومنتال هستید؟{' '}
        <a
          href={CUSTOMER_URL}
          className="inline-flex items-center gap-1 font-bold text-primary-700 hover:underline"
        >
          ورود به سامانه مشتریان هومنتال
          <ExternalLink size={12} />
        </a>
      </footer>

      {authOpen ? <AuthModal onDone={() => setAuthOpen(false)} /> : null}
    </main>
  );
}
