'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, LogIn, MapPin, Radio, RefreshCw, ShieldCheck, Star, X } from 'lucide-react';
import { AuthModal } from '@/components/brief/AuthModal';
import { StateBadge, STATE_LABELS } from '@/components/orders/order-state';
import { api, ApiError, type OrderDetail, type WalletMe } from '@/lib/api';
import { formatToman, generateUuid, toPersianDigits } from '@/lib/format';
import { parseNotificationPayload, useDispatchSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';

const TIMELINE = [
  'ESTIMATED',
  'SEARCHING_EXPERT',
  'EXPERT_ASSIGNED',
  'ON_THE_WAY',
  'INSPECTING',
  'QUOTE_APPROVED',
  'IN_PROGRESS',
  'HANDOVER_OTP_PENDING',
  'COMPLETED_WARRANTY_ACTIVE',
] as const;

const CANCELLABLE_STATES = new Set([
  'ESTIMATED',
  'SEARCHING_EXPERT',
  'BRANCH_QUEUE',
  'EXPERT_ASSIGNED',
  'ON_THE_WAY',
  'INSPECTING',
  'QUOTE_APPROVED',
]);

const STEP_LABELS: Record<string, string> = {
  ESTIMATED: 'برآورد قیمت',
  SEARCHING_EXPERT: 'جستجوی کارشناس',
  EXPERT_ASSIGNED: 'اختصاص کارشناس',
  ON_THE_WAY: 'در مسیر',
  INSPECTING: 'بازدید و کارشناسی',
  QUOTE_APPROVED: 'تأیید پیش‌فاکتور',
  IN_PROGRESS: 'نصب و اجرا',
  HANDOVER_OTP_PENDING: 'تحویل و کد',
  COMPLETED_WARRANTY_ACTIVE: 'گارانتی فعال',
};

function resolveTimelineIndex(state: string): number {
  if (state === 'BRANCH_QUEUE') return 1;
  return TIMELINE.indexOf(state as (typeof TIMELINE)[number]);
}

function LiveTechnicianBadge({ coords }: { coords: { lat: number; lng: number; timestamp: string } | null }) {
  if (!coords) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">
      <MapPin size={14} className="animate-pulse" />
      موقعیت زنده کارشناس:
      <span className="tabular-fa" dir="ltr">
        {toPersianDigits(coords.lat.toFixed(4))}, {toPersianDigits(coords.lng.toFixed(4))}
      </span>
      <span className="mr-auto text-[10px] font-normal text-sky-500">
        {toPersianDigits(new Date(coords.timestamp).toLocaleTimeString('fa-IR'))}
      </span>
    </div>
  );
}

function Timeline({ order }: { order: OrderDetail }) {
  const isBranchQueue = order.state === 'BRANCH_QUEUE';
  const isCancelled = order.state === 'CANCELLED';

  let activeIndex = resolveTimelineIndex(order.state);
  if (isCancelled) {
    const lastNonCancelled = [...order.stateTransitions]
      .reverse()
      .find((t) => t.toState !== 'CANCELLED')?.toState;
    activeIndex = lastNonCancelled ? resolveTimelineIndex(lastNonCancelled) : -1;
  }

  return (
    <ol className="card space-y-0">
      {TIMELINE.map((step, index) => {
        const done = activeIndex !== -1 && (isCancelled ? activeIndex >= index : activeIndex > index);
        const current = !isCancelled && activeIndex === index;
        const isPurpleQueue = isBranchQueue && index === 1;
        const label = isPurpleQueue ? 'در صف شعبه (تخصیص دستی)' : STEP_LABELS[step];

        return (
          <li key={step} className="relative flex items-start gap-3 pb-4 last:pb-0">
            {index < TIMELINE.length - 1 ? (
              <span
                className={`absolute right-3.5 top-7 h-full w-0.5 ${
                  done || current ? 'bg-emerald-400' : 'bg-slate-200'
                }`}
              />
            ) : null}
            <span
              className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
                isPurpleQueue
                  ? 'bg-purple-700 text-white ring-4 ring-purple-100'
                  : current
                    ? 'bg-primary-900 text-white ring-4 ring-primary-100'
                    : done
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-100 text-slate-400'
              }`}
            >
              {done ? '✓' : toPersianDigits(index + 1)}
            </span>
            <span
              className={`pt-1 text-sm font-bold ${
                isPurpleQueue
                  ? 'text-purple-700'
                  : current
                    ? 'text-primary-900'
                    : done
                      ? 'text-slate-600'
                      : 'text-slate-400'
              }`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function EscrowApprovalCard({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const quote = order.finalQuoteAmount ?? '0';
  const [wallet, setWallet] = useState<WalletMe | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshWallet = useCallback(() => {
    setWalletError(null);
    api.walletMe()
      .then(setWallet)
      .catch((err: Error) => {
        setWallet(null);
        setWalletError(err.message);
      });
  }, []);

  useEffect(() => {
    refreshWallet();
  }, [refreshWallet]);

  const balance = Number(wallet?.wallet.balance ?? '0');
  const short = wallet ? Math.max(0, Number(quote) - balance) : 0;

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.approveQuote(order.id);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در تأیید پیش‌فاکتور.');
    } finally {
      setBusy(false);
    }
  };

  const quickTopUp = async () => {
    if (short <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.walletTopup(Number(short) + 1_000_000, generateUuid());
      refreshWallet();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در شارژ کیف پول.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3 border-2 border-primary-100">
      <h3 className="text-sm font-extrabold text-slate-800">تأیید قیمت و پرداخت امن (اسکرو)</h3>
      <div className="flex items-center justify-between rounded-xl bg-primary-50 p-4">
        <span className="text-xs text-slate-600">پیش‌فاکتور نهایی کارشناس</span>
        <span className="tabular-fa text-lg font-extrabold text-primary-950">{formatToman(quote, 'full')}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>موجودی قابل هزینه کیف پول شما</span>
        {wallet === null && !walletError ? (
          <span className="flex items-center gap-1 text-slate-400">
            <Loader2 size={13} className="animate-spin" />
            در حال بررسی...
          </span>
        ) : wallet ? (
          <span className="tabular-fa font-bold">{formatToman(wallet.wallet.balance, 'full')}</span>
        ) : (
          <button type="button" onClick={refreshWallet} className="font-bold text-primary-700 underline">
            تلاش مجدد
          </button>
        )}
      </div>
      {walletError ? (
        <p className="rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-600">{walletError}</p>
      ) : null}
      {wallet && short > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
          <span className="font-bold">موجودی کافی نیست — کسری: {formatToman(short, 'full')}</span>
          <button type="button" onClick={quickTopUp} disabled={busy} className="btn-ghost !py-1.5 text-xs">
            {busy ? <Loader2 size={13} className="animate-spin" /> : 'شارژ سریع کیف پول'}
          </button>
        </div>
      ) : null}
      <p className="text-[11px] leading-5 text-slate-400">
        مبلغ تا تکمیل نصب و تأیید تحویل در اسکرو هومنتال مسدود می‌شود؛ پس از تحویل و فعال‌شدن
        گارانتی آزاد و تسویه می‌گردد.
      </p>
      <button
        type="button"
        onClick={approve}
        disabled={busy || wallet === null || short > 0}
        className="btn-primary w-full"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : 'تأیید قیمت و پرداخت امن (Escrow)'}
      </button>
      {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}
    </section>
  );
}

function CancelCard({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.cancelOrder(order.id, reason.trim() || undefined);
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در لغو سفارش.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="w-full rounded-xl border border-red-200 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50"
      >
        لغو این سفارش
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => !busy && setOpen(false)}
        >
          <div className="card w-full max-w-sm space-y-3" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-extrabold text-red-600">لغو پرونده امنیتی</p>
              <button type="button" onClick={() => !busy && setOpen(false)} aria-label="بستن">
                <X size={16} className="text-slate-400" />
              </button>
            </div>
            {order.state === 'QUOTE_APPROVED' ? (
              <p className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
                مبلغ مسدودشده در اسکرو بلافاصله به کیف پول شما بازگردانده می‌شود.
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                پیش از شروع اجرای نصب، لغو سفارش بدون جریمه انجام می‌شود.
              </p>
            )}
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="دلیل لغو (اختیاری)"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="btn-ghost w-full"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={cancel}
                disabled={busy}
                className="w-full rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {busy ? <Loader2 size={15} className="mx-auto animate-spin" /> : 'تأیید لغو سفارش'}
              </button>
            </div>
            {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ReviewCard({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.reviewOrder(order.id, rating, comment || undefined);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در ثبت امتیاز.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3">
      {order.review ? (
        <div>
          <p className="text-sm font-bold text-emerald-700">
            امتیاز شما ثبت شد: {toPersianDigits(order.review.rating)} از ۵ ⭐
          </p>
          {order.review.commentFa ? (
            <p className="mt-1 text-xs text-slate-500">{order.review.commentFa}</p>
          ) : null}
        </div>
      ) : (
        <>
          <h3 className="text-sm font-extrabold text-slate-800">امتیاز به کار کارشناس</h3>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button key={star} type="button" onClick={() => setRating(star)} aria-label={`${star} ستاره`}>
                <Star
                  size={26}
                  className={star <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}
                />
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="نظر شما درباره کیفیت نصب و رفتار کارشناس (اختیاری)"
            rows={2}
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none"
          />
          <button type="button" onClick={submit} disabled={busy || rating === 0} className="btn-primary w-full">
            {busy ? <Loader2 size={16} className="animate-spin" /> : 'ثبت امتیاز'}
          </button>
          {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}
        </>
      )}

      <Link href="/warranties" className="btn-ghost w-full">
        <ShieldCheck size={16} className="text-emerald-600" />
        مشاهده کارت ضمانت دیجیتال
      </Link>
    </section>
  );
}

export default function OrderTrackingPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number; timestamp: string } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const refetch = useCallback(() => {
    if (!id || !accessToken) return;
    setRefreshing(true);
    setError(null);
    api.order(id)
      .then(setOrder)
      .catch((err: Error) => setError(err.message))
      .finally(() => setRefreshing(false));
  }, [id, accessToken]);

  useEffect(() => {
    if (!accessToken) {
      setOrder(null);
      setError(null);
      return;
    }
    refetch();
  }, [accessToken, refetch]);

  const { connected, joinOrder } = useDispatchSocket(accessToken, {
    ORDER_SEARCHING: (payload) => {
      if (!payload.orderId || payload.orderId === id) refetch();
    },
    EXPERT_ASSIGNED: (payload) => {
      if (!payload.orderId || payload.orderId === id) refetch();
    },
    EXPERT_LOCATION_UPDATE: (payload) => {
      if (!payload.orderId || payload.orderId === id) setCoords(payload);
    },
    FINAL_QUOTE_READY: (payload) => {
      if (!payload.orderId || payload.orderId === id) refetch();
    },
    WARRANTY_ACTIVATED: (payload) => {
      if (!payload.orderId || payload.orderId === id) refetch();
    },
    notification: ({ raw }) => {
      const parsed = parseNotificationPayload(raw);
      const targetOrderId = parsed?.data?.orderId;
      if (!targetOrderId || targetOrderId === id) {
        refetch();
      }
    },
  });

  useEffect(() => {
    if (id && accessToken) joinOrder(id);
  }, [id, accessToken, joinOrder]);

  if (!hasHydrated) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10">
        <div className="card flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="animate-spin" size={24} />
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10 text-center">
        <div className="card space-y-3">
          <p className="text-sm text-slate-600">برای پیگیری سفارش ابتدا وارد حساب خود شوید.</p>
          <button type="button" onClick={() => setAuthOpen(true)} className="btn-primary mx-auto">
            <LogIn size={16} />
            ورود با شماره موبایل
          </button>
        </div>
        {authOpen ? <AuthModal onDone={() => setAuthOpen(false)} /> : null}
      </main>
    );
  }
  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10">
        <p className="card text-sm font-bold text-red-600">{error}</p>
        <Link href="/orders" className="btn-ghost mt-4 w-full">
          بازگشت به سفارش‌ها
        </Link>
      </main>
    );
  }
  if (!order) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10">
        <div className="card flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="animate-spin" size={24} />
        </div>
      </main>
    );
  }

  const isCustomer = user.role === 'CUSTOMER';

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 pb-16 pt-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold text-primary-950">پرونده {order.orderNumber}</h1>
          <p className="text-xs text-slate-500">پیگیری زنده چرخه امنیت</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`chip text-[11px] font-bold ${
              connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'
            }`}
          >
            <Radio size={12} className={connected ? 'animate-pulse' : ''} />
            {connected ? 'متصل زنده' : 'آفلاین'}
          </span>
          <button
            type="button"
            onClick={refetch}
            disabled={refreshing}
            className="btn-ghost !px-3 !py-1.5 text-xs"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            بروزرسانی
          </button>
          <StateBadge state={order.state} />
        </div>
      </header>

      {order.state === 'CANCELLED' ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm font-bold text-red-700">
          این سفارش لغو شده است.
          {order.cancelReason ? (
            <p className="mt-1 text-xs font-normal text-red-600">دلیل لغو: {order.cancelReason}</p>
          ) : null}
        </div>
      ) : null}

      {order.state === 'BRANCH_QUEUE' ? (
        <p className="rounded-2xl bg-purple-50 p-4 text-center text-sm font-bold text-purple-700">
          این سفارش در صف شعبه است؛ به‌زودی به‌صورت دستی کارشناس اختصاص می‌یابد.
        </p>
      ) : null}

      <LiveTechnicianBadge coords={coords} />

      <Timeline order={order} />

      {isCustomer && order.state === 'INSPECTING' && order.finalQuoteAmount ? (
        <EscrowApprovalCard order={order} onDone={refetch} />
      ) : null}

      {isCustomer && order.state === 'HANDOVER_OTP_PENDING' ? (
        <p className="rounded-2xl bg-amber-50 p-4 text-xs leading-6 text-amber-800">
          کارشناس مراحل نصب را کامل کرده است. کد ۶ رقمی پیامک‌شده را فقط پس از اطمینان از
          تغییر رمزهای پیش‌فرض و کیفیت نصب به او اعلام کنید.
        </p>
      ) : null}

      {isCustomer && order.state === 'COMPLETED_WARRANTY_ACTIVE' ? (
        <ReviewCard order={order} onDone={refetch} />
      ) : null}

      {isCustomer && CANCELLABLE_STATES.has(order.state) ? (
        <CancelCard order={order} onDone={refetch} />
      ) : null}

      <details className="card">
        <summary className="cursor-pointer text-sm font-bold text-slate-600">
          تاریخچه وضعیت‌ها ({toPersianDigits(order.stateTransitions.length)} رویداد)
        </summary>
        <div className="mt-3 space-y-2">
          {order.stateTransitions.map((transition) => (
            <div key={transition.id} className="flex items-center justify-between text-xs text-slate-500">
              <span>
                {transition.fromState ? `${STATE_LABELS[transition.fromState]?.labelFa ?? transition.fromState} → ` : ''}
                {STATE_LABELS[transition.toState]?.labelFa ?? transition.toState}
                {transition.reason ? ` — ${transition.reason}` : ''}
              </span>
              <span className="tabular-fa text-[10px] text-slate-400">
                {toPersianDigits(new Date(transition.createdAt).toLocaleTimeString('fa-IR'))}
              </span>
            </div>
          ))}
        </div>
      </details>
    </main>
  );
}
