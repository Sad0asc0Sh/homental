'use client';

import { useState } from 'react';
import { ChevronDown, Package, Wrench } from 'lucide-react';
import { FieldFactory } from './FieldFactory';
import { serviceIcon } from '@/lib/icons';
import { toPersianDigits } from '@/lib/format';
import { useAdvisorStore } from '@/store/advisor.store';
import type { PublicService, ServiceKey, SupplyMode, UiField } from '@/lib/types';

function serviceFieldsWithValues(service: PublicService, config: Record<string, unknown>) {
  const fields: Array<{ field: UiField; value: unknown }> = [];
  for (const step of service.uiSchema.steps ?? []) {
    for (const field of step.fields ?? []) {
      // Sparse config: render the merged view (schema defaults underneath user answers).
      fields.push({ field, value: config[field.pricingVar ?? field.id] });
    }
  }
  return fields;
}

function ServiceConfiguratorCard({ service }: { service: PublicService }) {
  const selection = useAdvisorStore((s) => s.selected[service.key]);
  const setConfigValue = useAdvisorStore((s) => s.setConfigValue);
  const toggleGoal = useAdvisorStore((s) => s.toggleGoal);
  const setSupplyMode = useAdvisorStore((s) => s.setSupplyMode);
  const toggleService = useAdvisorStore((s) => s.toggleService);
  const [isOpen, setIsOpen] = useState(true);
  if (!selection) return null;

  const Icon = serviceIcon(service.iconKey);
  const config = selection.config;
  const goals = Array.isArray(config['goals']) ? (config['goals'] as string[]) : [];
  const SUPPLY_MODES: Array<{ value: SupplyMode; labelFa: string; icon: typeof Package }> = [
    { value: 'FULL_PACKAGE', labelFa: 'خرید کالا + نصب با ضمانت هومنتال', icon: Package },
    { value: 'INSTALL_ONLY', labelFa: 'فقط نصب — کالا را خودم دارم', icon: Wrench },
  ];

  return (
    <section className="card space-y-4">
      <header className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex flex-1 items-center gap-3 text-right"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-900 text-white">
            <Icon size={20} />
          </span>
          <span>
            <span className="flex items-center gap-2 font-extrabold text-slate-800">
              {service.titleFa}
              <span className="chip bg-emerald-50 text-xs text-emerald-700">
                گارانتی {toPersianDigits(service.warrantyMonths)} ماه
              </span>
            </span>
            <span className="block text-xs text-slate-500">{service.subtitleFa}</span>
          </span>
          <ChevronDown
            size={18}
            className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
        <button
          type="button"
          onClick={() => toggleService(service.key)}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
        >
          حذف
        </button>
      </header>

      {isOpen ? (
        <div className="space-y-4">
          {/* Per-item supply mode (Invariant 7) — schema-driven toggle */}
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="mb-2 text-xs font-bold text-slate-600">حالت تأمین این سرویس:</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SUPPLY_MODES.map((mode) => {
                const active = selection.supplyMode === mode.value;
                return (
                  <button
                    key={mode.value}
                    type="button"
                    onClick={() => setSupplyMode(service.key, mode.value)}
                    className={`flex items-center gap-2 rounded-xl border p-3 text-right text-xs transition-all ${
                      active
                        ? 'border-primary-600 bg-primary-50 font-bold text-primary-800'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    <mode.icon size={16} className={active ? 'text-primary-700' : 'text-slate-400'} />
                    {mode.labelFa}
                  </button>
                );
              })}
            </div>
          </div>

          {/* uiSchema.steps[] → FieldFactory (merged defaults underneath sparse config) */}
          {(service.uiSchema.steps ?? []).map((step) => (
            <div key={step.id} className="space-y-3">
              <p className="text-sm font-extrabold text-slate-700">{step.titleFa}</p>
              {step.descriptionFa ? (
                <p className="text-xs text-slate-500">{step.descriptionFa}</p>
              ) : null}
              <div className="space-y-2">
                {(step.fields ?? [])
                  .filter(
                    (field) =>
                      !field.locationTypes ||
                      (service.supportedLocationTypes ?? []).some(() => true),
                  )
                  .map((field: UiField) => (
                    <FieldFactory
                      key={field.id}
                      field={field}
                      value={config[field.pricingVar ?? field.id]}
                      onChange={(value) => setConfigValue(service.key, field.pricingVar ?? field.id, value)}
                    />
                  ))}
              </div>
            </div>
          ))}

          {/* goalCards — tactile multi-select intent cards */}
          {service.uiSchema.goalCards ? (
            <div className="space-y-2">
              <p className="text-sm font-extrabold text-slate-700">
                {service.uiSchema.goalCards.titleFa}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(service.uiSchema.goalCards.cards ?? []).map((card) => {
                  const active = goals.includes(card.id);
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => toggleGoal(service.key, card.id)}
                      className={`rounded-xl border p-3 text-right transition-all ${
                        active
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-slate-200 bg-white hover:border-primary-300'
                      }`}
                    >
                      <span className={`block text-sm font-bold ${active ? 'text-emerald-700' : 'text-slate-700'}`}>
                        {card.titleFa}
                      </span>
                      {card.descriptionFa ? (
                        <span className="mt-0.5 block text-[11px] text-slate-500">{card.descriptionFa}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * THE schema-driven configurator: renders EVERY selected service purely from
 * its backend `uiSchema` — no hard-coded CCTV/Alarm/Jack/Shutter forms.
 */
export function DynamicServiceConfigurator() {
  const catalog = useAdvisorStore((s) => s.catalog);
  const selected = useAdvisorStore((s) => s.selected);
  const toggleService = useAdvisorStore((s) => s.toggleService);

  if (!catalog) return null;
  const allServices = catalog.pillars.flatMap((pillar) => pillar.services);
  const enabledKeys = Object.entries(selected)
    .filter(([, selection]) => selection?.enabled)
    .map(([key]) => key);

  const enabledServices = allServices.filter((service) =>
    enabledKeys.includes(service.key as ServiceKey),
  );

  if (enabledServices.length === 0) {
    return (
      <div className="card text-center text-sm text-slate-500">
        هنوز سرویسی انتخاب نشده است — از یکی از ۳ رکن امنیتی بالا شروع کنید.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {enabledServices.map((service) => (
        <ServiceConfiguratorCard key={service.key} service={service} />
      ))}
      {allServices.filter((service) => !enabledKeys.includes(service.key)).length > 0 ? (
        <p className="text-center text-xs text-slate-400">
          سرویس‌های دیگری در کاتالوگ موجود است؛ از پنل رکن‌ها اضافه کنید.
        </p>
      ) : null}
    </div>
  );
}
