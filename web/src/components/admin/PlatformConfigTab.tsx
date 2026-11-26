'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Sliders, Trash2 } from 'lucide-react';
import { api, ApiError, type PlatformConfigEntry } from '@/lib/api';
import { toLatinDigits, toPersianDigits } from '@/lib/format';

interface BundleTier {
  minServices: string;
  percent: string;
}

interface ConfigFormsState {
  surge: {
    minMultiplier: string;
    maxMultiplier: string;
    balancedRatio: string;
    scarceRatio: string;
    surgeRadiusMeters: string;
  };
  urgency: {
    SCHEDULED: string;
    SAME_DAY: string;
    EMERGENCY: string;
  };
  bundleDiscount: {
    tiers: BundleTier[];
  };
  escrowSplit: {
    platformCommissionRate: string;
    warrantyReserveRate: string;
  };
  dispatchOffer: {
    ttlSeconds: string;
    initialRadiusMeters: string;
    radiusStepMeters: string;
    maxRadiusMeters: string;
    maxRounds: string;
    maxParallelOffers: string;
    priorityThresholdBps: number | undefined;
    topMinRating: number | undefined;
    topMinReviews: number | undefined;
    weights: {
      proximity: string;
      skillMatch: string;
      rating: string;
      warrantyClaimRate: string;
    };
  };
}

function n(raw: string): number {
  return Number(toLatinDigits(raw).trim());
}

function hydrateForms(entries: PlatformConfigEntry[]): ConfigFormsState {
  const byKey = new Map(entries.map((e) => [e.key, e.value]));
  const surge = (byKey.get('pricing.surge') ?? {}) as Record<string, unknown>;
  const urgency = ((byKey.get('pricing.urgency')?.['multipliers'] as Record<string, unknown>) ?? {});
  const tiers = ((byKey.get('pricing.bundleDiscount')?.['tiers'] as Array<Record<string, unknown>>) ?? []);
  const escrow = (byKey.get('escrow.split') ?? {}) as Record<string, unknown>;
  const dispatch = (byKey.get('dispatch.offer') ?? {}) as Record<string, unknown>;
  const weights = ((dispatch['weights'] as Record<string, unknown>) ?? {});

  return {
    surge: {
      minMultiplier: String(surge['minMultiplier'] ?? 1.0),
      maxMultiplier: String(surge['maxMultiplier'] ?? 1.25),
      balancedRatio: String(surge['balancedRatio'] ?? 1.0),
      scarceRatio: String(surge['scarceRatio'] ?? 0.4),
      surgeRadiusMeters: String(surge['surgeRadiusMeters'] ?? 3000),
    },
    urgency: {
      SCHEDULED: String(urgency['SCHEDULED'] ?? 1.0),
      SAME_DAY: String(urgency['SAME_DAY'] ?? 1.12),
      EMERGENCY: String(urgency['EMERGENCY'] ?? 1.3),
    },
    bundleDiscount: {
      tiers:
        tiers.length > 0
          ? tiers.map((t) => ({
              minServices: String(t['minServices'] ?? 2),
              percent: String(t['percent'] ?? 6),
            }))
          : [
              { minServices: '2', percent: '6' },
              { minServices: '3', percent: '10' },
            ],
    },
    escrowSplit: {
      platformCommissionRate: String(escrow['platformCommissionRate'] ?? 0.15),
      warrantyReserveRate: String(escrow['warrantyReserveRate'] ?? 0.05),
    },
    dispatchOffer: {
      ttlSeconds: String(dispatch['ttlSeconds'] ?? 30),
      initialRadiusMeters: String(dispatch['initialRadiusMeters'] ?? 5000),
      radiusStepMeters: String(dispatch['radiusStepMeters'] ?? 7000),
      maxRadiusMeters: String(dispatch['maxRadiusMeters'] ?? 20000),
      maxRounds: String(dispatch['maxRounds'] ?? 3),
      maxParallelOffers: String(dispatch['maxParallelOffers'] ?? 3),
      priorityThresholdBps: typeof dispatch.priorityThresholdBps === 'number' ? dispatch.priorityThresholdBps : undefined,
      topMinRating: typeof dispatch.topMinRating === 'number' ? dispatch.topMinRating : undefined,
      topMinReviews: typeof dispatch.topMinReviews === 'number' ? dispatch.topMinReviews : undefined,
      weights: {
        proximity: String(weights['proximity'] ?? 0.35),
        skillMatch: String(weights['skillMatch'] ?? 0.25),
        rating: String(weights['rating'] ?? 0.2),
        warrantyClaimRate: String(weights['warrantyClaimRate'] ?? 0.2),
      },
    },
  };
}

export function PlatformConfigTab() {
  const [forms, setForms] = useState<ConfigFormsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [cardStatus, setCardStatus] = useState<Record<string, { ok?: string; err?: string }>>({});

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.adminPlatformConfig()
      .then((rows) => setForms(hydrateForms(rows)))
      .catch((err: Error) =>
        setLoadError(err instanceof ApiError ? err.message : 'خطا در دریافت تنظیمات پلتفرم.'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const saveConfig = async (key: string, value: Record<string, unknown>) => {
    setSavingKey(key);
    setCardStatus((prev) => ({ ...prev, [key]: {} }));
    try {
      await api.updatePlatformConfig(key, value);
      setCardStatus((prev) => ({ ...prev, [key]: { ok: 'تنظیمات با موفقیت ذخیره و اعمال شد.' } }));
      reload();
    } catch (err) {
      setCardStatus((prev) => ({
        ...prev,
        [key]: { err: err instanceof ApiError ? err.message : 'خطا در ذخیره تنظیمات.' },
      }));
    } finally {
      setSavingKey(null);
    }
  };

  if (loading && !forms) {
    return (
      <div className="card flex items-center justify-center py-12 text-slate-400">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (loadError && !forms) {
    return <p className="card text-sm font-bold text-red-600">{loadError}</p>;
  }

  if (!forms) return null;

  const escrowSum =
    n(forms.escrowSplit.platformCommissionRate) + n(forms.escrowSplit.warrantyReserveRate);
  const techShare = Math.max(0, 1 - escrowSum);
  const weightSum =
    n(forms.dispatchOffer.weights.proximity) +
    n(forms.dispatchOffer.weights.skillMatch) +
    n(forms.dispatchOffer.weights.rating) +
    n(forms.dispatchOffer.weights.warrantyClaimRate);

  return (
    <div className="space-y-5">
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Sliders size={14} className="text-primary-600" />
        تغییرات بلافاصله در محاسبه قیمت و موتور اعزام اعمال می‌شوند (بدون نیاز به دیپلوی مجدد).
      </p>

      {/* 1. Surge Cap */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-slate-800">سقف ضریب شلوغی (Surge)</h3>
            <p className="text-[11px] text-slate-400">
              فقط روی اجرت و اعزام اعمال می‌شود؛ حداکثر سقف مجاز ۱٫۲۵ (Trust Cap) است.
            </p>
          </div>
          <span dir="ltr" className="chip bg-slate-100 font-mono text-[11px] text-slate-600">
            pricing.surge
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { k: 'minMultiplier' as const, label: 'حداقل ضریب' },
            { k: 'maxMultiplier' as const, label: 'حداکثر (≤ ۱.۲۵)' },
            { k: 'balancedRatio' as const, label: 'نسبت تعادل' },
            { k: 'scarceRatio' as const, label: 'نسبت کمبود' },
            { k: 'surgeRadiusMeters' as const, label: 'شعاع (متر)' },
          ].map((f) => (
            <div key={f.k}>
              <label className="mb-1 block text-[11px] font-bold text-slate-600">{f.label}</label>
              <input
                dir="ltr"
                value={forms.surge[f.k]}
                onChange={(e) =>
                  setForms({ ...forms, surge: { ...forms.surge, [f.k]: e.target.value } })
                }
                className="tabular-fa w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-bold"
              />
            </div>
          ))}
        </div>
        {cardStatus['pricing.surge']?.err ? (
          <p className="rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-600">
            {cardStatus['pricing.surge'].err}
          </p>
        ) : null}
        {cardStatus['pricing.surge']?.ok ? (
          <p className="rounded-xl bg-emerald-50 p-2.5 text-xs font-bold text-emerald-700">
            {cardStatus['pricing.surge'].ok}
          </p>
        ) : null}
        <button
          type="button"
          disabled={savingKey === 'pricing.surge'}
          onClick={() =>
            void saveConfig('pricing.surge', {
              minMultiplier: n(forms.surge.minMultiplier),
              maxMultiplier: n(forms.surge.maxMultiplier),
              balancedRatio: n(forms.surge.balancedRatio),
              scarceRatio: n(forms.surge.scarceRatio),
              surgeRadiusMeters: n(forms.surge.surgeRadiusMeters),
            })
          }
          className="btn-primary !py-2 text-xs"
        >
          {savingKey === 'pricing.surge' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          ذخیره ضریب شلوغی
        </button>
      </section>

      {/* 2. Urgency Multipliers */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-800">ضرایب فوریت اعزام (Urgency)</h3>
          <span dir="ltr" className="chip bg-slate-100 font-mono text-[11px] text-slate-600">
            pricing.urgency
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { k: 'SCHEDULED' as const, label: 'زمان‌بندی عادی' },
            { k: 'SAME_DAY' as const, label: 'اعزام امروز' },
            { k: 'EMERGENCY' as const, label: 'فوری / اضطراری' },
          ].map((f) => (
            <div key={f.k}>
              <label className="mb-1 block text-[11px] font-bold text-slate-600">{f.label}</label>
              <input
                dir="ltr"
                value={forms.urgency[f.k]}
                onChange={(e) =>
                  setForms({ ...forms, urgency: { ...forms.urgency, [f.k]: e.target.value } })
                }
                className="tabular-fa w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-bold"
              />
            </div>
          ))}
        </div>
        {cardStatus['pricing.urgency']?.err ? (
          <p className="rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-600">
            {cardStatus['pricing.urgency'].err}
          </p>
        ) : null}
        {cardStatus['pricing.urgency']?.ok ? (
          <p className="rounded-xl bg-emerald-50 p-2.5 text-xs font-bold text-emerald-700">
            {cardStatus['pricing.urgency'].ok}
          </p>
        ) : null}
        <button
          type="button"
          disabled={savingKey === 'pricing.urgency'}
          onClick={() =>
            void saveConfig('pricing.urgency', {
              multipliers: {
                SCHEDULED: n(forms.urgency.SCHEDULED),
                SAME_DAY: n(forms.urgency.SAME_DAY),
                EMERGENCY: n(forms.urgency.EMERGENCY),
              },
            })
          }
          className="btn-primary !py-2 text-xs"
        >
          {savingKey === 'pricing.urgency' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          ذخیره ضرایب فوریت
        </button>
      </section>

      {/* 3. Bundle Discount Tiers */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-800">تخفیف پکیج چندسرویسی</h3>
          <span dir="ltr" className="chip bg-slate-100 font-mono text-[11px] text-slate-600">
            pricing.bundleDiscount
          </span>
        </div>
        <div className="space-y-2">
          {forms.bundleDiscount.tiers.map((tier, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-[10px] text-slate-500">حداقل تعداد سرویس</label>
                <input
                  dir="ltr"
                  value={tier.minServices}
                  onChange={(e) => {
                    const next = [...forms.bundleDiscount.tiers];
                    next[idx] = { ...tier, minServices: e.target.value };
                    setForms({ ...forms, bundleDiscount: { tiers: next } });
                  }}
                  className="tabular-fa w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-bold"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[10px] text-slate-500">درصد تخفیف</label>
                <input
                  dir="ltr"
                  value={tier.percent}
                  onChange={(e) => {
                    const next = [...forms.bundleDiscount.tiers];
                    next[idx] = { ...tier, percent: e.target.value };
                    setForms({ ...forms, bundleDiscount: { tiers: next } });
                  }}
                  className="tabular-fa w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-bold"
                />
              </div>
              {forms.bundleDiscount.tiers.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setForms({
                      ...forms,
                      bundleDiscount: {
                        tiers: forms.bundleDiscount.tiers.filter((_, i) => i !== idx),
                      },
                    })
                  }
                  className="mt-4 rounded-lg p-2 text-red-500 hover:bg-red-50"
                  aria-label="حذف ردیف"
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setForms({
                ...forms,
                bundleDiscount: {
                  tiers: [...forms.bundleDiscount.tiers, { minServices: '4', percent: '12' }],
                },
              })
            }
            className="btn-ghost !py-2 text-xs"
          >
            <Plus size={14} />
            افزودن سطح
          </button>
          <button
            type="button"
            disabled={savingKey === 'pricing.bundleDiscount'}
            onClick={() =>
              void saveConfig('pricing.bundleDiscount', {
                tiers: forms.bundleDiscount.tiers.map((t) => ({
                  minServices: n(t.minServices),
                  percent: n(t.percent),
                })),
              })
            }
            className="btn-primary !py-2 text-xs"
          >
            {savingKey === 'pricing.bundleDiscount' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            ذخیره تخفیف پکیج
          </button>
        </div>
        {cardStatus['pricing.bundleDiscount']?.err ? (
          <p className="rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-600">
            {cardStatus['pricing.bundleDiscount'].err}
          </p>
        ) : null}
        {cardStatus['pricing.bundleDiscount']?.ok ? (
          <p className="rounded-xl bg-emerald-50 p-2.5 text-xs font-bold text-emerald-700">
            {cardStatus['pricing.bundleDiscount'].ok}
          </p>
        ) : null}
      </section>

      {/* 4. Escrow Split */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-extrabold text-slate-800">تقسیم پیش‌فرض اسکرو (Escrow Split)</h3>
            <p className="text-[11px] text-slate-400">
              برای شعب بدون نرخ اختصاصی اعمال می‌شود؛ مجموع نرخ‌ها نباید از ۱۰۰٪ بیشتر شود.
            </p>
          </div>
          <span dir="ltr" className="chip bg-slate-100 font-mono text-[11px] text-slate-600">
            escrow.split
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-bold text-slate-600">
              نرخ کمیسیون پلتفرم (۰ تا ۱)
            </label>
            <input
              dir="ltr"
              value={forms.escrowSplit.platformCommissionRate}
              onChange={(e) =>
                setForms({
                  ...forms,
                  escrowSplit: { ...forms.escrowSplit, platformCommissionRate: e.target.value },
                })
              }
              className="tabular-fa w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-bold"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold text-slate-600">
              نرخ ذخیره ضمانت (۰ تا ۱)
            </label>
            <input
              dir="ltr"
              value={forms.escrowSplit.warrantyReserveRate}
              onChange={(e) =>
                setForms({
                  ...forms,
                  escrowSplit: { ...forms.escrowSplit, warrantyReserveRate: e.target.value },
                })
              }
              className="tabular-fa w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-bold"
            />
          </div>
        </div>
        <p className="tabular-fa text-xs text-slate-600">
          سهم خالص تکنسین: <span className="font-extrabold text-emerald-700">{toPersianDigits((techShare * 100).toFixed(1))}٪</span>{' '}
          (مجموع کسورات: {toPersianDigits((escrowSum * 100).toFixed(1))}٪)
        </p>
        {cardStatus['escrow.split']?.err ? (
          <p className="rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-600">
            {cardStatus['escrow.split'].err}
          </p>
        ) : null}
        {cardStatus['escrow.split']?.ok ? (
          <p className="rounded-xl bg-emerald-50 p-2.5 text-xs font-bold text-emerald-700">
            {cardStatus['escrow.split'].ok}
          </p>
        ) : null}
        <button
          type="button"
          disabled={savingKey === 'escrow.split'}
          onClick={() =>
            void saveConfig('escrow.split', {
              platformCommissionRate: n(forms.escrowSplit.platformCommissionRate),
              warrantyReserveRate: n(forms.escrowSplit.warrantyReserveRate),
            })
          }
          className="btn-primary !py-2 text-xs"
        >
          {savingKey === 'escrow.split' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          ذخیره نرخ اسکرو
        </button>
      </section>

      {/* 5. Dispatch Offer Tuning */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-slate-800">تنظیمات اعزام هوشمند (Dispatch)</h3>
          <span dir="ltr" className="chip bg-slate-100 font-mono text-[11px] text-slate-600">
            dispatch.offer
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { k: 'ttlSeconds' as const, label: 'مهلت پیشنهاد (ثانیه)' },
            { k: 'initialRadiusMeters' as const, label: 'شعاع اولیه (متر)' },
            { k: 'radiusStepMeters' as const, label: 'گام افزایش شعاع (متر)' },
            { k: 'maxRadiusMeters' as const, label: 'حداکثر شعاع (متر)' },
            { k: 'maxRounds' as const, label: 'حداکثر موج جستجو' },
            { k: 'maxParallelOffers' as const, label: 'حداکثر پیشنهاد هم‌زمان' },
          ].map((f) => (
            <div key={f.k}>
              <label className="mb-1 block text-[11px] font-bold text-slate-600">{f.label}</label>
              <input
                dir="ltr"
                value={forms.dispatchOffer[f.k]}
                onChange={(e) =>
                  setForms({
                    ...forms,
                    dispatchOffer: { ...forms.dispatchOffer, [f.k]: e.target.value },
                  })
                }
                className="tabular-fa w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-bold"
              />
            </div>
          ))}
        </div>

        <p className="pt-1 text-xs font-bold text-slate-700">
          وزن‌های امتیازدهی کاندیداها (مجموع فعلی:{' '}
          <span
            className={`tabular-fa ${
              Math.abs(weightSum - 1) <= 0.001 ? 'text-emerald-600' : 'text-red-600'
            }`}
          >
            {toPersianDigits(weightSum.toFixed(2))}
          </span>
          ):
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { k: 'proximity' as const, label: 'نزدیکی مکانی' },
            { k: 'skillMatch' as const, label: 'تطابق مهارت' },
            { k: 'rating' as const, label: 'امتیاز مشتریان' },
            { k: 'warrantyClaimRate' as const, label: 'نرخ پایین خرابی' },
          ].map((f) => (
            <div key={f.k}>
              <label className="mb-1 block text-[11px] font-bold text-slate-600">{f.label}</label>
              <input
                dir="ltr"
                value={forms.dispatchOffer.weights[f.k]}
                onChange={(e) =>
                  setForms({
                    ...forms,
                    dispatchOffer: {
                      ...forms.dispatchOffer,
                      weights: { ...forms.dispatchOffer.weights, [f.k]: e.target.value },
                    },
                  })
                }
                className="tabular-fa w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs font-bold"
              />
            </div>
          ))}
        </div>

        {cardStatus['dispatch.offer']?.err ? (
          <p className="rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-600">
            {cardStatus['dispatch.offer'].err}
          </p>
        ) : null}
        {cardStatus['dispatch.offer']?.ok ? (
          <p className="rounded-xl bg-emerald-50 p-2.5 text-xs font-bold text-emerald-700">
            {cardStatus['dispatch.offer'].ok}
          </p>
        ) : null}
        <button
          type="button"
          disabled={savingKey === 'dispatch.offer'}
          onClick={() =>
            void saveConfig('dispatch.offer', {
              ttlSeconds: n(forms.dispatchOffer.ttlSeconds),
              initialRadiusMeters: n(forms.dispatchOffer.initialRadiusMeters),
              radiusStepMeters: n(forms.dispatchOffer.radiusStepMeters),
              maxRadiusMeters: n(forms.dispatchOffer.maxRadiusMeters),
              maxRounds: n(forms.dispatchOffer.maxRounds),
              maxParallelOffers: n(forms.dispatchOffer.maxParallelOffers),
              priorityThresholdBps: forms.dispatchOffer.priorityThresholdBps,
              topMinRating: forms.dispatchOffer.topMinRating,
              topMinReviews: forms.dispatchOffer.topMinReviews,
              weights: {
                proximity: n(forms.dispatchOffer.weights.proximity),
                skillMatch: n(forms.dispatchOffer.weights.skillMatch),
                rating: n(forms.dispatchOffer.weights.rating),
                warrantyClaimRate: n(forms.dispatchOffer.weights.warrantyClaimRate),
              },
            })
          }
          className="btn-primary !py-2 text-xs"
        >
          {savingKey === 'dispatch.offer' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          ذخیره تنظیمات اعزام
        </button>
      </section>
    </div>
  );
}
