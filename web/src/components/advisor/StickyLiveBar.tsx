'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronUp, Loader2, X } from 'lucide-react';
import { formatToman } from '@/lib/format';
import { useAdvisorStore } from '@/store/advisor.store';
import type { ReadinessScore } from '@/lib/types';

const PILLAR_LABELS: Array<{ key: 'physical' | 'intrusion' | 'monitoring'; labelFa: string }> = [
  { key: 'physical', labelFa: 'فیزیکی' },
  { key: 'intrusion', labelFa: 'هشدار نفوذ' },
  { key: 'monitoring', labelFa: 'نظارت تصویری' },
];

export function readinessColor(total: number): string {
  if (total >= 85) return 'text-emerald-500';
  if (total >= 60) return 'text-sky-500';
  if (total >= 35) return 'text-amber-500';
  return 'text-red-500';
}

function ReadinessRing({ readiness, size = 64 }: { readiness: ReadinessScore | null; size?: number }) {
  const total = readiness?.total ?? 0;
  const color = readinessColor(total);
  const radius = size / 2 - 5;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - total / 100);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#e2e8f0" strokeWidth={5} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          className={color}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 500ms ease, stroke 300ms' }}
        />
      </svg>
      <span className={`tabular-fa absolute inset-0 flex items-center justify-center text-lg font-extrabold ${color}`}>
        {total}
      </span>
    </div>
  );
}

function PillarDrawer({ onClose }: { onClose: () => void }) {
  const readiness = useAdvisorStore((s) => s.readiness);
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-slate-900/40" onClick={onClose}>
      <div
        className="w-full rounded-t-3xl bg-white p-5 pb-8 shadow-sticky"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-extrabold text-slate-800">کارنامه سه رکن امنیت</h3>
          <button type="button" onClick={onClose} aria-label="بستن">
            <X size={20} className="text-slate-400" />
          </button>
        </div>
        <div className="space-y-4">
          {PILLAR_LABELS.map((pillar) => {
            const score = readiness?.[pillar.key] ?? 0;
            return (
              <div key={pillar.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-bold text-slate-700">{pillar.labelFa}</span>
                  <span className={`tabular-fa font-extrabold ${readinessColor(score)}`}>{score}/۱۰۰</span>
                </div>
                <div className="h-2.5 rounded-full bg-slate-100">
                  <div
                    className="h-2.5 rounded-full bg-primary-700 transition-all duration-500"
                    style={{ width: `${score}%` }}
                  />
                </div>
              </div>
            );
          })}
          <p className="rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-600">
            وضعیت کلی: <span className={`font-extrabold ${readinessColor(readiness?.total ?? 0)}`}>{readiness?.levelFa ?? '—'}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

/** Snapp-grade sticky bottom bar: readiness ring + live price + CTA. */
export function StickyLiveBar({ ctaHref }: { ctaHref: string }) {
  const readiness = useAdvisorStore((s) => s.readiness);
  const pricing = useAdvisorStore((s) => s.pricing);
  const isEvaluating = useAdvisorStore((s) => s.isEvaluating);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const surgeMultiplier = pricing?.factors.surge.multiplier ?? 1;
  const urgencyMultiplier = pricing?.factors.urgency.multiplier ?? 1;

  return (
    <>
      {drawerOpen ? <PillarDrawer onClose={() => setDrawerOpen(false)} /> : null}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-100 bg-white/95 px-4 py-3 shadow-sticky backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="relative flex flex-col items-center"
            aria-label="کارنامه سه رکن امنیت"
          >
            <ReadinessRing readiness={readiness} />
            <ChevronUp size={14} className="text-slate-400" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-slate-500">برآورد زنده هومنتال</p>
            <p className="tabular-fa truncate text-lg font-extrabold text-primary-950">
              {pricing ? (
                <>
                  {formatToman(pricing.estimatedMin)} <span className="text-sm font-normal text-slate-400">تا</span>{' '}
                  {formatToman(pricing.estimatedMax)}
                </>
              ) : (
                '—'
              )}
              {isEvaluating ? <Loader2 size={14} className="mr-1 inline animate-spin text-slate-400" /> : null}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {pricing && pricing.summary.bundleDiscountPercent > 0 ? (
                <span className="chip bg-emerald-50 text-emerald-700">
                  تخفیف پکیج {pricing.summary.bundleDiscountPercent}٪
                </span>
              ) : null}
              {surgeMultiplier > 1 || urgencyMultiplier > 1 ? (
                <span className="chip bg-amber-50 text-amber-700">
                  ضریب ×{(surgeMultiplier * urgencyMultiplier).toFixed(2)} (اجرت و اعزام فقط)
                </span>
              ) : null}
            </div>
          </div>

          <Link href={ctaHref} className="btn-primary shrink-0 text-sm">
            مشاهده کارنامه امنیتی و ادامه
          </Link>
        </div>
      </div>
    </>
  );
}
