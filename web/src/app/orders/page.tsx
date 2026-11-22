'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { StateBadge } from '@/components/orders/order-state';
import { formatToman, toPersianDigits } from '@/lib/format';
import type { OrdersPage, OrderRow } from '@/lib/api';

export default function OrdersPage() {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<OrdersPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api.orders()
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [user]);

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl px-4 pt-10 text-center">
        <p className="card text-sm text-slate-600">برای مشاهده سفارش‌ها ابتدا از صفحه اصلی وارد شوید.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-6">
      <h1 className="mb-1 text-xl font-extrabold text-primary-950">سفارش‌های من</h1>
      <p className="mb-6 text-xs text-slate-500">پیگیری پرونده‌های امنیتی ثبت‌شده</p>

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
        {(data?.items ?? []).map((order: OrderRow) => (
          <Link
            key={order.id}
            href={`/order/${order.id}`}
            className="card flex items-center justify-between gap-3 transition-all hover:ring-primary-300"
          >
            <div>
              <p className="flex items-center gap-2 font-extrabold text-slate-800">
                {order.orderNumber}
                <StateBadge state={order.state} />
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {order.finalQuoteAmount ? `پیش‌فاکتور: ${formatToman(order.finalQuoteAmount)}` : 'در حال برآورد'}
              </p>
            </div>
            <ChevronLeft size={18} className="text-slate-300" />
          </Link>
        ))}
      </div>
      {data ? (
        <p className="mt-4 text-center text-xs text-slate-400">
          مجموع {toPersianDigits(data.total)} سفارش
        </p>
      ) : null}
    </main>
  );
}
