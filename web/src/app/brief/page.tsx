'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { SmartBriefView } from '@/components/brief/SmartBriefView';
import { StickyLiveBar } from '@/components/advisor/StickyLiveBar';
import { useAdvisorStore } from '@/store/advisor.store';

export default function BriefPage() {
  const readiness = useAdvisorStore((s) => s.readiness);
  const evaluate = useAdvisorStore((s) => s.evaluate);
  const locationType = useAdvisorStore((s) => s.locationType);

  // Fresh evaluation on arrival (e.g. direct link / refresh).
  useEffect(() => {
    if (locationType) void evaluate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-44 pt-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-primary-950">کارنامه امنیتی و ثبت سفارش</h1>
          <p className="text-xs text-slate-500">خروجی مهندسی پیکربندی شما — آماده اعزام کارشناس</p>
        </div>
        <Link href="/configure" className="btn-ghost">
          بازگشت به پیکربندی
        </Link>
      </header>

      {!readiness ? (
        <div className="card text-center text-sm text-slate-500">
          کارنامه‌ای برای نمایش نیست — ابتدا از{' '}
          <Link href="/" className="font-bold text-primary-700">
            صفحه اصلی
          </Link>{' '}
          یک مکان انتخاب کنید.
        </div>
      ) : (
        <SmartBriefView />
      )}

      <StickyLiveBar ctaHref="/brief" />
    </main>
  );
}
