'use client';

import { useCallback, useEffect, useState } from 'react';
import { Banknote, Building2, Loader2, Lock, RefreshCw, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { api, ApiError, type AdminFinanceSummary } from '@/lib/api';
import { formatToman, toPersianDigits } from '@/lib/format';

function formatPercent(rate: number): string {
  return `${toPersianDigits((rate * 100).toFixed(1).replace(/\.0$/, ''))}٪`;
}

export function FinanceTab() {
  const [summary, setSummary] = useState<AdminFinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    api.adminFinanceSummary()
      .then(setSummary)
      .catch((err: Error) =>
        setError(err instanceof ApiError ? err.message : 'خطا در دریافت گزارش مالی.'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading && !summary) {
    return (
      <div className="card flex items-center justify-center py-12 text-slate-400">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="card space-y-3 text-center">
        <p className="text-sm font-bold text-red-600">{error}</p>
        <button type="button" onClick={reload} className="btn-ghost mx-auto text-xs">
          تلاش مجدد
        </button>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          نرخ پایه پلتفرم: کمیسیون {formatPercent(summary.defaultCommissionRate)} | ذخیره ضمانت{' '}
          {formatPercent(summary.defaultWarrantyReserveRate)}
        </p>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="btn-ghost !px-3 !py-1.5 text-xs"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          بروزرسانی گزارش
        </button>
      </div>

      {/* KPI Cards */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="card">
          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
            <Wallet size={15} className="text-primary-700" />
            موجودی قابل برداشت پلتفرم
          </p>
          <p className="tabular-fa mt-2 text-lg font-extrabold text-primary-950">
            {formatToman(summary.platformBalance, 'full')}
          </p>
        </div>

        <div className="card border-2 border-emerald-200 bg-gradient-to-bl from-emerald-50 to-white">
          <p className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-800">
            <ShieldCheck size={16} className="text-emerald-600" />
            صندوق ذخیره ریسک ضمانت ۵٪
          </p>
          <p className="tabular-fa mt-2 text-xl font-extrabold text-emerald-950">
            {formatToman(summary.restrictedReserve, 'full')}
          </p>
          <p className="mt-1 text-[11px] text-emerald-700">
            دفتر کل اختصاصی پوشش خرابی و گارانتی
          </p>
        </div>

        <div className="card border-2 border-sky-200 bg-gradient-to-bl from-sky-50 to-white">
          <p className="flex items-center gap-1.5 text-xs font-extrabold text-sky-800">
            <Truck size={16} className="text-sky-600" />
            ذخیره لجستیک و پشتیبانی
          </p>
          <p className="tabular-fa mt-2 text-xl font-extrabold text-sky-950">
            {formatToman(summary.restrictedFulfillment, 'full')}
          </p>
        </div>

        <div className="card">
          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
            <Banknote size={15} className="text-primary-700" />
            کل کمیسیون پلتفرم
          </p>
          <p className="tabular-fa mt-2 text-lg font-extrabold text-primary-950">
            {formatToman(summary.totalPlatformCommission, 'full')}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">سهم خالص درآمد هومنتال</p>
        </div>

        <div className="card">
          <p className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
            <Lock size={15} className="text-amber-600" />
            مبلغ مسدودشده در اسکرو
          </p>
          <p className="tabular-fa mt-2 text-lg font-extrabold text-amber-800">
            {formatToman(summary.activeHeldInEscrow, 'full')}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">در انتظار تکمیل نصب و تأیید تحویل</p>
        </div>

        <div className="card">
          <p className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
            <Building2 size={15} className="text-primary-700" />
            کل تسویه با تکنسین‌ها
          </p>
          <p className="tabular-fa mt-2 text-lg font-extrabold text-slate-800">
            {formatToman(summary.totalTechnicianPayout, 'full')}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            خالص پرداختی به کارشناسان پس از تحویل سفارش
          </p>
        </div>
      </section>

      {/* Per-branch dual-commission comparison */}
      <section className="card overflow-x-auto !p-0">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-extrabold text-slate-800">
            عملکرد مالی و مدل کمیسیون دوگانه شعب
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            شعب دارای شوروم فیزیکی می‌توانند نرخ کمیسیون اختصاصی پایین‌تر از نرخ پایه دریافت کنند.
          </p>
        </div>
        {summary.branches.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-400">شعبه‌ای ثبت نشده است.</p>
        ) : (
          <table className="w-full min-w-[720px] text-right text-xs">
            <thead className="border-b border-slate-100 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-bold">کد و نام شعبه</th>
                <th className="px-4 py-3 font-bold">مدل همکاری</th>
                <th className="px-4 py-3 font-bold">کمیسیون مؤثر</th>
                <th className="px-4 py-3 font-bold">ذخیره ضمانت</th>
                <th className="px-4 py-3 font-bold">سفارش‌ها (تکمیل/کل)</th>
                <th className="px-4 py-3 font-bold">فروش تکمیل‌شده</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.branches.map((b) => (
                <tr key={b.branchId} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <p className="font-extrabold text-slate-800">{b.nameFa}</p>
                    <p className="tabular-fa text-[11px] text-slate-400">
                      <span dir="ltr">{b.branchCode}</span>
                      {b.cityNameFa ? ` — ${b.cityNameFa}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`chip !px-2.5 !py-0.5 text-[11px] font-bold ${
                        b.hasPhysicalShowroom
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {b.hasPhysicalShowroom ? 'شوروم فیزیکی (شریک)' : 'شعبه استاندارد'}
                    </span>
                  </td>
                  <td className="tabular-fa px-4 py-3 font-bold text-primary-900">
                    {formatPercent(b.effectiveCommissionRate)}
                    {b.commissionRateOverride !== null ? (
                      <span className="mr-1 text-[10px] font-normal text-emerald-600">(اختصاصی)</span>
                    ) : (
                      <span className="mr-1 text-[10px] font-normal text-slate-400">(پایه)</span>
                    )}
                  </td>
                  <td className="tabular-fa px-4 py-3 text-slate-700">
                    {formatPercent(b.effectiveWarrantyReserveRate)}
                    {b.warrantyReserveOverride !== null ? (
                      <span className="mr-1 text-[10px] text-emerald-600">(اختصاصی)</span>
                    ) : null}
                  </td>
                  <td className="tabular-fa px-4 py-3 font-bold text-slate-700">
                    {toPersianDigits(b.completedOrderCount)} / {toPersianDigits(b.orderCount)}
                  </td>
                  <td className="tabular-fa px-4 py-3 font-extrabold text-slate-800">
                    {formatToman(b.completedRevenue, 'full')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
