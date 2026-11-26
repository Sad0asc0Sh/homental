'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BadgeCheck,
  Loader2,
  LogIn,
  MapPin,
  Navigation,
  Power,
  Radio,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AuthModal } from '@/components/brief/AuthModal';
import { MeterReadingsForm } from '@/components/orders/MeterReadingsForm';
import { StateBadge } from '@/components/orders/order-state';
import { api, ApiError, type DispatchOfferView, type TechnicianMe, type TechnicianOrderRow } from '@/lib/api';
import { formatMeters, formatToman, toLatinDigits, toPersianDigits } from '@/lib/format';
import {
  parseNotificationPayload,
  useDispatchSocket,
  type DispatchEventPayloads,
} from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';

const MASHHAD_PRESETS = [
  { nameFa: 'وکیل‌آباد', lat: 36.3105, lng: 59.5663 },
  { nameFa: 'احمدآباد', lat: 36.2873, lng: 59.6123 },
  { nameFa: 'سجاد', lat: 36.3018, lng: 59.5838 },
];

interface LiveOffer extends DispatchOfferView {
  receivedAt: number;
}

interface SerialDraft {
  serialNumber: string;
  brand: string;
  model: string;
}

interface PendingSerial {
  key: string;
  orderItemId: string;
  orderAddonId?: string;
  categoryFa: string;
  titleFa: string;
}

const EMPTY_SERIAL: SerialDraft = { serialNumber: '', brand: '', model: '' };
const MANAGED_PRICING_VERSION = 2;

function PackageNet({ amount }: { amount: string | null }) {
  return amount !== null ? (
    <div className="flex flex-wrap justify-between gap-1 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
      <span>دریافتی تضمین‌شده بسته اجرا</span>
      <span className="tabular-fa">{formatToman(amount, 'full')}</span>
    </div>
  ) : null;
}

function CountdownBar({
  receivedAt,
  ttlMs,
  onExpire,
}: {
  receivedAt: number;
  ttlMs: number;
  onExpire: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = Math.max(0, ttlMs - (now - receivedAt));
  const seconds = Math.ceil(remaining / 1000);
  const percent = ttlMs > 0 ? Math.min(100, (remaining / ttlMs) * 100) : 0;

  useEffect(() => {
    if (remaining <= 0) onExpire();
  }, [remaining, onExpire]);

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
    const timer = window.setTimeout(onClose, 4000);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  return (
    <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-lg">
      {message}
    </div>
  );
}

export default function TechnicianPage() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const logout = useAuthStore((s) => s.logout);

  const [authOpen, setAuthOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [isAcceptingOffers, setIsAcceptingOffers] = useState(true);
  const [techStats, setTechStats] = useState<TechnicianMe | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number }>(MASHHAD_PRESETS[0]);
  const [offers, setOffers] = useState<LiveOffer[]>([]);
  const offersRequest = useRef(0);
  const ordersRequest = useRef(0);
  const [orders, setOrders] = useState<TechnicianOrderRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [offerBusyId, setOfferBusyId] = useState<string | null>(null);
  const [otpDrafts, setOtpDrafts] = useState<Record<string, string>>({});
  const [serialDrafts, setSerialDrafts] = useState<Record<string, Record<string, SerialDraft>>>({});
  const [registeredLegacyOrders, setRegisteredLegacyOrders] = useState<Record<string, boolean>>({});
  const [checklist, setChecklist] = useState<Record<string, { passwords: boolean; access: boolean }>>({});
  const [devOtp, setDevOtp] = useState<Record<string, string>>({});
  const [resendUnlockAt, setResendUnlockAt] = useState<Record<string, number>>({});
  const [nowSec, setNowSec] = useState(() => Date.now());
  const [actionError, setActionError] = useState<Record<string, string>>({});

  useEffect(() => {
    const hasPendingCooldown = Object.values(resendUnlockAt).some((until) => until > Date.now());
    if (!hasPendingCooldown) return;
    const timer = window.setInterval(() => setNowSec(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendUnlockAt]);

  const reloadOrders = useCallback(() => {
    if (!accessToken || user?.role !== 'TECHNICIAN') return;
    const request = ++ordersRequest.current;
    setRefreshing(true);
    api.orders<TechnicianOrderRow>()
      .then((page) => { if (request === ordersRequest.current) setOrders(page.items); })
      .catch(() => { if (request === ordersRequest.current) setOrders([]); })
      .finally(() => { if (request === ordersRequest.current) setRefreshing(false); });
  }, [accessToken, user?.role]);

  const reloadOffers = useCallback(() => {
    if (!accessToken || user?.role !== 'TECHNICIAN') return;
    const request = ++offersRequest.current;
    void api.dispatchOffers().then((rows) => {
      if (request === offersRequest.current) {
        const receivedAt = Date.now();
        setOffers(rows.map((offer) => ({ ...offer, receivedAt })));
      }
    }).catch(() => undefined);
  }, [accessToken, user?.role]);

  useEffect(() => {
    if (!accessToken || user?.role !== 'TECHNICIAN') {
      offersRequest.current++;
      ordersRequest.current++;
      setOrders(null);
      setOffers([]);
      setIsOnline(false);
      setTechStats(null);
      return;
    }
    reloadOrders();
    reloadOffers();
    api.dispatchMe()
      .then((me) => {
        setTechStats(me);
        setIsOnline(me.isOnline);
        setIsAcceptingOffers(me.isAcceptingOffers);
        if (me.lastKnownLat !== null && me.lastKnownLng !== null) {
          setCoords({ lat: me.lastKnownLat, lng: me.lastKnownLng });
        }
      })
      .catch(() => undefined);
  }, [accessToken, user?.role, reloadOrders, reloadOffers]);

  const runAction = useCallback(
    async (orderId: string, action: () => Promise<unknown>) => {
      setBusyId(orderId);
      setActionError((prev) => ({ ...prev, [orderId]: '' }));
      try {
        await action();
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 429) {
          const retryAfter = Number(error.payload?.retryAfterSeconds ?? 60);
          setResendUnlockAt((prev) => ({ ...prev, [orderId]: Date.now() + retryAfter * 1000 }));
        }
        setActionError((prev) => ({
          ...prev,
          [orderId]: error instanceof ApiError ? error.message : 'خطا در انجام عملیات.',
        }));
      } finally {
        reloadOrders();
        setBusyId(null);
      }
    },
    [reloadOrders],
  );

  const toggleOnline = async () => {
    const nextOnline = !isOnline;
    const nextAccepting = nextOnline ? true : false;
    setStatusBusy(true);
    try {
      const result = await api.dispatchStatus({
        isOnline: nextOnline,
        isAcceptingOffers: nextAccepting,
        lat: coords.lat,
        lng: coords.lng,
      });
      setIsOnline(result.isOnline);
      setIsAcceptingOffers(result.isAcceptingOffers);
      reloadOffers();
      setToast(result.isOnline ? 'وضعیت شما آنلاین شد' : 'وضعیت شما آفلاین شد');
    } catch (error) {
      setToast(error instanceof ApiError ? error.message : 'خطا در تغییر وضعیت.');
    } finally {
      setStatusBusy(false);
    }
  };

  const toggleAcceptingOffers = async () => {
    if (!isOnline) return;
    const nextAccepting = !isAcceptingOffers;
    setStatusBusy(true);
    try {
      const result = await api.dispatchStatus({
        isOnline: true,
        isAcceptingOffers: nextAccepting,
        lat: coords.lat,
        lng: coords.lng,
      });
      setIsAcceptingOffers(result.isAcceptingOffers);
      reloadOffers();
    } catch (error) {
      setToast(error instanceof ApiError ? error.message : 'خطا در تغییر وضعیت دریافت پیشنهاد.');
    } finally {
      setStatusBusy(false);
    }
  };

  const setPreset = async (lat: number, lng: number) => {
    setCoords({ lat, lng });
    if (isOnline) {
      await api.dispatchLocation({ lat, lng }).catch(() => undefined);
    }
  };

  const useGeolocation = () => {
    if (!navigator.geolocation) {
      setToast('مرورگر از موقعیت مکانی پشتیبانی نمی‌کند؛ از گزینه‌های آماده استفاده کنید.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void setPreset(position.coords.latitude, position.coords.longitude);
        setToast('موقعیت مکانی شما بروزرسانی شد');
      },
      () => setToast('دسترسی موقعیت مکانی رد شد؛ از مختصات پیش‌فرض استفاده کنید.'),
    );
  };

  // 30s location ping while online
  useEffect(() => {
    if (!isOnline || !accessToken || user?.role !== 'TECHNICIAN') return;
    const intervalId = window.setInterval(() => {
      void api.dispatchLocation({ lat: coords.lat, lng: coords.lng }).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, [isOnline, coords.lat, coords.lng, accessToken, user?.role]);

  const onOfferTaken = useCallback((payload: DispatchEventPayloads['OFFER_TAKEN']) => {
    setOffers((prev) => prev.filter((offer) => offer.orderId !== payload.orderId));
    setToast('سفارش توسط کارشناس دیگری پذیرفته شد');
    reloadOffers();
  }, [reloadOffers]);

  const { connected } = useDispatchSocket(user?.role === 'TECHNICIAN' ? accessToken : null, {
    DISPATCH_OFFER: reloadOffers,
    OFFER_TAKEN: onOfferTaken,
    EXPERT_ASSIGNED: () => reloadOrders(),
    METERED_ADJUSTMENT_CHANGED: () => reloadOrders(),
    notification: ({ raw }) => {
      const parsed = parseNotificationPayload(raw);
      if (parsed?.titleFa) {
        setToast(parsed.titleFa);
      }
      reloadOrders();
    },
  });

  useEffect(() => {
    if (connected) {
      reloadOffers();
      reloadOrders();
    }
  }, [connected, reloadOffers, reloadOrders]);

  const acceptOffer = async (offer: LiveOffer) => {
    setOfferBusyId(offer.offerId);
    try {
      await api.acceptOffer(offer.offerId);
      setOffers((prev) => prev.filter((o) => o.orderId !== offer.orderId));
      setToast(`سفارش ${offer.orderNumber} به شما اختصاص یافت!`);
      reloadOrders();
    } catch (error) {
      setToast(error instanceof ApiError ? error.message : 'خطا در پذیرش سفارش.');
    } finally {
      reloadOffers();
      setOfferBusyId(null);
    }
  };

  const declineOffer = async (offer: LiveOffer) => {
    setOfferBusyId(offer.offerId);
    try {
      await api.declineOffer(offer.offerId);
      setOffers((prev) => prev.filter((o) => o.offerId !== offer.offerId));
    } catch (error) {
      setToast(error instanceof ApiError ? error.message : 'خطا در رد پیشنهاد.');
    } finally {
      reloadOffers();
      setOfferBusyId(null);
    }
  };

  const expireOffer = useCallback((offerId: string) => {
    setOffers((prev) => prev.filter((o) => o.offerId !== offerId));
  }, []);

  const activeOrders = (orders ?? []).filter((order) =>
    ['EXPERT_ASSIGNED', 'ON_THE_WAY', 'INSPECTING', 'QUOTE_APPROVED', 'IN_PROGRESS', 'HANDOVER_OTP_PENDING'].includes(
      order.state,
    ),
  );

  const updateSerialField = (
    orderId: string,
    itemId: string,
    field: keyof SerialDraft,
    value: string,
  ) => {
    setSerialDrafts((prev) => {
      const currentOrder = prev[orderId] ?? {};
      const currentItem = currentOrder[itemId] ?? EMPTY_SERIAL;
      return {
        ...prev,
        [orderId]: {
          ...currentOrder,
          [itemId]: { ...currentItem, [field]: value },
        },
      };
    });
  };

  if (!hasHydrated) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10">
        <div className="card flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="animate-spin" size={24} />
        </div>
      </main>
    );
  }

  // ── Role guard ─────────────────────────────────────────────────────────────
  if (!user || user.role !== 'TECHNICIAN') {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10 text-center">
        <div className="card space-y-4">
          <Radio size={28} className="mx-auto text-primary-500" />
          <p className="text-base font-extrabold text-slate-800">پنل نصاب هومنتال</p>
          <p className="text-xs leading-6 text-slate-500">
            این بخش ویژه تکنسین‌های احراز‌شده است. با شماره موبایل نصاب وارد شوید.
          </p>
          {!user ? (
            <button type="button" onClick={() => setAuthOpen(true)} className="btn-primary mx-auto">
              <LogIn size={16} />
              ورود با شماره موبایل نصاب
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-bold text-red-600">
                نقش فعلی شما ({user.role}) دسترسی به پنل نصاب ندارد.
              </p>
              <button type="button" onClick={logout} className="btn-ghost mx-auto text-xs">
                خروج و ورود با حساب نصاب
              </button>
            </div>
          )}
        </div>
        {authOpen ? <AuthModal onDone={() => setAuthOpen(false)} /> : null}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 pb-16 pt-6">
      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}

      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-primary-950">پنل نصاب</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { reloadOrders(); reloadOffers(); }}
            disabled={refreshing}
            className="btn-ghost !px-3 !py-1.5 text-xs"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            بروزرسانی
          </button>
          <span
            className={`chip text-xs font-bold ${
              connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'
            }`}
          >
            <Radio size={13} className={connected ? 'animate-pulse' : ''} />
            {connected ? 'متصل زنده' : 'قطع'}
          </span>
        </div>
      </header>

      {/* ── Online/Offline & Location Control Bar ── */}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleOnline}
              disabled={statusBusy}
              className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${
                isOnline ? 'bg-emerald-500' : 'bg-slate-300'
              } disabled:opacity-60`}
              aria-label={isOnline ? 'آفلاین شدن' : 'آنلاین شدن'}
            >
              <span
                className={`absolute top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-all ${
                  isOnline ? 'right-1 text-emerald-600' : 'left-1 text-slate-400'
                }`}
              >
                <Power size={13} />
              </span>
            </button>
            <div>
              <p className="text-sm font-extrabold text-slate-800">
                {isOnline ? 'آنلاین — آماده دریافت سفارش' : 'آفلاین'}
              </p>
              <p className="tabular-fa text-[11px] text-slate-500" dir="ltr">
                {toPersianDigits(coords.lat.toFixed(4))}, {toPersianDigits(coords.lng.toFixed(4))}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isOnline ? (
              <button
                type="button"
                onClick={toggleAcceptingOffers}
                disabled={statusBusy}
                className={`chip border text-xs font-bold ${
                  isAcceptingOffers
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-amber-300 bg-amber-50 text-amber-700'
                }`}
              >
                {isAcceptingOffers ? 'پذیرش پیشنهاد: فعال' : 'پذیرش پیشنهاد: متوقف'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={useGeolocation}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:border-primary-300"
            >
              <Navigation size={13} />
              موقعیت من
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {MASHHAD_PRESETS.map((preset) => (
            <button
              key={preset.nameFa}
              type="button"
              onClick={() => void setPreset(preset.lat, preset.lng)}
              className={`chip border text-xs ${
                coords.lat === preset.lat && coords.lng === preset.lng
                  ? 'border-primary-600 bg-primary-50 font-bold text-primary-800'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              <MapPin size={12} />
              {preset.nameFa}
            </button>
          ))}
        </div>
        {techStats ? (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-2.5 text-[11px]">
            <span className="chip bg-slate-50 font-bold text-slate-700">
              ⭐ {toPersianDigits(techStats.rating.toFixed(1))} ({toPersianDigits(techStats.ratingCount)} نظر)
            </span>
            <span className="chip bg-slate-50 font-bold text-slate-700">
              نصب موفق: {toPersianDigits(techStats.completedJobs)}
            </span>
            <span className="chip bg-slate-50 font-bold text-slate-700">
              نرخ خرابی ضمانت: {toPersianDigits((techStats.warrantyClaimRate * 100).toFixed(1))}٪
            </span>
          </div>
        ) : null}
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
                  {offer.isBranchInvite ? (
                    <span className="chip bg-purple-50 text-[11px] text-purple-700">دعوت‌نامه شعبه</span>
                  ) : (
                    <span className="chip bg-emerald-50 text-[11px] text-emerald-700">
                      <BadgeCheck size={12} />
                      امتیاز {toPersianDigits(offer.score)}
                    </span>
                  )}
                </p>
                <button type="button" disabled={offerBusyId !== null} onClick={() => void declineOffer(offer)} aria-label="رد کردن">
                  <X size={16} className="text-slate-400" />
                </button>
              </div>
              <div className="space-y-2">
                <PackageNet amount={offer.guaranteedPackageNet} />
                <CountdownBar
                  receivedAt={offer.receivedAt}
                  ttlMs={offer.expiresInMs}
                  onExpire={() => expireOffer(offer.offerId)}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={offerBusyId !== null}
                  onClick={() => void acceptOffer(offer)}
                  className="rounded-xl bg-emerald-600 py-2.5 text-sm font-extrabold text-white hover:bg-emerald-700"
                >
                  {offerBusyId === offer.offerId ? 'در حال بررسی…' : 'پذیرش سفارش'}
                </button>
                <button
                  type="button"
                  disabled={offerBusyId !== null}
                  onClick={() => void declineOffer(offer)}
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
          const isManaged = order.pricingVersion === MANAGED_PRICING_VERSION;
          const pendingSerials: PendingSerial[] = isManaged ? order.serialsRequired.flatMap((line) => {
            const { orderItemId } = line;
            if (!orderItemId) return [];
            return Array.from({ length: Math.max(0, line.qty - line.registeredQty) }, (_, index) => {
              const unit = line.registeredQty + index + 1;
              return {
                key: `${line.orderAddonId}:${unit}`,
                orderItemId,
                orderAddonId: line.orderAddonId,
                categoryFa: line.titleFa,
                titleFa: line.qty > 1 ? `${line.titleFa} — دستگاه ${toPersianDigits(unit)}` : line.titleFa,
              };
            });
          }) : order.tasks.flatMap((task) => task.supplyMode === 'FULL_PACKAGE' && !registeredLegacyOrders[order.id] ? [{
            key: task.orderItemId,
            orderItemId: task.orderItemId,
            categoryFa: task.titleFa,
            titleFa: task.titleFa,
          }] : []);
          const serialsValid = pendingSerials.every(({ key }) =>
            (serialDrafts[order.id]?.[key]?.serialNumber ?? '').trim().length >= 4,
          );
          const checklistReady = Boolean(checklist[order.id]?.passwords && checklist[order.id]?.access);
          const meteredLines = order.meteredLines ?? [];
          const latest = order.latestAdjustment ?? null;
          const pending = order.pendingAdjustment ?? null;
          const meterReady = !pending && (meteredLines.length === 0 || (
            (latest?.status === 'APPROVED' || latest?.status === 'AUTO_REFUNDED') &&
            latest.resultingRevision === order.activeRevision
          ));
          const otpClean = toLatinDigits(otpDrafts[order.id] ?? '').replace(/\D/g, '');
          const cooldownRemaining = Math.max(
            0,
            Math.ceil(((resendUnlockAt[order.id] ?? 0) - nowSec) / 1000),
          );

          return (
            <section key={order.id} className="card space-y-3">
              <header className="flex items-center justify-between">
                <p className="font-extrabold text-slate-800">{order.orderNumber}</p>
                <StateBadge state={order.state} />
              </header>
              <PackageNet amount={order.agreedPackageNet} />
              {order.address ? (
                <p className="flex items-start gap-2 text-xs text-slate-600">
                  <MapPin size={14} className="shrink-0 text-primary-700" />
                  {order.address.fullAddressFa}
                </p>
              ) : null}
              {order.tasks.length ? (
                <ul className="flex flex-wrap gap-1.5 text-xs text-slate-600" aria-label="خدمات سفارش">
                  {order.tasks.map((task) => <li key={task.orderItemId} className="chip bg-slate-50">{task.titleFa}</li>)}
                </ul>
              ) : null}
              {order.state === 'INSPECTING' && order.materials.length > 0 ? (
                <details className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                  <summary className="cursor-pointer font-bold text-slate-700">تجهیزات توافق‌شده</summary>
                  <ul className="mt-2 space-y-1">
                    {order.materials.map(({ id, titleFa, unit, qty, quantityCm }) => (
                      <li key={id}>{titleFa}، {quantityCm != null ? formatMeters(quantityCm) : `${toPersianDigits(qty)} ${unit === 'METER' ? 'متر' : 'عدد'}`}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
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
                  {busy ? <Loader2 size={15} className="animate-spin" /> : 'رسیدم / شروع کارشناسی'}
                </button>
              ) : null}

              {order.state === 'INSPECTING' && isManaged ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runAction(order.id, () => api.confirmInspectionScope(order.id, order.activeRevision))}
                  className="btn-primary w-full"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" /> : 'تأیید تطابق محل و شروع کار'}
                </button>
              ) : null}

              {order.state === 'QUOTE_APPROVED' ? (
                <div className="space-y-3">
                  <p className="rounded-xl bg-indigo-50 p-3 text-xs font-bold text-indigo-700">
                    {isManaged ? 'تطابق محل تأیید شده و سفارش آماده اجراست.' : 'مشتری پیش‌فاکتور را تأیید و مبلغ در اسکرو مسدود شد.'}
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => runAction(order.id, () => api.startWork(order.id))}
                    className="btn-primary w-full"
                  >
                    {busy ? <Loader2 size={15} className="animate-spin" /> : 'شروع نصب و اجرا'}
                  </button>
                </div>
              ) : null}

              {order.state === 'IN_PROGRESS' ? (
                <div className="space-y-3">
                  <MeterReadingsForm
                    key={`${order.activeRevision}:${latest?.id ?? ''}`}
                    orderId={order.id}
                    lines={meteredLines}
                    latest={latest}
                    pending={pending}
                    reconciled={meterReady}
                    busy={busy}
                    runAction={(action) => { void runAction(order.id, action); }}
                  />
                  {pendingSerials.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-slate-700">ثبت شماره سریال تجهیزات</p>
                      {pendingSerials.map(({ key, titleFa }) => {
                        const draft = serialDrafts[order.id]?.[key] ?? EMPTY_SERIAL;
                        return (
                          <fieldset key={key} className="space-y-2 rounded-lg border border-slate-200 p-3">
                            <legend className="px-1 text-xs font-bold text-slate-700">{titleFa}</legend>
                            <input
                              dir="ltr"
                              aria-label={`شماره سریال ${titleFa}`}
                              value={draft.serialNumber}
                              maxLength={80}
                              onChange={(event) =>
                                updateSerialField(order.id, key, 'serialNumber', event.target.value)
                              }
                              placeholder="شماره سریال دستگاه (حداقل ۴ کاراکتر)"
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs focus:border-primary-400 focus:outline-none"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                aria-label={`برند ${titleFa}`}
                                value={draft.brand}
                                maxLength={60}
                                onChange={(event) =>
                                  updateSerialField(order.id, key, 'brand', event.target.value)
                                }
                                placeholder="برند (اختیاری)"
                                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-primary-400 focus:outline-none"
                              />
                              <input
                                aria-label={`مدل ${titleFa}`}
                                value={draft.model}
                                maxLength={60}
                                onChange={(event) =>
                                  updateSerialField(order.id, key, 'model', event.target.value)
                                }
                                placeholder="مدل (اختیاری)"
                                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-primary-400 focus:outline-none"
                              />
                            </div>
                          </fieldset>
                        );
                      })}
                    </div>
                  ) : null}

                  {/* Mandatory privacy checklist */}
                  <div className="space-y-2 rounded-xl bg-amber-50 p-3">
                    <p className="text-xs font-extrabold text-amber-800">چک‌لیست الزامی حریم خصوصی:</p>
                    {[
                      {
                        key: 'passwords' as const,
                        label: 'تمام رمزهای پیش‌فرض دستگاه‌ها مقابل چشم مشتری تغییر داده شد',
                      },
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
                                  passwords:
                                    item.key === 'passwords'
                                      ? event.target.checked
                                      : (prev[order.id]?.passwords ?? false),
                                  access:
                                    item.key === 'access'
                                      ? event.target.checked
                                      : (prev[order.id]?.access ?? false),
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
                    disabled={busy || !checklistReady || !serialsValid || !meterReady}
                    onClick={() =>
                      runAction(order.id, async () => {
                        if (pendingSerials.length > 0) {
                          await api.registerHardwareUnits(
                            order.id,
                            pendingSerials.map(({ key, orderItemId, orderAddonId, categoryFa }) => {
                              const draft = serialDrafts[order.id]?.[key] ?? EMPTY_SERIAL;
                              return {
                                orderItemId,
                                orderAddonId,
                                categoryFa,
                                serialNumber: draft.serialNumber.trim(),
                                brand: draft.brand.trim() || undefined,
                                model: draft.model.trim() || undefined,
                              };
                            }),
                          );
                          if (isManaged) {
                            setOrders((prev) => prev?.map((row) => row.id === order.id ? {
                              ...row,
                              serialsRequired: row.serialsRequired.map((line) => ({ ...line, registeredQty: line.qty })),
                            } : row) ?? null);
                          } else {
                            setRegisteredLegacyOrders((prev) => ({ ...prev, [order.id]: true }));
                          }
                        }
                        const result = await api.requestHandover(
                          order.id,
                          checklist[order.id]?.passwords ?? false,
                          checklist[order.id]?.access ?? false,
                        );
                        if (result.devHandoverOtp) {
                          setDevOtp((prev) => ({ ...prev, [order.id]: result.devHandoverOtp as string }));
                        }
                        setResendUnlockAt((prev) => ({ ...prev, [order.id]: Date.now() + 60_000 }));
                      })
                    }
                    className="btn-primary w-full"
                  >
                    {busy ? <Loader2 size={15} className="animate-spin" /> : 'صدور کد تحویل (OTP) برای مشتری'}
                  </button>
                </div>
              ) : null}

              {order.state === 'HANDOVER_OTP_PENDING' ? (
                <div className="space-y-3">
                  <p className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
                    کد ۶ رقمی را از مشتری دریافت و وارد کنید.
                  </p>
                  {devOtp[order.id] ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-700 ring-1 ring-amber-200">
                      <span>
                        حالت توسعه — کد تحویل:{' '}
                        <span className="tabular-fa font-extrabold">{devOtp[order.id]}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setOtpDrafts((prev) => ({ ...prev, [order.id]: devOtp[order.id] }))
                        }
                        className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-amber-800 shadow-sm hover:bg-amber-100"
                      >
                        درج خودکار کد
                      </button>
                    </div>
                  ) : null}
                  <input
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={6}
                    value={otpDrafts[order.id] ?? ''}
                    onChange={(event) =>
                      setOtpDrafts((prev) => ({
                        ...prev,
                        [order.id]: toLatinDigits(event.target.value).replace(/\D/g, ''),
                      }))
                    }
                    placeholder="کد ۶ رقمی مشتری"
                    className="tabular-fa w-full rounded-xl border border-slate-200 px-4 py-3 text-center text-lg font-extrabold tracking-widest focus:border-primary-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy || otpClean.length !== 6}
                    onClick={() =>
                      runAction(order.id, async () => {
                        const completed = await api.completeHandover(order.id, otpClean);
                        setToast(
                          `سفارش تکمیل و گارانتی ${completed.warrantyPolicyNumber} فعال شد`,
                        );
                      })
                    }
                    className="btn-primary w-full"
                  >
                    {busy ? <Loader2 size={15} className="animate-spin" /> : 'تکمیل تحویل، فعال‌سازی ضمانت و تسویه'}
                  </button>
                  <button
                    type="button"
                    disabled={busy || cooldownRemaining > 0}
                    onClick={() =>
                      runAction(order.id, async () => {
                        const result = await api.resendHandoverOtp(order.id);
                        if (result.devHandoverOtp) {
                          setDevOtp((prev) => ({ ...prev, [order.id]: result.devHandoverOtp as string }));
                        }
                        setResendUnlockAt((prev) => ({ ...prev, [order.id]: Date.now() + 60_000 }));
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {cooldownRemaining > 0
                      ? `ارسال مجدد کد تحویل (${toPersianDigits(cooldownRemaining)} ثانیه)`
                      : 'ارسال مجدد کد تحویل'}
                  </button>
                </div>
              ) : null}

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
