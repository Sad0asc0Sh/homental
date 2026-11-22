'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader2, LogIn, RefreshCw } from 'lucide-react';
import { AuthModal } from '@/components/brief/AuthModal';
import { StateBadge } from '@/components/orders/order-state';
import { api, type OrderRow, type OrdersPage as OrdersPageData } from '@/lib/api';
import { formatToman, toPersianDigits } from '@/lib/format';
import { useAuthStore } from '@/store/auth.store';

export default function OrdersPage() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [data, setData] = useState<OrdersPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  const reload = useCallback(() => {
    if (!accessToken) return;
    setRefreshing(true);
    setError(null);
    api.orders()
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setRefreshing(false));
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      setData(null);
      setError(null);
      return;
    }
    reload();
  }, [accessToken, reload]);

  if (!hasHydrated) {
    return (
      <main className="mx-auto max-w-3xl px-4 pt-10">
        <div className="card flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="animate-spin" size={22} />
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl px-4 pt-10 text-center">
        <div className="card space-y-3">
          <p className="text-sm text-slate-600">برای مشاهده سفارش‌ها ابتدا وارد حساب خود شوید.</p>
          <button type="button" onClick={() => setAuthOpen(true)} className="btn-primary mx-auto">
            <LogIn size={16} />
            ورود با شماره موبایل
          </button>
        </div>
        {authOpen ? <AuthModal onDone={() => setAuthOpen(false)} /> : null}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="mb-1 text-xl font-extrabold text-primary-950">سفارش‌های من</h1>
          <p className="text-xs text-slate-500">پیگیری پرونده‌های امنیتی ثبت‌شده</p>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={refreshing}
          className="btn-ghost !px-3 !py-2 text-xs"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          بروزرسانی
        </button>
      </header>

      {error ? <p className="card text-sm font-bold text-red-600">{error}</p> : null}
      {!data && !error ? (
        <div className="card flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="animate-spin" size={22} />
        </div>
      ) : null}

      {data && data.items.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          هنوز سفارشی ثبت نکرده‌اید.{' '}
          <Link href="/" className="font-bold text-primary-700">
            شروع طراحی امنیت
          </Link>
        </div>
      ) : null}

      <div className="space-y-3">
        {(data?.items ?? []).map((order: OrderRow) => {
          const serviceTitles = (order.items ?? [])
            .map((item) => item.serviceDefinition?.titleFa)
            .filter(Boolean)
            .join('، ');
          return (
            <Link
              key={order.id}
              href={`/order/${order.id}`}
              className="card flex items-center justify-between gap-3 transition-all hover:ring-primary-300"
            >
              <div className="space-y-1">
                <p className="flex flex-wrap items-center gap-2 font-extrabold text-slate-800">
                  {order.orderNumber}
                  <StateBadge state={order.state} />
                </p>
                {serviceTitles ? (
                  <p className="text-xs font-bold text-slate-600">{serviceTitles}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span className="tabular-fa">
                    {order.finalQuoteAmount
                      ? `پیش‌فاکتور نهایی: ${formatToman(order.finalQuoteAmount, 'full')}`
                      : order.pricing?.netEstimated
                        ? `برآورد اولیه: ${formatToman(order.pricing.netEstimated, 'full')}`
                        : 'در حال برآورد'}
                  </span>
                  <span className="tabular-fa text-[11px] text-slate-400">
                    {toPersianDigits(new Date(order.createdAt).toLocaleDateString('fa-IR'))}
                  </span>
                </div>
              </div>
              <ChevronLeft size={18} className="shrink-0 text-slate-300" />
            </Link>
          );
        })}
      </div>
      {data ? (
        <p className="mt-4 text-center text-xs text-slate-400">
          مجموع {toPersianDigits(data.total)} سفارش
        </p>
      ) : null}
    </main>
  );
}
