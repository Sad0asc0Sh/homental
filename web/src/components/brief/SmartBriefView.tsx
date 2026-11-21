'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { readinessColor } from '@/components/advisor/StickyLiveBar';
import { AuthModal } from './AuthModal';
import { api, ApiError } from '@/lib/api';
import { formatNumberFa, formatToman } from '@/lib/format';
import { useAdvisorStore } from '@/store/advisor.store';
import { useAuthStore } from '@/store/auth.store';
import type { CityDto, UrgencyLevel } from '@/lib/types';

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
        ضریب فوریت فقط روی اجرت نصب و هزینه اعزام اعمال می‌شود؛ قیمت سخت‌افزار همیشه ثابت می‌ماند.
      </p>
    </div>
  );
}

function PricingBreakdown() {
  const pricing = useAdvisorStore((s) => s.pricing);
  if (!pricing) return null;
  return (
    <section className="card space-y-3">
      <h2 className="text-base font-extrabold text-slate-800">پیش‌فاکتور شفاف هومنتال</h2>
      {pricing.items.map((item) => (
        <div key={item.serviceKey} className="rounded-xl bg-slate-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-extrabold text-slate-700">{item.titleFa}</p>
            <span className="chip bg-white text-[11px] text-slate-500">
              {item.supplyMode === 'INSTALL_ONLY' ? 'فقط نصب' : 'کالا + نصب'}
            </span>
          </div>
          {!item.hardwareDropped ? (
            <div className="space-y-1">
              {item.hardwareLines.map((line) => (
                <div key={line.ref ?? line.labelFa} className="flex justify-between text-xs text-slate-600">
                  <span>
                    {line.labelFa}
                    {line.qty ? ` × ${formatNumberFa(line.qty)}` : ''}
                  </span>
                  <span className="tabular-fa">{formatToman(line.lineTotal ?? '0', 'full')}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-slate-200 pt-1 text-xs font-bold text-slate-700">
                <span>جمع سخت‌افزار</span>
                <span className="tabular-fa">{formatToman(item.hardwareSubtotal, 'full')}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs italic text-slate-400">کالا توسط مشتری تأمین می‌شود (بدون هزینه سخت‌افزار).</p>
          )}
          <div className="mt-2 space-y-1">
            {item.laborLines.map((line) => (
              <div key={line.labelFa} className="flex justify-between text-xs text-slate-600">
                <span>{line.labelFa}</span>
                <span className="tabular-fa">{formatToman(line.amount ?? '0', 'full')}</span>
              </div>
            ))}
            {item.appliedComplexities.map((complexity) => (
              <div key={complexity.labelFa} className="flex justify-between text-[11px] text-amber-600">
                <span>{complexity.labelFa}</span>
                <span>×{complexity.multiplier}</span>
              </div>
            ))}
            <div className="flex justify-between text-xs text-slate-600">
              <span>هزینه اعزام کارشناس</span>
              <span className="tabular-fa">{formatToman(item.dispatchFee, 'full')}</span>
            </div>
          </div>
        </div>
      ))}

      <div className="space-y-1.5 border-t border-slate-200 pt-3 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>سخت‌افزار (بدون ضریب)</span>
          <span className="tabular-fa">{formatToman(pricing.summary.totalHardware, 'full')}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>اجرت و اعزام (با ضریب فوریت/شلوغی)</span>
          <span className="tabular-fa">{formatToman(pricing.summary.dynamicLaborAndDispatch, 'full')}</span>
        </div>
        {pricing.summary.bundleDiscountPercent > 0 ? (
          <div className="flex justify-between font-bold text-emerald-600">
            <span>تخفیف پکیج {pricing.summary.bundleDiscountPercent}٪</span>
            <span className="tabular-fa">− {formatToman(pricing.summary.bundleDiscountAmount, 'full')}</span>
          </div>
        ) : null}
        <div className="flex justify-between text-lg font-extrabold text-primary-950">
          <span>برآورد نهایی</span>
          <span className="tabular-fa">{formatToman(pricing.netEstimated)}</span>
        </div>
        <p className="text-left text-[11px] text-slate-400">
          بازه: {formatToman(pricing.estimatedMin)} تا {formatToman(pricing.estimatedMax)}
        </p>
      </div>

      <div className="rounded-xl bg-primary-950 p-4 text-white">
        <p className="flex items-center gap-2 text-sm font-extrabold">
          <ShieldCheck size={18} className="text-emerald-400" />
          تعهد ۳گانه هومنتال
        </p>
        <p className="mt-1 text-[11px] leading-5 text-primary-200">
          سخت‌افزار اصل و ماتریکس‌دار + نصب استاندارد توسط تکنسین احراز‌شده + تعهدنامه حریم خصوصی و
          تغییر رمزهای پیش‌فرض پیش از تحویل.
        </p>
      </div>
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
  const selectedOrderId = useAdvisorStore((s) => s.selectedOrderId);
  const setSelectedOrderId = useAdvisorStore((s) => s.setSelectedOrderId);
  const [authOpen, setAuthOpen] = useState(false);
  const [cities, setCities] = useState<CityDto[]>([]);
  const [cityId, setCityId] = useState<string>('');
  const [address, setAddress] = useState({ titleFa: 'محل نصب', fullAddressFa: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (accessToken && cities.length === 0) {
      api.cities().then((rows) => {
        setCities(rows);
        setCityId(rows.find((row) => row.slug === 'mashhad')?.id ?? rows[0]?.id ?? '');
      }).catch(() => setError('دریافت شهرها ناموفق بود.'));
    }
  }, [accessToken, cities.length]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createAddress({
        cityId,
        titleFa: address.titleFa,
        locationType: locationType ?? 'APARTMENT',
        fullAddressFa: address.fullAddressFa,
        lat: 36.2972,
        lng: 59.6067,
        isDefault: true,
      });
      const items = Object.entries(selected)
        .filter(([, selection]) => selection?.enabled)
        .map(([serviceKey, selection]) => ({
          serviceKey,
          supplyMode: selection!.supplyMode,
          config: selection!.config,
        }));
      const order = await api.createOrder({
        addressId: created.id,
        urgency,
        supplyMode: 'FULL_PACKAGE',
        items,
      });
      const submitted = await api.submitOrder(order.order.id);
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

  return (
    <section className="card space-y-3">
      <h2 className="flex items-center gap-2 text-base font-extrabold text-slate-800">
        <MapPin size={18} className="text-primary-700" />
        ثبت پرونده امنیتی و اعزام کارشناس
      </h2>
      <input
        value={address.fullAddressFa}
        onChange={(event) => setAddress({ ...address, fullAddressFa: event.target.value })}
        placeholder="نشانی کامل محل نصب (مثلاً: بلوار وکیل‌آباد، پلاک ۱۲، واحد ۳)"
        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-primary-400 focus:outline-none"
      />
      <button
        type="button"
        onClick={submit}
        disabled={busy || address.fullAddressFa.length < 10}
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
      <PricingBreakdown />
      <OrderBridge />
    </div>
  );
}
