'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Box, Building2, Loader2, LogIn, MapPin, Radio, RefreshCw, ShieldCheck, Star, X } from 'lucide-react';
import { AuthModal } from '@/components/brief/AuthModal';
import { MeteredAdjustmentCard } from '@/components/orders/MeteredAdjustmentCard';
import { StateBadge, STATE_LABELS } from '@/components/orders/order-state';
import { ESCROW_AT_SUBMIT, TransparentInvoice } from '@/components/orders/TransparentInvoice';
import {
  api,
  ApiError,
  parseNotificationPayload,
  useDispatchSocket,
  type OrderDetail,
  type WalletMe,
} from '@homental/api-client';
import {
  formatNumberFa,
  formatToman,
  generateUuid,
  PROPERTY_ASSET_KIND_LABELS_FA,
  PROPERTY_TYPE_LABELS_FA,
  toPersianDigits,
  type OrderPropertySummary,
} from '@homental/shared';
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

const ESCROW_NOTES = {
  OPEN: 'مبلغ هنگام ثبت سفارش از کیف پول شما در امانت (اسکرو) قرار گرفت و تا تأیید تحویل نزد هومنتال می‌ماند.',
  SETTLED: 'مبلغ سفارش هنگام ثبت در امانت قرار گرفت و پس از تأیید تحویل تسویه شد.',
  REFUNDED: 'مبلغ امانت سفارش به کیف پول شما بازگردانده شد.',
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

function OrderPropertyCard({ summary }: { summary?: OrderPropertySummary | null }) {
  if (!summary) return null;
  const areaM2 = typeof summary.defaultDimensionsJson?.areaM2 === 'number' ? summary.defaultDimensionsJson.areaM2 : null;
  const ceilingCm = typeof summary.defaultDimensionsJson?.ceilingHeightCm === 'number'
    ? summary.defaultDimensionsJson.ceilingHeightCm
    : null;

  return (
    <section className="card space-y-2 border border-emerald-200/80 bg-emerald-50/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Building2 size={16} className="text-emerald-700" />
          <h2 className="text-sm font-extrabold text-slate-800">{summary.title}</h2>
          <span className="chip bg-white text-[11px] font-bold text-slate-700">
            {PROPERTY_TYPE_LABELS_FA[summary.propertyType] ?? summary.propertyType}
          </span>
          {summary.hasReady3dModel ? (
            <span className="chip bg-emerald-100 text-[11px] font-bold text-emerald-800">
              <Box size={12} />
              دارای مدل سه‌بعدی
            </span>
          ) : null}
        </div>
        <Link href="/properties" className="text-xs font-bold text-primary-700 hover:underline">
          مدیریت املاک من
        </Link>
      </div>
      <p className="text-xs leading-6 text-slate-600">{summary.address}</p>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        {areaM2 ? <span className="tabular-fa">مساحت تقریبی: {formatNumberFa(areaM2)} مترمربع</span> : null}
        {ceilingCm ? <span className="tabular-fa">ارتفاع سقف: {formatNumberFa(ceilingCm)} سانتی‌متر</span> : null}
        <span className="tabular-fa">{toPersianDigits(summary.mediaCount)} مستند / فایل محل</span>
      </div>
      {summary.notes ? <p className="text-xs text-slate-500">توضیحات محل: {summary.notes}</p> : null}
      {summary.mediaAssets.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {summary.mediaAssets.slice(0, 4).map((asset) => (
            <span key={asset.id} className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 shadow-sm">
              {PROPERTY_ASSET_KIND_LABELS_FA[asset.kind] ?? asset.kind}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Timeline({ order }: { order: OrderDetail }) {
  const isBranchQueue = order.state === 'BRANCH_QUEUE';
  const isCancelled = order.state === 'CANCELLED';

  let activeIndex = resolveTimelineIndex(order.state);
  if (isCancelled) {
    const lastNonCancelled = [...(order.stateTransitions ?? [])]
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
        const label = isPurpleQueue ? 'در صف ارسال دعوت‌نامه شعبه' :
          step === 'QUOTE_APPROVED' && order.invoice ? 'تأیید تطابق محل' : STEP_LABELS[step];

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

  const balance = BigInt(wallet?.wallet.balance ?? '0');
  const short = wallet ? BigInt(quote) - balance : BigInt(0);

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
    if (short <= BigInt(0)) return;
    setBusy(true);
    setError(null);
    try {
      await api.walletTopup((short + BigInt(1_000_000)).toString(), generateUuid());
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
      {wallet && short > BigInt(0) ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
          <span className="font-bold">موجودی کافی نیست — کسری: {formatToman(short.toString(), 'full')}</span>
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
        disabled={busy || wallet === null || short > BigInt(0)}
        className="btn-primary w-full"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : 'تأیید قیمت و پرداخت امن (Escrow)'}
      </button>
      {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}
    </section>
  );
}

function SubmitOrderCard({ orderId, sliderBps, onDone }: { orderId: string; sliderBps?: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.submitOrder(orderId, sliderBps);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در ثبت نهایی سفارش.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3">
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className="btn-primary flex-1" onClick={submit}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : 'ثبت نهایی و پرداخت امانی'}
        </button>
        <Link href="/wallet" className="btn-ghost">کیف پول</Link>
      </div>
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
            {order.escrowStatus === 'OPEN' || (!order.invoice && order.state === 'QUOTE_APPROVED') ? (
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
  const requestSequence = useRef(0);

  const refetch = useCallback(() => {
    if (!id || !accessToken) return;
    const sequence = ++requestSequence.current;
    setRefreshing(true);
    setError(null);
    api.order(id)
      .then((next) => { if (sequence === requestSequence.current) setOrder(next); })
      .catch((err: Error) => { if (sequence === requestSequence.current) setError(err.message); })
      .finally(() => { if (sequence === requestSequence.current) setRefreshing(false); });
  }, [id, accessToken]);

  useEffect(() => {
    if (!accessToken) {
      requestSequence.current++;
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
    METERED_ADJUSTMENT_CHANGED: (payload) => {
      if (payload.orderId === id) refetch();
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

  useEffect(() => {
    if (connected) refetch();
  }, [connected, refetch]);

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
  const stateTransitions = order.stateTransitions ?? [];
  const cancelReason = stateTransitions.findLast((transition) => transition.toState === 'CANCELLED')?.reason;
  const escrowNote = order.escrowStatus ? ESCROW_NOTES[order.escrowStatus] :
    order.state === 'CANCELLED' ? 'پیش‌نویس سفارش پیش از پرداخت لغو شد.' : ESCROW_AT_SUBMIT;

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
          {cancelReason ? (
            <p className="mt-1 text-xs font-normal text-red-600">دلیل لغو: {cancelReason}</p>
          ) : null}
        </div>
      ) : null}

      {order.state === 'BRANCH_QUEUE' ? (
        <p className="rounded-2xl bg-purple-50 p-4 text-center text-sm font-bold text-purple-700">
          سفارش در صف شعبه است و پس از پذیرش دعوت‌نامه به کارشناس اختصاص می‌یابد.
        </p>
      ) : null}

      <LiveTechnicianBadge coords={coords} />

      <OrderPropertyCard summary={order.propertySummary} />

      {isCustomer && order.state === 'IN_PROGRESS' && order.pendingAdjustment ? (
        <MeteredAdjustmentCard key={order.pendingAdjustment.id} orderId={order.id} adjustment={order.pendingAdjustment} onDone={refetch} />
      ) : null}

      {isCustomer && order.latestAdjustment?.status === 'AUTO_REFUNDED' ? (
        <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
          متراژ مصرفی کمتر از برآورد بود. {formatToman((-BigInt(order.latestAdjustment.deltaAmount)).toString(), 'full')} به کیف پول شما برگشت.
        </p>
      ) : null}

      {isCustomer && order.invoice ? (
        <TransparentInvoice invoice={order.invoice} escrowNote={escrowNote} />
      ) : null}

      {isCustomer && order.invoice && order.state === 'ESTIMATED' ? (
        <SubmitOrderCard orderId={order.id} sliderBps={order.slider?.sliderBps} onDone={refetch} />
      ) : null}

      <Timeline order={order} />

      {isCustomer && !order.invoice && order.state === 'INSPECTING' && order.finalQuoteAmount ? (
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
          تاریخچه وضعیت‌ها ({toPersianDigits(stateTransitions.length)} رویداد)
        </summary>
        <div className="mt-3 space-y-2">
          {stateTransitions.map((transition) => (
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
