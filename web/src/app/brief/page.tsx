'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, ShieldCheck } from 'lucide-react';
import { SmartBriefView } from '@/components/brief/SmartBriefView';
import { StickyLiveBar } from '@/components/advisor/StickyLiveBar';
import { LocationCards } from '@/components/catalog/catalog-parts';
import { useAdvisorStore } from '@/store/advisor.store';
import type { LocationType } from '@/lib/types';

export default function BriefPage() {
  const catalog = useAdvisorStore((s) => s.catalog);
  const locationType = useAdvisorStore((s) => s.locationType);
  const selected = useAdvisorStore((s) => s.selected);
  const readiness = useAdvisorStore((s) => s.readiness);
  const loadCatalog = useAdvisorStore((s) => s.loadCatalog);
  const evaluate = useAdvisorStore((s) => s.evaluate);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);

  // ROOT FIX (same class as /configure): arriving here directly (F5, shared
  // link) starts with an empty store — this page must bootstrap itself.
  useEffect(() => {
    if (!catalog) {
      setBootstrapLoading(true);
      void loadCatalog(locationType, false).then(() => {
        if (useAdvisorStore.getState().locationType) void evaluate();
        setBootstrapLoading(false);
      });
    } else if (locationType) {
      void evaluate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Inline location pick for direct arrivals with no chosen location yet. */
  const pickLocation = (location: LocationType) => {
    setBootstrapLoading(true);
    void loadCatalog(location, false)
      .then(() => evaluate())
      .finally(() => setBootstrapLoading(false));
  };

  const showBrief = readiness !== null;

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 pb-44 pt-6">
      <header className="mb-1 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-primary-950">کارنامه امنیتی و ثبت سفارش</h1>
          <p className="text-xs text-slate-500">خروجی مهندسی پیکربندی شما — آماده اعزام کارشناس</p>
        </div>
        <Link href="/configure" className="btn-ghost">
          بازگشت به پیکربندی
        </Link>
      </header>

      {bootstrapLoading ? (
        <div className="card flex items-center justify-center py-10 text-slate-400">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : null}

      {/* No location chosen yet → pick it here instead of bouncing to the home page. */}
      {!bootstrapLoading && !locationType ? (
        <section className="space-y-3">
          <div className="card flex items-center gap-3">
            <ShieldCheck size={20} className="text-primary-700" />
            <p className="text-sm font-bold text-slate-700">
              ابتدا مکان را انتخاب کنید تا کارنامه امنیتی ساخته شود:
            </p>
          </div>
          <LocationCards onSelect={pickLocation} />
        </section>
      ) : null}

      {!bootstrapLoading && locationType && !showBrief ? (
        <div className="card flex items-center justify-center py-10 text-slate-400">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : null}

      {showBrief ? <SmartBriefView /> : null}

      {showBrief && selected && Object.keys(selected).length === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          هنوز سرویسی پیکربندی نکرده‌اید —{' '}
          <Link href="/configure" className="font-bold text-primary-700">
            رفتن به اتاق طراحی امنیت
          </Link>
        </div>
      ) : null}

      <StickyLiveBar ctaHref="/brief" />
    </main>
  );
}
