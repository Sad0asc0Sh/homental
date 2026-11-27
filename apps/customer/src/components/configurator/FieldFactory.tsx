'use client';

import { Minus, Plus } from 'lucide-react';
import { toPersianDigits } from '@homental/shared';
import type { UiField } from '@homental/shared';

interface FieldFactoryProps {
  field: UiField;
  value: unknown;
  onChange: (value: unknown) => void;
}

/**
 * Renders ONE uiSchema field (STEPPER | CHIPS | SWITCH) and pipes changes
 * back into the store — 100% schema-driven, zero service-specific branches.
 */
export function FieldFactory({ field, value, onChange }: FieldFactoryProps) {
  if (field.type === 'STEPPER') {
    const min = field.min ?? 0;
    const max = field.max ?? 99;
    const step = field.step ?? 1;
    const numeric = typeof value === 'number' ? value : (field.default as number ?? min);
    const clamp = (next: number) => Math.min(max, Math.max(min, next));
    return (
      <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
        <div>
          <p className="text-sm font-bold text-slate-700">{field.labelFa}</p>
          {field.descriptionFa ? (
            <p className="text-xs text-slate-500">{field.descriptionFa}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="کاهش"
            onClick={() => onChange(clamp(numeric - step))}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
          >
            <Minus size={16} />
          </button>
          <span className="tabular-fa min-w-16 text-center text-lg font-extrabold text-primary-900">
            {toPersianDigits(numeric)}
            {field.unitFa ? <span className="mr-1 text-xs font-normal text-slate-500">{field.unitFa}</span> : null}
          </span>
          <button
            type="button"
            aria-label="افزایش"
            onClick={() => onChange(clamp(numeric + step))}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-900 text-white hover:bg-primary-700"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
    );
  }

  if (field.type === 'SWITCH') {
    const active = Boolean(value ?? field.default ?? false);
    return (
      <button
        type="button"
        role="switch"
        aria-checked={active}
        onClick={() => onChange(!active)}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-right transition-colors hover:border-primary-300"
      >
        <span className="flex-1">
          <span className="block text-sm font-bold text-slate-700">{field.labelFa}</span>
          {field.descriptionFa ? (
            <span className="block text-xs text-slate-500">{field.descriptionFa}</span>
          ) : null}
        </span>
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            active ? 'bg-emerald-500' : 'bg-slate-300'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
              active ? 'left-0.5' : 'right-0.5'
            }`}
          />
        </span>
      </button>
    );
  }

  // CHIPS (SINGLE | MULTI)
  const isMulti = field.select === 'MULTI';
  const selectedValues: string[] = isMulti
    ? Array.isArray(value)
      ? (value as string[])
      : []
    : [];
  const singleValue = typeof value === 'string' ? value : (field.default as string | undefined);
  return (
    <div className="space-y-2">
      <p className="text-sm font-bold text-slate-700">{field.labelFa}</p>
      {field.descriptionFa ? <p className="text-xs text-slate-500">{field.descriptionFa}</p> : null}
      <div className="flex flex-wrap gap-2">
        {(field.options ?? []).map((option) => {
          const active = isMulti
            ? selectedValues.includes(option.value)
            : singleValue === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                if (isMulti) {
                  onChange(
                    active
                      ? selectedValues.filter((v) => v !== option.value)
                      : [...selectedValues, option.value],
                  );
                } else {
                  onChange(option.value);
                }
              }}
              className={`chip border ${
                active
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-primary-300'
              }`}
            >
              <span className="font-bold">{option.labelFa}</span>
              {option.hintFa ? <span className="text-[11px] opacity-70">— {option.hintFa}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
