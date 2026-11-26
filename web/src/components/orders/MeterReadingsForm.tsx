'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { api, type MeteredLine, type MeterReadingInput, type TechnicianMeteredAdjustment } from '@/lib/api';
import { formatMeters, toLatinDigits } from '@/lib/format';

const MAX_CM = 2_147_483_647;
const MAX_PHOTO_REFERENCE = 500;

function toCentimetres(value: string): number | null {
  const normalized = toLatinDigits(value.trim()).replace('٫', '.');
  if (!/^(?:\d{1,8}(?:\.\d{1,2})?|\.\d{1,2})$/.test(normalized)) return null;
  const [metres = '', fraction = ''] = normalized.split('.');
  const cm = Number(metres) * 100 + Number(fraction.padEnd(2, '0'));
  return cm <= MAX_CM ? cm : null;
}

interface DraftReading {
  metres: string;
  photoAssetId: string;
}

export function MeterReadingsForm({
  orderId,
  lines,
  latest,
  pending,
  reconciled,
  busy,
  runAction,
}: {
  orderId: string;
  lines: MeteredLine[];
  latest: TechnicianMeteredAdjustment | null;
  pending: TechnicianMeteredAdjustment | null;
  reconciled: boolean;
  busy: boolean;
  runAction: (action: () => Promise<unknown>) => void;
}) {
  const [draft, setDraft] = useState<Partial<Record<string, DraftReading>>>({});

  if (lines.length === 0) return null;
  const status = pending ? 'در انتظار تأیید مشتری' : reconciled ? 'تأیید شد' : null;
  if (status) {
    return (
      <section className={`space-y-1 rounded-xl p-3 text-xs ${pending ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`} aria-live="polite">
        <h3 className="font-extrabold">متراژ واقعی کابل و داکت</h3>
        <p className="font-bold">{status}</p>
        {pending ? <p>پس از تأیید مشتری می‌توانید کد تحویل را صادر کنید.</p> : null}
      </section>
    );
  }

  const readings = lines.flatMap<MeterReadingInput>(({ lineKey }) => {
    const fields = draft[lineKey];
    if (!fields) return [];
    const actualCm = toCentimetres(fields.metres);
    const photoAssetId = fields.photoAssetId.trim();
    return actualCm === null || !photoAssetId ? [] : [{ lineKey, actualCm, photoAssetId }];
  });

  const update = (lineKey: string, field: keyof DraftReading, value: string) => {
    setDraft((previous) => ({
      ...previous,
      [lineKey]: { ...(previous[lineKey] ?? { metres: '', photoAssetId: '' }), [field]: value },
    }));
  };

  return (
    <form
      className="space-y-3 rounded-xl border border-primary-100 bg-primary-50/50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && readings.length === lines.length) {
          runAction(() => api.submitMeterReadings(orderId, readings));
        }
      }}
    >
      <div className="space-y-1">
        <h3 className="text-sm font-extrabold text-primary-950">ثبت متراژ واقعی کابل و داکت</h3>
        <p className="text-xs leading-5 text-slate-600">متراژ هر ردیف را به متر و تا دو رقم اعشار وارد کنید و مرجع عکس آن را بنویسید.</p>
        {latest?.status === 'REJECTED' ? (
          <p role="status" className="text-xs font-bold text-amber-800">مشتری به متراژ قبلی اعتراض کرد. متراژ را دوباره اندازه‌گیری کنید.</p>
        ) : null}
      </div>
      {lines.map(({ lineKey, titleFa, estimatedCm }) => (
        <fieldset key={lineKey} className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
          <legend className="px-1 text-xs font-bold text-slate-800">{titleFa}</legend>
          <p className="text-xs text-slate-600 sm:col-span-2">برآورد {formatMeters(estimatedCm)}</p>
          <label className="space-y-1 text-xs text-slate-700">
            <span>متراژ واقعی (متر)</span>
            <input
              value={draft[lineKey]?.metres ?? ''}
              onChange={(event) => update(lineKey, 'metres', event.target.value)}
              className="w-full rounded-lg border border-slate-200 p-2 focus:border-primary-400 focus:outline-none"
              inputMode="decimal"
              placeholder="مثلاً ۱۲٫۵۰"
              maxLength={11}
              required
            />
          </label>
          <label className="space-y-1 text-xs text-slate-700">
            <span>شناسه یا مرجع عکس</span>
            <input
              dir="ltr"
              value={draft[lineKey]?.photoAssetId ?? ''}
              onChange={(event) => update(lineKey, 'photoAssetId', event.target.value)}
              className="w-full rounded-lg border border-slate-200 p-2 focus:border-primary-400 focus:outline-none"
              maxLength={MAX_PHOTO_REFERENCE}
              required
            />
          </label>
        </fieldset>
      ))}
      <button type="submit" disabled={busy || readings.length !== lines.length} className="btn-primary w-full">
        {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : 'ثبت اندازه‌گیری'}
      </button>
    </form>
  );
}
