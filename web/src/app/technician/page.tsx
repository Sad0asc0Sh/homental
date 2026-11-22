'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BadgeCheck,
  Loader2,
  MapPin,
  Navigation,
  Power,
  Radio,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api, ApiError, type OrderRow } from '@/lib/api';
import { useDispatchSocket, type DispatchEventPayloads } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';
import { StateBadge, STATE_LABELS } from '@/components/orders/order-state';
import { formatToman, toPersianDigits } from '@/lib/format';

const MASHHAD_PRESETS = [
  { nameFa: 'وکیل‌آباد', lat: 36.3105, lng: 59.5663 },
  { nameFa: 'احمدآباد', lat: 36.2873, lng: 59.6123 },
  { nameFa: 'سجاد', lat: 36.3018, lng: 59.5838 },
];

interface LiveOffer {
  offerId: string;
  orderId: string;
  orderNumber: string;
  score: number;
  expiresInMs: number;
  receivedAt: number;
}

function CountdownBar({ receivedAt, ttlMs }: { receivedAt: number; ttlMs: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, ttlMs - (now - receivedAt));
  const seconds = Math.ceil(remaining / 1000);
  const percent = Math.max(0, (remaining / ttlMs) * 100);
  return (
    <div>
      <div className="h-1.5 rounded-full bg-slate-200">
        <div
          className={`h-1.5 rounded-full transition-all duration-500 ${
            seconds <= 10 ? 'bg-red-500' : seconds <= 20 ? 'bg-amber-500' : 'bg-emerald-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="tabular-fa mt-1 text-left text-[10px] font-bold text-slate-400">
        {toPersianDigits(seconds)} ثانیه
      </p>
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className="fixed top-16 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-lg">
      {message}
    </div>
  );
}

export default function TechnicianPage() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [isOnline, setIsOnline] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [offers, setOffers] = useState<LiveOffer[]>([]);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [quoteDrafts, setQuoteDrafts] = useState<Record<string, string>>({});
  const [otpDrafts, setOtpDrafts] = useState<Record<string, string>>({});
  const [serialDrafts, setSerialDrafts] = useState<Record<string, Record<string, string>>>({});
  const [checklist, setChecklist] = useState<Record<string, { passwords: boolean; access: boolean }>>({});
  const [devOtp, setDevOtp] = useState<Record<string, string>>({});
  const [resendAt, setResendAt] = useState<Record<string, number>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const pingRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const reloadOrders = useCallback(() => {
    if (!user || user.role !== 'TECHNICIAN') return;
    api.orders()
      .then((page) => setOrders(page.items))
      .catch(() => setOrders([]));
  }, [user]);

  const runAction = useCallback(
    async (orderId: string, action: () => Promise<unknown>) => {
      setBusyId(orderId);
      setActionError((prev) => ({ ...prev, [orderId]: '' }));
      try {
        await action();
        reloadOrders();
      } catch (error) {
        setActionError((prev) => ({
          ...prev,
          [orderId]: error instanceof ApiError ? error.message : 'خطا در انجام عملیات.',
        }));
      } finally {
        setBusyId(null);
      }
    },
    [reloadOrders],
  );

  const toggleOnline = async () => {
    if (!coords) return;
    try {
      const result = await api.dispatchStatus({ isOnline: !isOnline, lat: coords.lat, lng: coords.lng });
      setIsOnline(result.isOnline);
      if (!result.isOnline) setOffers([]);
    } catch (error) {
      setToast(error instanceof ApiError ? error.message : 'خطا در تغییر وضعیت.');
    }
  };

  const setPreset = async (lat: number, lng: number) => {
    setCoords({ lat, lng });
    if (isOnline) {
      await api.dispatchStatus({ isOnline: true, lat, lng }).catch(() => undefined);
    }
  };

  const useGeolocation = () => {
    navigator.geolocation?.getCurrentPosition(
      (position) => void setPreset(position.coords.latitude, position.coords.longitude),
      () => setToast('دسترسی موقعیت مکانی رد شد؛ از مختصات پیش‌فرض استفاده کنید.'),
    );
  };

  // 30s location ping while online
  useEffect(() => {
    if (!isOnline || !coords) return;
    pingRef.current = setInterval(() => {
      void api.dispatchLocation({ lat: coords.lat, lng: coords.lng }).catch(() => undefined);
    }, 30_000);
    pingRef.current.unref?.();
    return () => clearInterval(pingRef.current);
  }, [isOnline, coords]);

  // Socket live offers
  const onDispatchOffer = useCallback(
    (payload: DispatchEventPayloads['DISPATCH_OFFER']) => {
      setOffers((prev) =>
        prev.some((offer) => offer.offerId === payload.offerId)
          ? prev
          : [...prev, { ...payload, receivedAt: Date.now() }],
      );
      reloadOrders();
    },
    [reloadOrders],
  );

  const onOfferTaken = useCallback((payload: DispatchEventPayloads['OFFER_TAKEN']) => {
    setOffers((prev) => prev.filter((offer) => offer.offerId !== payload.offerId));
    setToast('سفارش توسط کارشناس دیگری پذیرفته شد');
  }, []);

  const { connected } = useDispatchSocket(accessToken, {
    DISPATCH_OFFER: onDispatchOffer,
    OFFER_TAKEN: onOfferTaken,
    EXPERT_ASSIGNED: () => reloadOrders(),
  });

  useEffect(() => {
    reloadOrders();
  }, [reloadOrders]);

  const acceptOffer = async (offer: LiveOffer) => {
    try {
      await api.acceptOffer(offer.offerId);
      setOffers((prev) => prev.filter((o) => o.offerId !== offer.offerId));
      setToast(`سفارش ${offer.orderNumber} به شما اختصاص یافت!`);
      reloadOrders();
    } catch (error) {
      setOffers((prev) => prev.filter((o) => o.offerId !== offer.offerId));
      setToast(error instanceof ApiError ? error.message : 'خطا در پذیرش سفارش.');
    }
  };

  const declineOffer = async (offer: LiveOffer) => {
    await api.declineOffer(offer.offerId).catch(() => undefined);
    setOffers((prev) => prev.filter((o) => o.offerId !== offer.offerId));
  };

  const activeOrders = (orders ?? []).filter((order) =>
    ['EXPERT_ASSIGNED', 'ON_THE_WAY', 'INSPECTING', 'QUOTE_APPROVED', 'IN_PROGRESS', 'HANDOVER_OTP_PENDING'].includes(
      order.state,
    ),
  );

  // ── Role guard ─────────────────────────────────────────────────────────────
  if (!user || user.role !== 'TECHNICIAN') {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10 text-center">
        <div className="card space-y-3">
          <Radio size={28} className="mx-auto text-primary-400" />
          <p className="text-sm font-bold text-slate-700">پنل نصاب هومنتال</p>
          <p className="text-xs text-slate-500">
            این بخش ویژه تکنسین‌های احراز‌شده است. با شماره موبایل نصاب وارد شوید.
          </p>
          {!user ? (
            <p className="text-xs text-slate-400">از دکمه «ورود» در بالای صفحه استفاده کنید.</p>
          ) : (
            <p className="text-xs text-slate-400">نقش فعلی شما: نصاب نیست.</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 pb-16 pt-6">
      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}

      <header className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-primary-950">پنل نصاب</h1>
        <span
          className={`chip text-xs font-bold ${connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}
        >
          <Radio size={13} className={connected ? 'animate-pulse' : ''} />
          {connected ? 'متصل زنده' : 'قطع'}
        </span>
      </header>

      {/* ── Online/Offline & Location Control Bar ── */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleOnline}
              disabled={!coords}
              className={`relative h-8 w-14 rounded-full transition-colors ${
                isOnline ? 'bg-emerald-500' : 'bg-slate-300'
              } ${!coords ? 'opacity-50' : ''}`}
              aria-label={isOnline ? 'آفلاین شدن' : 'آنلاین شدن'}
            >
              <span
                className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${
                  isOnline ? 'right-1' : 'right-7'
                }`}
              />
              <Power
                size={14}
                className={`absolute top-2 ${isOnline ? 'right-2.5 text-emerald-600' : 'right-8.5 text-slate-400'}`}
              />
            </button>
            <div>
              <p className="text-sm font-extrabold text-slate-800">
                {isOnline ? 'آنلاین — آماده دریافت سفارش' : 'آفلاین'}
              </p>
              <p className="text-[11px] text-slate-500">
                {coords
                  ? `موقعیت: ${toPersianDigits(coords.lat.toFixed(4))} ، ${toPersianDigits(coords.lng.toFixed(4))}`
                  : 'ابتدا موقعیت را انتخاب کنید'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={useGeolocation}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:border-primary-300"
          >
            <Navigation size={13} />
            موقعیت من
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {MASHHAD_PRESETS.map((preset) => (
            <button
              key={preset.nameFa}
              type="button"
              onClick={() => void setPreset(preset.lat, preset.lng)}
              className={`chip border text-xs ${
                coords?.lat === preset.lat
                  ? 'border-primary-600 bg-primary-50 text-primary-800'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              <MapPin size={12} />
              {preset.nameFa}
            </button>
          ))}
        </div>
      </section>

      {/* ── Live offers tray ── */}
      {offers.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-800">
            <Radio size={18} className="animate-pulse text-emerald-500" />
            پیشنهادهای زنده ({toPersianDigits(offers.length)})
          </h2>
          {offers.map((offer) => (
            <div
              key={offer.offerId}
              className="rounded-2xl border-2 border-emerald-400 bg-white p-4 shadow-card"
            >
              <div className="mb-2 flex items-center justify-between">
                <p className="flex items-center gap-2 font-extrabold text-slate-800">
                  {offer.orderNumber}
                  <span className="chip bg-emerald-50 text-[11px] text-emerald-700">
                    <BadgeCheck size={12} />
                    امتیاز {toPersianDigits(offer.score)}
                  </span>
                </p>
                <button type="button" onClick={() => declineOffer(offer)} aria-label="رد کردن">
                  <X size={16} className="text-slate-400" />
                </button>
              </div>
              <CountdownBar receivedAt={offer.receivedAt} ttlMs={offer.expiresInMs} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => acceptOffer(offer)}
                  className="rounded-xl bg-emerald-600 py-2.5 text-sm font-extrabold text-white hover:bg-emerald-700"
                >
                  پذیرش سفارش
                </button>
                <button
                  type="button"
                  onClick={() => declineOffer(offer)}
                  className="rounded-xl border border-slate-200 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
                >
                  رد کردن
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {/* ── Active jobs ── */}
      <section className="space-y-4">
        <h2 className="text-base font-extrabold text-slate-800">سفارش‌های فعال من</h2>
        {activeOrders.length === 0 ? (
          <p className="card text-center text-sm text-slate-500">
            سفارش فعالی ندارید — با آنلاین شدن، سفارش‌های نزدیک شما ارسال می‌شود.
          </p>
        ) : null}
        {activeOrders.map((order) => {
          const busy = busyId === order.id;
          const err = actionError[order.id];
          return (
            <section key={order.id} className="card space-y-3">
              <header className="flex items-center justify-between">
                <p className="font-extrabold text-slate-800">{order.orderNumber}</p>
                <StateBadge state={order.state} />
              </header>
              {err ? <p className="rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-600">{err}</p> : null}

              {order.state === 'EXPERT_ASSIGNED' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runAction(order.id, () => api.enRoute(order.id))}
                  className="btn-primary w-full"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : 'شروع حرکت'}
                </button>
              ) : null}

              {order.state === 'ON_THE_WAY' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runAction(order.id, () => api.startInspection(order.id))}
                  className="btn-primary w-full"
                >
                  رسیدم — شروع کارشناسی
                </button>
              ) : null}

              {order.state === 'INSPECTING' ? (
                <div className="space-y-2">
                  <input
                    dir="ltr"
                    type="number"
                    value={quoteDrafts[order.id] ?? ''}
                    onChange={(event) =>
                      setQuoteDrafts((prev) => ({ ...prev, [order.id]: event.target.value }))
                    }
                    placeholder="مبلغ پیش‌فاکتور نهایی (تومان)"
                    className="tabular-fa w-full rounded-xl border border-slate-200 px-4 py-2.5 text-left font-bold focus:border-primary-400 focus:outline-none"
                  />
                  {quoteDrafts[order.id] ? (
                    <p className="text-left text-xs font-bold text-primary-700">
                      {formatToman(quoteDrafts[order.id])}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy || Number(quoteDrafts[order.id]) <= 0}
                    onClick={() =>
                      runAction(order.id, () => api.quote(order.id, Number(quoteDrafts[order.id])))
                    }
                    className="btn-primary w-full"
                  >
                    ثبت پیش‌فاکتور نهایی
                  </button>
                </div>
              ) : null}

              {order.state === 'QUOTE_APPROVED' ? (
                <p className="rounded-xl bg-indigo-50 p-3 text-xs font-bold text-indigo-700">
                  مشتری پیش‌فاکتور را تأیید و مبلغ در اسکرو مسدود شد.
                </p>
              ) : null}

              {order.state === 'QUOTE_APPROVED' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runAction(order.id, () => api.startWork(order.id))}
                  className="btn-primary w-full"
                >
                  شروع نصب و اجرا
                </button>
              ) : null}

              {order.state === 'IN_PROGRESS' ? (
                <div className="space-y-3">
                  {/* Serial registration per FULL_PACKAGE item */}
                  <p className="text-xs font-bold text-slate-700">ثبت شماره سریال تجهیزات:</p>
                  {(order.items ?? []).map((item) => {
                    const effective = item.supplyMode ?? order.supplyMode ?? 'FULL_PACKAGE';
                    if (effective === 'INSTALL_ONLY') {
                      return (
                        <p key={item.id} className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                          {item.serviceDefinition?.titleFa} — کالای مشتری (بدون نیاز به سریال)
                        </p>
                      );
                    }
                    return (
                      <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                        <p className="mb-2 text-xs font-bold text-slate-700">
                          {item.serviceDefinition?.titleFa}
                        </p>
                        <input
                          dir="ltr"
                          value={serialDrafts[order.id]?.[item.id] ?? ''}
                          onChange={(event) =>
                            setSerialDrafts((prev) => ({
                              ...prev,
                              [order.id]: { ...(prev[order.id] ?? {}), [item.id]: event.target.value },
                            }))
                          }
                          placeholder="شماره سریال دستگاه"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs focus:border-primary-400 focus:outline-none"
                        />
                      </div>
                    );
                  })}

                  {/* Mandatory privacy checklist */}
                  <div className="space-y-2 rounded-xl bg-amber-50 p-3">
                    <p className="text-xs font-extrabold text-amber-800">چک‌لیست الزامی حریم خصوصی:</p>
                    {[
                      { key: 'passwords' as const, label: 'تمام رمزهای پیش‌فرض دستگاه‌ها مقابل چشم مشتری تغییر داده شد' },
                      { key: 'access' as const, label: 'دسترسی فنی نصاب به‌طور کامل حذف شد' },
                    ].map((item) => {
                      const checked = checklist[order.id]?.[item.key] ?? false;
                      return (
                        <label key={item.key} className="flex items-start gap-2 text-xs text-amber-900">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setChecklist((prev) => ({
                                ...prev,
                                [order.id]: {
                                  passwords: item.key === 'passwords' ? event.target.checked : (prev[order.id]?.passwords ?? false),
                                  access: item.key === 'access' ? event.target.checked : (prev[order.id]?.access ?? false),
                                },
                              }))
                            }
                            className="mt-0.5"
                          />
                          {item.label}
                        </label>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    disabled={
                      busy ||
                      !(checklist[order.id]?.passwords && checklist[order.id]?.access) ||
                      (order.items ?? []).some(
                        (item) =>
                          (item.supplyMode ?? order.supplyMode ?? 'FULL_PACKAGE') === 'FULL_PACKAGE' &&
                          !(serialDrafts[order.id]?.[item.id] ?? '').trim(),
                      )
                    }
                    onClick={() =>
                      runAction(order.id, () =>
                        api
                          .registerHardwareUnits(
                            order.id,
                            (order.items ?? [])
                              .filter(
                                (item) =>
                                  (item.supplyMode ?? order.supplyMode ?? 'FULL_PACKAGE') === 'FULL_PACKAGE' &&
                                  (serialDrafts[order.id]?.[item.id] ?? '').trim(),
                              )
                              .map((item) => ({
                                orderItemId: item.id,
                                categoryFa: item.serviceDefinition?.titleFa ?? 'تجهیزات',
                                serialNumber: serialDrafts[order.id]?.[item.id] ?? '',
                              })),
                          )
                          .then(() =>
                            api.requestHandover(order.id, checklist[order.id]?.passwords ?? false, checklist[order.id]?.access ?? false),
                          )
                          .then((result) => {
                            if (result.devHandoverOtp) {
                              setDevOtp((prev) => ({ ...prev, [order.id]: result.devHandoverOtp as string }));
                            }
                          }),
                      )
                    }
                    className="btn-primary w-full"
                  >
                    صدور کد تحویل (OTP) برای مشتری
                  </button>
                  {devOtp[order.id] ? (
                    <p className="rounded-xl bg-amber-50 p-3 text-center text-xs font-bold text-amber-700">
                      حالت توسعه — کد تحویل: <span className="tabular-fa font-extrabold">{devOtp[order.id]}</span>
                    </p>
                  ) : null}
                </div>
              ) : null}

              {order.state === 'HANDOVER_OTP_PENDING' ? (
                <div className="space-y-3">
                  <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
                    کد ۶ رقمی را از مشتری دریافت و وارد کنید.
                  </p>
                  <input
                    dir="ltr"
                    inputMode="numeric"
                    value={otpDrafts[order.id] ?? ''}
                    onChange={(event) => setOtpDrafts((prev) => ({ ...prev, [order.id]: event.target.value }))}
                    placeholder="کد ۶ رقمی مشتری"
                    className="tabular-fa w-full rounded-xl border border-slate-200 px-4 py-3 text-center text-lg font-extrabold tracking-widest focus:border-primary-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy || (otpDrafts[order.id] ?? '').length !== 6}
                    onClick={() =>
                      runAction(order.id, () => api.completeHandover(order.id, otpDrafts[order.id]))
                    }
                    className="btn-primary w-full"
                  >
                    تکمیل تحویل، فعال‌سازی ضمانت و تسویه
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      runAction(order.id, () =>
                        api.resendHandoverOtp(order.id).then((result) => {
                          if (result.devHandoverOtp) {
                            setDevOtp((prev) => ({ ...prev, [order.id]: result.devHandoverOtp as string }));
                          }
                        }),
                      )
                    }
                    className="w-full rounded-xl border border-slate-200 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    ارسال مجدد کد تحویل به مشتری
                  </button>
                </div>
              ) : null}

              <p className="text-[10px] text-slate-400">
                وضعیت: {STATE_LABELS[order.state]?.labelFa ?? order.state}
                {order.finalQuoteAmount ? ` — پیش‌فاکتور: ${formatToman(order.finalQuoteAmount)}` : ''}
              </p>
            </section>
          );
        })}
      </section>

      <p className="rounded-xl bg-slate-50 p-4 text-center text-[11px] leading-6 text-slate-400">
        <ShieldCheck size={13} className="inline text-emerald-500" /> پس از تکمیل تحویل، گارانتی
        دیجیتال مشتری فعال و تسویه اسکرو به‌صورت خودکار انجام می‌شود.
      </p>
    </main>
  );
}
