'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { PillarsShowcase, LOCATION_OPTIONS } from '@/components/catalog/catalog-parts';
import { AdvisoryBanner } from '@/components/advisor/AdvisoryBanner';
import { StickyLiveBar } from '@/components/advisor/StickyLiveBar';
import { DynamicServiceConfigurator } from '@/components/configurator/DynamicServiceConfigurator';
import { enabledServiceKeys, useAdvisorStore } from '@/store/advisor.store';
import { locationIcon } from '@homental/shared';
import { toPersianDigits } from '@homental/shared';
import type { LocationType } from '@homental/shared';

/** Compact building-context bar — only for locations whose advisory rules read context. */
function BuildingContextBar() {
  const locationType = useAdvisorStore((s) => s.locationType);
  const buildingContext = useAdvisorStore((s) => s.buildingContext);
  const setBuildingContextValue = useAdvisorStore((s) => s.setBuildingContextValue);
  const unitsCount = typeof buildingContext['unitsCount'] === 'number' ? buildingContext['unitsCount'] : 0;

  const relevant =
    locationType === 'APARTMENT' || locationType === 'PARKING' || locationType === 'WAREHOUSE';
  if (!relevant) return null;

  const Icon = locationIcon((locationType ?? 'APARTMENT') as LocationType);
  const label = LOCATION_OPTIONS.find((option) => option.value === locationType)?.labelFa ?? '';
  return (
    <div className="card flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
          <Icon size={18} />
        </span>
        <div>
          <p className="text-sm font-bold text-slate-700">{label}</p>
          <p className="text-xs text-slate-500">
            {locationType === 'APARTMENT'
              ? 'تعداد واحدها — برای تشخیص جک پارکینگ مشترک'
              : 'تعداد واحدها / بار تردد — برای پیشنهاد ارتقای جک'}
          </p>
        </div>
      </div>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={unitsCount}
        onChange={(event) => setBuildingContextValue('unitsCount', Number(event.target.value))}
        className="tabular-fa w-24 rounded-xl border border-slate-200 px-3 py-2 text-center font-bold focus:border-primary-400 focus:outline-none"
        placeholder={toPersianDigits('۰')}
      />
    </div>
  );
}

export default function ConfigurePage() {
  const router = useRouter();
  const catalog = useAdvisorStore((s) => s.catalog);
  const locationType = useAdvisorStore((s) => s.locationType);
  const selected = useAdvisorStore((s) => s.selected);
  const toggleService = useAdvisorStore((s) => s.toggleService);
  const evaluate = useAdvisorStore((s) => s.evaluate);
  const isEvaluating = useAdvisorStore((s) => s.isEvaluating);
  const evaluateError = useAdvisorStore((s) => s.evaluateError);
  const loadCatalog = useAdvisorStore((s) => s.loadCatalog);

  // ROOT FIX: this page must load the catalog itself — arriving here directly
  // (fresh F5, shared link, or expert-mode Path 2) starts with an empty store,
  // and nothing else fetches it, which left the page on an eternal skeleton.
  useEffect(() => {
    if (!catalog) {
      void loadCatalog(locationType, false).then(() => {
        if (useAdvisorStore.getState().locationType) void evaluate();
      });
    } else if (locationType) {
      void evaluate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enabledCount = enabledServiceKeys({
    selected,
  } as never).length;
  const bundlePercent = enabledCount >= 3 ? 10 : enabledCount === 2 ? 6 : 0;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-56 pt-6 md:pb-40">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-primary-950">اتاق طراحی امنیت</h1>
          <p className="text-xs text-slate-500">
            سرویس‌ها را ترکیب کنید؛ کارنامه امنیتی و قیمت به‌صورت زنده به‌روز می‌شود.
          </p>
        </div>
        {isEvaluating ? <Loader2 size={18} className="animate-spin text-primary-400" /> : null}
      </header>

      <div className="mb-6 space-y-4">
        {evaluateError ? (
          <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4 text-sm font-bold leading-6 text-red-600">
            {evaluateError}
            <span className="mt-2 block font-normal text-slate-600">
              در محیط توسعه، بک‌اند باید روی پورت ۳۰۰۰ اجرا شود و مبدأ صفحه
              (localhost:3001 یا 127.0.0.1:3001) در CORS_ORIGINS مجاز باشد.
            </span>
            <button
              type="button"
              onClick={() => {
                void evaluate();
                if (!catalog) void useAdvisorStore.getState().loadCatalog(locationType, false);
              }}
              className="btn-primary mt-3"
            >
              تلاش مجدد
            </button>
          </div>
        ) : null}
        <BuildingContextBar />
        <PillarsShowcase
          catalog={catalog}
          selected={selected}
          onToggle={(key) => toggleService(key as never)}
        />
      </div>

      <h2 className="mb-3 text-lg font-extrabold text-slate-800">پیکربندی سرویس‌های انتخابی</h2>
      <div className="mb-6">
        <DynamicServiceConfigurator />
      </div>

      <h2 className="mb-3 text-lg font-extrabold text-slate-800">پیشنهادهای هوشمند هومنتال</h2>
      <div className="mb-4">
        <AdvisoryBanner />
      </div>

      <div className="pb-6">
        {bundlePercent > 0 ? (
          <p className="mb-3 rounded-xl bg-emerald-50 p-3 text-center text-xs font-bold text-emerald-700">
            🎉 تخفیف پکیج امنیتی {toPersianDigits(bundlePercent)}٪ برای {toPersianDigits(enabledCount)} سرویس فعال
          </p>
        ) : (
          <p className="mb-3 rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-500">
            با افزودن سرویس دوم، تخفیف پکیج ۶٪ و با ۳ سرویس، ۱۰٪ فعال می‌شود.
          </p>
        )}
        <button type="button" onClick={() => router.push('/brief')} className="btn-primary hidden w-full">
          ادامه
        </button>
      </div>

      <StickyLiveBar ctaHref="/brief" />
    </main>
  );
}
