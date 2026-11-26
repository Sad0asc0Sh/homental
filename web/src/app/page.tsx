'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, MapPin, ShieldCheck, Zap } from 'lucide-react';
import { LocationCards, PillarsShowcase } from '@/components/catalog/catalog-parts';
import { useAdvisorStore } from '@/store/advisor.store';
import { useAuthStore } from '@/store/auth.store';
import type { LocationType } from '@/lib/types';

export default function HomePage() {
  const router = useRouter();
  const catalog = useAdvisorStore((s) => s.catalog);
  const isLoadingCatalog = useAdvisorStore((s) => s.isLoadingCatalog);
  const evaluateError = useAdvisorStore((s) => s.evaluateError);
  const loadCatalog = useAdvisorStore((s) => s.loadCatalog);
  const reset = useAdvisorStore((s) => s.reset);
  const user = useAuthStore((s) => s.user);

  // Load the unfiltered 3-pillar canvas for the showcase.
  // NOTE: no reset() on unmount — client-side navigation must keep the store
  // (a full wipe here destroyed the preset before /configure could render it).
  useEffect(() => {
    void loadCatalog(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Client-side navigation (router.push) — a full page reload here wiped the
  // entire Zustand store (preset, locationType) before /configure could read it.
  const selectLocation = (location: LocationType) => {
    void loadCatalog(location, true).then(() => {
      router.push('/configure');
    });
  };

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-6">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-900 text-white">
            <ShieldCheck size={22} />
          </span>
          <div>
            <h1 className="text-lg font-extrabold text-primary-950">هومنتال</h1>
            <p className="text-xs text-slate-500">مشاور و طراح هوشمند امنیت</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip bg-emerald-50 text-emerald-700">
            <MapPin size={14} />
            پایلوت مشهد
          </span>
          <Link href="/brief" className="btn-ghost">
            {user ? 'حساب من' : 'ورود / ثبت‌نام'}
          </Link>
        </div>
      </header>

      <section className="mb-10">
        <div className="mb-1 flex items-center gap-2">
          <span className="chip bg-primary-900 text-white">
            <Zap size={14} />
            مسیر پیشنهادی
          </span>
          <h2 className="text-xl font-extrabold text-slate-800">
            چه مکانی را می‌خواهید امن کنید؟
          </h2>
        </div>
        <p className="mb-4 text-sm leading-6 text-slate-500">
          مکان را انتخاب کنید؛ هومنتال به‌صورت خودکار پیکربندی پیشنهادی مهندسی‌شده را آماده می‌کند و
          شما می‌توانید همه‌چیز را آزادانه تغییر دهید.
        </p>
        <LocationCards onSelect={selectLocation} />
      </section>

      <section className="mb-10">
        <button
          type="button"
          onClick={() => {
            reset();
            void loadCatalog(null, false).then(() => {
              router.push('/configure');
            });
          }}
          disabled={isLoadingCatalog}
          className="btn-ghost w-full justify-between sm:w-auto sm:min-w-96"
        >
          <span className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-primary-600" />
            خودم دقیق می‌دانم چه می‌خواهم — نمایش ۳ رکن مهندسی امنیت
          </span>
          <ArrowLeft size={16} />
        </button>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-extrabold text-slate-800">
          ۳ رکن مهندسی امنیت هومنتال
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          ترکیب این سه رکن، کارنامه امنیتی شما را می‌سازد:
        </p>
        {evaluateError && !catalog ? (
          <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-sm font-bold leading-6 text-red-600">
            {evaluateError}
            <span className="mt-2 block font-normal text-slate-600">
              مطمئن شو بک‌اند روی http://localhost:3000 در حال اجراست و صفحه را با
              http://localhost:3001 باز کن (نه 127.0.0.1) — بعد دکمه تلاش مجدد را بزن.
            </span>
            <button
              type="button"
              onClick={() => void loadCatalog(null, false)}
              className="btn-primary mt-3"
            >
              تلاش مجدد
            </button>
          </div>
        ) : (
          <PillarsShowcase catalog={catalog} />
        )}
      </section>

      <footer className="mt-12 rounded-2xl bg-primary-950 p-5 text-white">
        <p className="text-sm font-bold">تعهد ۳گانه هومنتال</p>
        <p className="mt-1 text-xs leading-6 text-primary-200">
          سخت‌افزار اصل و ماتریکس‌دار + نصب استاندارد توسط تکنسین احراز‌شده + تعهدنامه حریم خصوصی و
          تغییر رمزهای پیش‌فرض پیش از تحویل.
        </p>
      </footer>

      <Link
        href="/configure"
        className="btn-primary mt-8 w-full"
      >
        <ArrowLeft size={18} />
        ورود به اتاق طراحی امنیت
      </Link>
    </main>
  );
}
