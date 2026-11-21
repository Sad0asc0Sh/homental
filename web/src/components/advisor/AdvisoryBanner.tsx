'use client';

import { Lightbulb, X, Zap } from 'lucide-react';
import { useAdvisorStore } from '@/store/advisor.store';

const PILLAR_BADGES: Record<string, string> = {
  PHYSICAL: 'رکن فیزیکی',
  INTRUSION: 'رکن هشدار نفوذ',
  MONITORING: 'رکن نظارت تصویری',
};

/** Soft, non-blocking advisory strip — max 2 items, one-click apply. */
export function AdvisoryBanner() {
  const advisories = useAdvisorStore((s) => s.advisories);
  const dismissed = useAdvisorStore((s) => s.dismissedAdvisories);
  const applyAdvisory = useAdvisorStore((s) => s.applyAdvisory);
  const dismissAdvisory = useAdvisorStore((s) => s.dismissAdvisory);
  const isEvaluating = useAdvisorStore((s) => s.isEvaluating);

  const visible = advisories.filter((advisory) => !dismissed.includes(advisory.code)).slice(0, 2);
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2">
      {visible.map((advisory) => (
        <div
          key={advisory.code}
          className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Lightbulb size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="chip bg-amber-200/60 px-2 py-0.5 text-amber-800">
                {PILLAR_BADGES[advisory.pillar] ?? advisory.pillar}
              </span>
              {advisory.scoreImpact ? (
                <span className="chip bg-emerald-50 px-2 py-0.5 text-emerald-700">
                  <Zap size={12} />
                  {Object.entries(advisory.scoreImpact)
                    .map(([pillar, impact]) => `+${impact} ${PILLAR_BADGES[pillar] ?? pillar}`)
                    .join(' + ')}
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 text-sm leading-6 text-slate-700">{advisory.messageFa}</p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2">
            {advisory.suggestedAction ? (
              <button
                type="button"
                onClick={() => applyAdvisory(advisory)}
                disabled={isEvaluating}
                className="rounded-xl bg-primary-900 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-primary-700 disabled:opacity-60"
              >
                + اعمال پیشنهاد
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => dismissAdvisory(advisory.code)}
              aria-label="نادیده گرفتن پیشنهاد"
            >
              <X size={16} className="text-slate-400 hover:text-slate-600" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
