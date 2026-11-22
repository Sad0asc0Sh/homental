'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, MapPin, Star, X } from 'lucide-react';
import { StateBadge, STATE_LABELS } from '@/components/orders/order-state';
import { api, ApiError, type OrderDetail, type WalletMe } from '@/lib/api';
import { useDispatchSocket } from '@/lib/socket';
import { formatToman, toPersianDigits } from '@/lib/format';
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
  INSPECTING: 'بازدید',
  QUOTE_APPROVED: 'تأیید پیش‌فاکتور',
  IN_PROGRESS: 'نصب و اجرا',
  HANDOVER_OTP_PENDING: 'تحویل و کد',
  COMPLETED_WARRANTY_ACTIVE: 'گارانتی فعال',
};

function LiveTechnicianBadge({ coords }: { coords: { lat: number; lng: number; timestamp: string } | null }) {
  if (!coords) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">
      <MapPin size={14} className="animate-pulse" />
      موقعیت زنده کارشناس:
      <span className="tabular-fa">
        {toPersianDigits(coords.lat.toFixed(4))} ، {toPersianDigits(coords.lng.toFixed(4))}
      </span>
      <span className="text-[10px] font-normal text-sky-400">
        {toPersianDigits(new Date(coords.timestamp).toLocaleTimeString('fa-IR'))}
      </span>
    </div>
  );
}

function Timeline({ state }: { state: string }) {
  const currentIndex = TIMELINE.indexOf(state as (typeof TIMELINE)[number]);
  return (
    <ol className="card space-y-0">
      {TIMELINE.map((step, index) => {
        const done = currentIndex >= index && currentIndex !== -1;
        const current = currentIndex === index;
        return (
          <li key={step} className="relative flex items-start gap-3 pb-4 last:pb-0">
            {index < TIMELINE.length - 1 ? (
              <span
                className={`absolute right-3.5 top-7 h-full w-0.5 ${done ? 'bg-emerald-400' : 'bg-slate-200'}`}
              />
            ) : null}
            <span
              className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
                current
                  ? 'bg-primary-900 text-white ring-4 ring-primary-100'
                  : done
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {done && !current ? '✓' : toPersianDigits(index + 1)}
            </span>
            <span className={`pt-1 text-sm font-bold ${current ? 'text-primary-900' : done ? 'text-slate-600' : 'text-slate-400'}`}>
              {STEP_LABELS[step]}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshWallet = useCallback(() => {
    api.walletMe().then(setWallet).catch(() => setWallet(null));
  }, []);

  useEffect(() => {
    refreshWallet();
  }, [refreshWallet]);

  const balance = Number(wallet?.wallet.balance ?? '0');
  const short = Math.max(0, Number(quote) - balance);

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
    setBusy(true);
    setError(null);
    try {
      await api.walletTopup(Number(short) + 1_000_000, crypto.randomUUID());
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
        <span className="tabular-fa text-lg font-extrabold text-primary-950">{formatToman(quote)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span>موجودی قابل هزینه کیف پول شما</span>
        <span className="tabular-fa font-bold">{formatToman(wallet?.wallet.balance ?? '0')}</span>
      </div>
      {short > 0 ? (
        <div className="flex items-center justify-between rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
          <span>موجودی کافی نیست — کسری: {formatToman(short)}</span>
          <button type="button" onClick={quickTopUp} disabled={busy} className="btn-ghost !py-1.5 text-xs">
            شارژ سریع
          </button>
        </div>
      ) : null}
      <p className="text-[11px] leading-5 text-slate-400">
        مبلغ تا تکمیل نصب و تأیید تحویل در اسکرو هومنتال مسدود می‌شود؛ پس از تحویل و فعال‌شدن
        گارانتی آزاد و تسویه می‌گردد.
      </p>
      <button type="button" onClick={approve} disabled={busy || short > 0} className="btn-primary w-full">
        تأیید قیمت و پرداخت امن (Escrow)
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
      await api.cancelOrder(order.id, reason);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در لغو سفارش.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      {open ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-extrabold text-red-600">لغو پرونده امنیتی</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="بستن">
              <X size={16} className="text-slate-400" />
            </button>
          </div>
          {order.state === 'QUOTE_APPROVED' ? (
            <p className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
              مبلغ مسدودشده در اسکرو بلافاصله به کیف پول شما بازگردانده می‌شود.
            </p>
          ) : null}
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="دلیل لغو (اختیاری)"
            className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none"
          />
          <button type="button" onClick={cancel} disabled={busy} className="w-full rounded-xl bg-red-600 py-2.5 font-bold text-white hover:bg-red-700 disabled:opacity-60">
            تأیید لغو سفارش
          </button>
          {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="w-full rounded-xl border border-red-200 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50">
          لغو این سفارش
        </button>
      )}
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

  if (order.review) {
    return (
      <section className="card">
        <p className="text-sm font-bold text-emerald-700">
          امتیاز شما ثبت شد: {toPersianDigits(order.review.rating)} از ۵ ⭐
        </p>
        {order.review.commentFa ? (
          <p className="mt-1 text-xs text-slate-500">{order.review.commentFa}</p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="card space-y-3">
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
        ثبت امتیاز
      </button>
      {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}
      <Link href="/warranties" className="btn-ghost w-full">
        مشاهده کارت گارانتی دیجیتال
      </Link>
    </section>
  );
}

export default function OrderTrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string>('');
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number; timestamp: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    params.then((resolved) => setId(resolved.id));
  }, [params]);

  const refetch = useCallback(() => {
    if (!id) return;
    api.order(id)
      .then(setOrder)
      .catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    refetch();
  }, [refetch, reloadKey]);

  const { joinOrder } = useDispatchSocket(accessToken, {
    EXPERT_ASSIGNED: () => setReloadKey((key) => key + 1),
    EXPERT_LOCATION_UPDATE: (payload) => setCoords(payload),
    FINAL_QUOTE_READY: () => setReloadKey((key) => key + 1),
    WARRANTY_ACTIVATED: () => setReloadKey((key) => key + 1),
    ORDER_SEARCHING: () => setReloadKey((key) => key + 1),
  });

  useEffect(() => {
    if (order && id) joinOrder(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, id, joinOrder]);

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10 text-center">
        <p className="card text-sm text-slate-600">برای پیگیری سفارش ابتدا وارد حساب خود شوید.</p>
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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-extrabold text-primary-950">پرونده {order.orderNumber}</h1>
          <p className="text-xs text-slate-500">پیگیری زنده چرخه امنیت</p>
        </div>
        <StateBadge state={order.state} />
      </header>

      {order.state === 'BRANCH_QUEUE' ? (
        <p className="rounded-2xl bg-purple-50 p-4 text-center text-sm font-bold text-purple-700">
          این سفارش در صف شعبه است؛ به‌زودی به‌صورت دستی کارشناس اختصاص می‌یابد.
        </p>
      ) : null}

      <LiveTechnicianBadge coords={coords} />

      <Timeline state={order.state} />

      {isCustomer && order.state === 'INSPECTING' && order.finalQuoteAmount ? (
        <EscrowApprovalCard order={order} onDone={() => setReloadKey((k) => k + 1)} />
      ) : null}

      {isCustomer && order.state === 'HANDOVER_OTP_PENDING' ? (
        <p className="rounded-2xl bg-amber-50 p-4 text-xs leading-6 text-amber-800">
          کارشناس مراحل نصب را کامل کرده است. کد ۶ رقمی پیامک‌شده را فقط پس از اطمینان از
          تغییر رمزهای پیش‌فرض و کیفیت نصب به او اعلام کنید.
        </p>
      ) : null}

      {isCustomer && order.state === 'COMPLETED_WARRANTY_ACTIVE' ? (
        <ReviewCard order={order} onDone={() => setReloadKey((k) => k + 1)} />
      ) : null}

      {isCustomer && CANCELLABLE_STATES.has(order.state) ? (
        <CancelCard order={order} onDone={() => setReloadKey((k) => k + 1)} />
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

      {order.cancelReason ? (
        <p className="rounded-xl bg-red-50 p-3 text-center text-xs font-bold text-red-600">
          دلیل لغو: {order.cancelReason}
        </p>
      ) : null}
    </main>
  );
}
