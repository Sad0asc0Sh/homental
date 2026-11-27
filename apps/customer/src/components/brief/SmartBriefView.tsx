'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BadgeCheck, Building2, Loader2, MapPin } from 'lucide-react';
import { readinessColor } from '@/components/advisor/StickyLiveBar';
import { ESCROW_AT_SUBMIT, TransparentInvoice } from '@/components/orders/TransparentInvoice';
import { AuthModal } from './AuthModal';
import { api, ApiError } from '@homental/api-client';
import {
  formatNumberFa,
  formatToman,
  PROPERTY_TYPE_LABELS_FA,
  toPersianDigits,
  type CityDto,
  type CustomerPropertyView,
  type ManagedInvoice,
  type UrgencyLevel,
} from '@homental/shared';
import { useAdvisorStore } from '@/store/advisor.store';
import { useAuthStore } from '@/store/auth.store';

function matchesDisplayedInvoice(displayed: ManagedInvoice, frozen: ManagedInvoice) {
  if (displayed.total !== frozen.total || displayed.buckets.length !== frozen.buckets.length) return false;
  return displayed.buckets.every((bucket, index) => {
    const revised = frozen.buckets[index];
    if (
      !revised || revised.bucket !== bucket.bucket || revised.subtotal !== bucket.subtotal ||
      revised.lines.length !== bucket.lines.length
    ) return false;
    return bucket.lines.every((line, lineIndex) => {
      const updated = revised.lines[lineIndex];
      return updated?.lineKey === line.lineKey && updated.sku === line.sku && updated.titleFa === line.titleFa &&
        updated.qty === line.qty && updated.quantityCm === line.quantityCm && updated.unit === line.unit &&
        updated.unitPrice === line.unitPrice && updated.lineTotal === line.lineTotal;
    });
  });
}

const URGENCY_OPTIONS: Array<{ value: UrgencyLevel; labelFa: string }> = [
  { value: 'SCHEDULED', labelFa: 'زمان‌بندی عادی' },
  { value: 'SAME_DAY', labelFa: 'امروز' },
  { value: 'EMERGENCY', labelFa: 'فوری / اضطراری' },
];

function Scorecard() {
  const readiness = useAdvisorStore((s) => s.readiness);
  const smartBrief = useAdvisorStore((s) => s.smartBrief);
  const covered = smartBrief?.coveredPillars ?? [];
  const missing = smartBrief?.missingPillars ?? [];
  const PILLARS: Array<{ key: 'physical' | 'intrusion' | 'monitoring'; labelFa: string }> = [
    { key: 'physical', labelFa: 'موانع فیزیکی و سخت' },
    { key: 'intrusion', labelFa: 'هشدار نفوذ و سرقت' },
    { key: 'monitoring', labelFa: 'دیده‌بانی و ثبت تصویر' },
  ];
  return (
    <section className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-extrabold text-slate-800">کارنامه نیازسنجی امنیتی هومنتال</h2>
        <span className={`tabular-fa text-2xl font-extrabold ${readinessColor(readiness?.total ?? 0)}`}>
          {readiness?.total ?? 0}
          <span className="text-xs font-normal text-slate-400">/۱۰۰</span>
        </span>
      </div>
      <p className="text-sm font-bold text-primary-800">{readiness?.levelFa ?? '—'}</p>
      <div className="space-y-3">
        {PILLARS.map((pillar) => {
          const score = (readiness?.[pillar.key] as number | undefined) ?? 0;
          return (
            <div key={pillar.key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-bold text-slate-600">{pillar.labelFa}</span>
                <span className="tabular-fa text-slate-500">{formatNumberFa(score)}/۱۰۰</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-primary-700 transition-all duration-500" style={{ width: `${score}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {covered.map((pillar) => (
          <span key={pillar} className="chip bg-emerald-50 text-emerald-700">
            <BadgeCheck size={13} />
            پوشش داده‌شده
          </span>
        ))}
        {missing.map((pillar) => (
          <span key={pillar} className="chip bg-red-50 text-red-600">بدون پوشش</span>
        ))}
      </div>
    </section>
  );
}

function UrgencySelector() {
  const urgency = useAdvisorStore((s) => s.urgency);
  const setUrgency = useAdvisorStore((s) => s.setUrgency);
  return (
    <div className="card space-y-2">
      <p className="text-sm font-bold text-slate-700">زمان‌بندی اعزام کارشناس</p>
      <div className="grid grid-cols-3 gap-2">
        {URGENCY_OPTIONS.map((option) => {
          const active = urgency === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setUrgency(option.value)}
              className={`rounded-xl border p-3 text-center text-xs font-bold transition-all ${
                active
                  ? 'border-primary-600 bg-primary-50 text-primary-800'
                  : 'border-slate-200 text-slate-600'
              }`}
            >
              {option.labelFa}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-5 text-slate-400">
        ضریب فوریت روی هزینه اجرای بسته اعمال می‌شود و تجهیزات با قیمت همکار محاسبه می‌شوند.
      </p>
    </div>
  );
}

function PricingBreakdown() {
  const pricing = useAdvisorStore((s) => s.pricing);
  return pricing ? <TransparentInvoice invoice={pricing.invoice} escrowNote={ESCROW_AT_SUBMIT} /> : null;
}

function formatSliderPercent(bps: number): string {
  return `${bps > 0 ? '+' : bps < 0 ? '−' : ''}${toPersianDigits(Math.abs(bps / 100))}٪`;
}

function BargainingControl() {
  const inputId = useId();
  const price = useAdvisorStore((s) => s.pricing);
  const sliderBps = useAdvisorStore((s) => s.sliderBps);
  const setSliderBps = useAdvisorStore((s) => s.setSliderBps);
  const isEvaluating = useAdvisorStore((s) => s.isEvaluating);
  const error = useAdvisorStore((s) => s.evaluateError);
  const evaluate = useAdvisorStore((s) => s.evaluate);
  const slider = price?.slider;
  if (!slider) return null;

  const { minDeltaBps, maxDeltaBps, priorityThresholdBps, packageBaseAmount } = slider;
  const standard = BigInt(packageBaseAmount);
  const selected = standard * BigInt(10_000 + sliderBps) / BigInt(10_000);
  const priority = sliderBps >= priorityThresholdBps;

  return (
    <section className="card space-y-3" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-base font-extrabold text-slate-800">تنظیم قیمت بسته اجرا</label>
        <output htmlFor={inputId} className="tabular-fa rounded-full bg-primary-50 px-3 py-1 text-sm font-extrabold text-primary-900">
          <bdi dir="ltr">{formatSliderPercent(sliderBps)}</bdi>
        </output>
      </div>
      <input
        id={inputId}
        type="range"
        dir="rtl"
        min={minDeltaBps / 100}
        max={maxDeltaBps / 100}
        step={1}
        value={sliderBps / 100}
        aria-valuetext={formatSliderPercent(sliderBps)}
        aria-describedby={`${inputId}-note ${inputId}-tier`}
        onChange={(event) => setSliderBps(Number(event.target.value) * 100)}
        className="w-full cursor-pointer accent-primary-700"
      />
      <div className="flex justify-between text-xs text-slate-500" aria-hidden="true">
        <bdi dir="ltr">{formatSliderPercent(minDeltaBps)}</bdi>
        <bdi dir="ltr">{formatSliderPercent(maxDeltaBps)}</bdi>
      </div>
      <p id={`${inputId}-note`} className="text-xs leading-6 text-slate-600">
        قیمت تجهیزات ثابت و به نرخ همکار است؛ این نوار فقط بسته اجرا، لجستیک و ضمانت را تنظیم می‌کند.
      </p>
      <div className="space-y-1" aria-live="polite">
        {sliderBps < 0 ? (
          <span className="chip bg-emerald-50 text-xs font-bold text-emerald-800">{formatToman((standard - selected).toString(), 'full')} صرفه‌جویی</span>
        ) : priority ? (
          <span className="chip bg-primary-50 text-xs font-bold text-primary-800">اولویت اعزام <bdi dir="ltr">{formatSliderPercent(sliderBps)}</bdi></span>
        ) : null}
        <p id={`${inputId}-tier`} className="text-xs font-bold leading-6 text-slate-700">
          {priority ? 'اولویت با نصاب‌های برتر' : 'باز برای نصاب‌های محبوب و تازه‌کار — اولویت با اولین تأیید'}
        </p>
        {isEvaluating ? <p className="text-xs text-slate-500">در حال به‌روزرسانی پیش‌فاکتور…</p> : null}
      </div>
      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-700">
          <p>{error}</p>
          <button type="button" className="font-extrabold" onClick={() => void evaluate()}>تلاش دوباره</button>
        </div>
      ) : null}
    </section>
  );
}

function OrderBridge() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const locationType = useAdvisorStore((s) => s.locationType);
  const selected = useAdvisorStore((s) => s.selected);
  const urgency = useAdvisorStore((s) => s.urgency);
  const sliderBps = useAdvisorStore((s) => s.sliderBps);
  const pricing = useAdvisorStore((s) => s.pricing);
  const isEvaluating = useAdvisorStore((s) => s.isEvaluating);
  const evaluateError = useAdvisorStore((s) => s.evaluateError);
  const selectedOrderId = useAdvisorStore((s) => s.selectedOrderId);
  const setSelectedOrderId = useAdvisorStore((s) => s.setSelectedOrderId);
  const [authOpen, setAuthOpen] = useState(false);
  const [cities, setCities] = useState<CityDto[]>([]);
  const [cityId, setCityId] = useState<string>('');
  const [savedProperties, setSavedProperties] = useState<CustomerPropertyView[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>('');
  const [coords, setCoords] = useState({ lat: 36.2972, lng: 59.6067 });
  const [address, setAddress] = useState({ titleFa: 'محل نصب', fullAddressFa: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftOrderId, setDraftOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    if (cities.length === 0) {
      api.cities().then((rows) => {
        setCities(rows);
        setCityId((prev) => prev || rows.find((row) => row.slug === 'mashhad')?.id || rows[0]?.id || '');
      }).catch(() => setError('دریافت شهرها ناموفق بود.'));
    }
    if (user?.role === 'CUSTOMER') {
      api.properties().then(setSavedProperties).catch(() => undefined);
    }
  }, [accessToken, user?.role, cities.length]);

  const selectSavedProperty = (propertyId: string) => {
    setSelectedPropertyId(propertyId);
    const prop = savedProperties.find((item) => item.id === propertyId);
    if (!prop) return;
    setAddress({ titleFa: prop.title, fullAddressFa: prop.address });
    setCoords({ lat: Number(prop.lat), lng: Number(prop.lng) });
    if (prop.cityId) setCityId(prop.cityId);
  };

  const quoteReady = !isEvaluating && !evaluateError && pricing !== null &&
    (pricing.slider?.sliderBps ?? 0) === sliderBps;

  const submit = async () => {
    if (!quoteReady || !pricing || !cityId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createAddress({
        cityId,
        titleFa: address.titleFa,
        locationType: locationType ?? 'APARTMENT',
        fullAddressFa: address.fullAddressFa,
        lat: coords.lat,
        lng: coords.lng,
        isDefault: true,
      });
      const items = Object.entries(selected).flatMap(([serviceKey, selection]) =>
        selection?.enabled ? [{ serviceKey, supplyMode: selection.supplyMode, config: selection.config }] : [],
      );
      const order = await api.createOrder({
        addressId: created.id,
        ...(selectedPropertyId ? { propertyId: selectedPropertyId } : {}),
        urgency,
        supplyMode: 'FULL_PACKAGE',
        sliderBps,
        items,
      });
      setDraftOrderId(order.order.id);
      const current = useAdvisorStore.getState();
      if (current.isEvaluating || current.evaluateError || current.pricing !== pricing ||
          !matchesDisplayedInvoice(pricing.invoice, order.estimate.invoice) ||
          (order.estimate.slider?.sliderBps ?? 0) !== sliderBps ||
          order.estimate.slider?.dispatchAudience !== pricing.slider?.dispatchAudience) {
        router.push(`/order/${order.order.id}`);
        return;
      }
      const submitted = await api.submitOrder(order.order.id, sliderBps);
      setSelectedOrderId(submitted.orderId);
      router.push(`/order/${submitted.orderId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در ثبت پرونده امنیتی.');
    } finally {
      setBusy(false);
    }
  };

  if (selectedOrderId) {
    return (
      <section className="card text-center">
        <p className="text-sm font-bold text-emerald-700">پرونده امنیتی شما ثبت و در حال پیگیری است.</p>
        <button type="button" onClick={() => router.push(`/order/${selectedOrderId}`)} className="btn-primary mt-3 w-full">
          مشاهده وضعیت سفارش
        </button>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="card space-y-3 text-center">
        <p className="text-sm text-slate-600">
          برای ثبت پرونده امنیتی و اعزام کارشناس، با شماره موبایل وارد شوید.
        </p>
        <button type="button" onClick={() => setAuthOpen(true)} className="btn-primary w-full">
          ورود / ثبت‌نام سریع
        </button>
        {authOpen ? <AuthModal onDone={() => setAuthOpen(false)} /> : null}
      </section>
    );
  }

  if (draftOrderId) {
    return (
      <section className="card space-y-3">
        {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}
        <Link href={`/order/${draftOrderId}`} className="btn-primary w-full">بررسی و ادامه ثبت سفارش</Link>
      </section>
    );
  }

  return (
    <section className="card space-y-3">
      <h2 className="flex items-center justify-between gap-2 text-base font-extrabold text-slate-800">
        <span className="flex items-center gap-2">
          <MapPin size={18} className="text-primary-700" />
          ثبت پرونده امنیتی و اعزام کارشناس
        </span>
        <Link href="/properties" className="text-xs font-bold text-primary-700 hover:underline">
          مدیریت املاک من
        </Link>
      </h2>
      {savedProperties.length > 0 ? (
        <div className="space-y-1.5 rounded-xl bg-slate-50 p-3">
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <Building2 size={14} className="text-primary-700" />
            انتخاب از املاک ذخیره‌شده (اختیاری):
          </label>
          <select
            value={selectedPropertyId}
            onChange={(event) => selectSavedProperty(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 focus:border-primary-400 focus:outline-none"
          >
            <option value="">ورود دستی نشانی جدید</option>
            {savedProperties.map((prop) => (
              <option key={prop.id} value={prop.id}>
                {prop.title} ({PROPERTY_TYPE_LABELS_FA[prop.propertyType]}) — {prop.address}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <input
        value={address.fullAddressFa}
        onChange={(event) => setAddress({ ...address, fullAddressFa: event.target.value })}
        placeholder="نشانی کامل محل نصب (مثلاً: بلوار وکیل‌آباد، پلاک ۱۲، واحد ۳)"
        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-primary-400 focus:outline-none"
      />
      <button
        type="button"
        onClick={submit}
        disabled={busy || !quoteReady || !cityId || address.fullAddressFa.trim().length < 10}
        className="btn-primary w-full"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : 'ثبت پرونده امنیتی و اعزام کارشناس'}
      </button>
      {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}
    </section>
  );
}

export function SmartBriefView() {
  return (
    <div className="space-y-5">
      <Scorecard />
      <UrgencySelector />
      <BargainingControl />
      <PricingBreakdown />
      <OrderBridge />
    </div>
  );
}
