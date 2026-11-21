'use client';

import { use } from 'react';
import Link from 'next/link';
import { BadgeCheck, ShieldCheck } from 'lucide-react';
import { toPersianDigits } from '@/lib/format';
import { useAdvisorStore } from '@/store/advisor.store';

const STATE_STEPS: Array<{ state: string; labelFa: string }> = [
  { state: 'ESTIMATED', labelFa: 'قیمت‌گذاری‌شده' },
  { state: 'SEARCHING_EXPERT', labelFa: 'در جستجوی کارشناس' },
  { state: 'EXPERT_ASSIGNED', labelFa: 'کارشناس اختصاص یافت' },
  { state: 'ON_THE_WAY', labelFa: 'کارشناس در مسیر' },
  { state: 'INSPECTING', labelFa: 'بازدید و کارشناسی' },
  { state: 'QUOTE_APPROVED', labelFa: 'پیش‌فاکتور تأیید شد' },
  { state: 'IN_PROGRESS', labelFa: 'در حال اجرا' },
  { state: 'HANDOVER_OTP_PENDING', labelFa: 'در انتظار تحویل' },
  { state: 'COMPLETED_WARRANTY_ACTIVE', labelFa: 'گارانتی فعال' },
];

export default function OrderTrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const selectedOrderId = useAdvisorStore((s) => s.selectedOrderId);
  const current = selectedOrderId === id ? selectedOrderId : null;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-8">
      <header className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-900 text-white">
          <ShieldCheck size={22} />
        </span>
        <div>
          <h1 className="text-lg font-extrabold text-primary-950">پیگیری پرونده امنیتی</h1>
          <p className="text-xs text-slate-500">شناسه سفارش: {id}</p>
        </div>
      </header>

      <ol className="card space-y-4">
        {STATE_STEPS.map((step, index) => (
          <li key={step.state} className="flex items-center gap-3 text-sm text-slate-500">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-extrabold ${
                index === 0 ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-400'
              }`}
            >
              {toPersianDigits(index + 1)}
            </span>
            {step.labelFa}
          </li>
        ))}
      </ol>

      <p className="mt-4 rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-500">
        وضعیت زنده سفارش از طریق Socket.io (اتاق سفارش) در فاز پنل تکنسین/شعبه به‌صورت لحظه‌ای به‌روز
        می‌شود. در این نسخه، آخرین وضعیت ثبت‌شده نمایش داده می‌شود.
        {current ? ' این سفارش همین مرورگر ثبت شده است.' : ''}
      </p>

      <Link href="/brief" className="btn-ghost mt-6 w-full">
        بازگشت به کارنامه
      </Link>
    </main>
  );
}
