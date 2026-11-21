'use client';

import { BadgeCheck, ChevronLeft, ShieldCheck } from 'lucide-react';
import { locationIcon, serviceIcon } from '@/lib/icons';
import type { CatalogResponse, LocationType } from '@/lib/types';

export const LOCATION_OPTIONS: Array<{ value: LocationType; labelFa: string; hintFa: string }> = [
  { value: 'APARTMENT', labelFa: 'آپارتمان', hintFa: 'منزل و پارکینگ ساختمان' },
  { value: 'VILLA', labelFa: 'ویلا', hintFa: 'حیاط مستقل و ورودی جدا' },
  { value: 'SHOP', labelFa: 'فروشگاه / مغازه', hintFa: 'ویترین و صندوق فروش' },
  { value: 'PARKING', labelFa: 'پارکینگ مجتمع', hintFa: 'دهانه و تردد خودرو' },
  { value: 'WAREHOUSE', labelFa: 'انبار / سوله', hintFa: 'بارانداز و ساعات غیرکاری' },
];

export function LocationCards({ onSelect }: { onSelect: (location: LocationType) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {LOCATION_OPTIONS.map((option) => {
        const Icon = locationIcon(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            className="card group flex flex-col items-start gap-2 text-right transition-all hover:-translate-y-0.5 hover:ring-primary-300"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-primary-700 group-hover:bg-primary-900 group-hover:text-white">
              <Icon size={22} />
            </span>
            <span className="font-bold text-slate-800">{option.labelFa}</span>
            <span className="text-xs text-slate-500">{option.hintFa}</span>
            <span className="mt-auto flex items-center gap-1 text-xs font-bold text-primary-600">
              شروع سریع
              <ChevronLeft size={14} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Always rendered from the live backend catalog — never a static placeholder grid. */
export function PillarsShowcase({
  catalog,
  selected,
  onToggle,
}: {
  catalog: CatalogResponse | null;
  selected?: Partial<Record<string, unknown>>;
  onToggle?: (key: string) => void;
}) {
  if (!catalog) {
    return (
      <div className="card animate-pulse text-center text-sm text-slate-400">
        در حال دریافت کاتالوگ مهندسی امنیت…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {catalog.pillars.map((pillar) => (
        <section key={pillar.pillar} className="space-y-3">
          <header className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-900 text-white">
              <ShieldCheck size={16} />
            </span>
            <div>
              <h3 className="text-base font-extrabold text-slate-800">{pillar.titleFa}</h3>
              <p className="text-xs text-slate-500">{pillar.subtitleFa}</p>
            </div>
          </header>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pillar.services.map((service) => {
              const Icon = serviceIcon(service.iconKey);
              const isEnabled = selected?.[service.key] != null;
              return (
                <button
                  key={service.key}
                  type="button"
                  onClick={() => onToggle?.(service.key)}
                  className={`card flex items-start gap-3 text-right transition-all ${
                    isEnabled ? 'ring-2 ring-emerald-500' : 'hover:ring-primary-300'
                  }`}
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      isEnabled ? 'bg-emerald-500 text-white' : 'bg-primary-50 text-primary-700'
                    }`}
                  >
                    <Icon size={20} />
                  </span>
                  <span className="flex-1">
                    <span className="flex items-center gap-1.5 font-bold text-slate-800">
                      {service.titleFa}
                      <BadgeCheck size={14} className="text-emerald-500" />
                    </span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                      {service.subtitleFa ?? service.descriptionFa ?? ''}
                    </span>
                    <span className="mt-1 block text-[11px] font-bold text-primary-600">
                      {isEnabled ? 'انتخاب‌شده — قابل تنظیم' : 'برای انتخاب کلیک کنید'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
