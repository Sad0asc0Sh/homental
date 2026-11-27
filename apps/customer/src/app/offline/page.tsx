'use client';

import Link from 'next/link';
import { RefreshCw, WifiOff } from 'lucide-react';

export default function CustomerOfflinePage() {
  return (
    <main className="mx-auto max-w-md px-4 py-12 text-center">
      <section className="card space-y-4">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <WifiOff size={28} />
        </span>
        <div className="space-y-2">
          <h1 className="text-lg font-extrabold text-primary-950">ارتباط با اینترنت قطع است</h1>
          <p className="text-sm leading-6 text-slate-600">
            برای مشاهده قیمت‌های زنده، پیگیری سفارش و اطلاعات کیف پول هومنتال به اتصال اینترنت
            نیاز دارید.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn-primary w-full"
          >
            <RefreshCw size={16} />
            تلاش مجدد
          </button>
          <Link href="/" className="btn-ghost w-full">
            بازگشت به صفحه اصلی
          </Link>
        </div>
      </section>
    </main>
  );
}
