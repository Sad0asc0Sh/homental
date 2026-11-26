'use client';

import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api, ApiError, type MeteredAdjustment } from '@/lib/api';
import { formatMeters, formatToman, generateUuid } from '@/lib/format';

interface Shortfall {
  available: string;
  amount: string;
  topupKey: string;
}

function shortfallFrom(error: unknown, adjustment: MeteredAdjustment): Shortfall | null {
  if (!(error instanceof ApiError) || error.statusCode !== 409) return null;
  const fields = error.payload;
  if (
    fields?.errorCode !== 'WALLET_SHORTFALL' || fields.currency !== 'TOMAN' ||
    fields.revision !== adjustment.baseRevision || fields.delta !== adjustment.deltaAmount ||
    typeof fields.available !== 'string' || !/^\d+$/.test(fields.available) ||
    typeof fields.shortfall !== 'string' || !/^[1-9]\d*$/.test(fields.shortfall) ||
    BigInt(fields.available) + BigInt(fields.shortfall) !== BigInt(adjustment.deltaAmount)
  ) return null;

  return { available: fields.available, amount: fields.shortfall, topupKey: generateUuid() };
}

export function MeteredAdjustmentCard({
  orderId,
  adjustment,
  onDone,
}: {
  orderId: string;
  adjustment: MeteredAdjustment;
  onDone: () => void;
}) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [shortfall, setShortfall] = useState<Shortfall | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<'APPROVED' | 'REJECTED' | null>(null);

  const decide = async (action: 'approve' | 'topup' | 'reject') => {
    if (inFlight.current || decided || (action === 'topup' && !shortfall)) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    let approving = false;
    try {
      if (action === 'reject') {
        await api.rejectMeteredAdjustment(orderId, adjustment.id);
        setDecided('REJECTED');
      } else {
        if (action === 'topup' && shortfall) {
          await api.walletTopup(shortfall.amount, shortfall.topupKey);
        }
        approving = true;
        await api.approveMeteredAdjustment(orderId, adjustment.id, `meter-approve:${adjustment.id}`);
        setDecided('APPROVED');
      }
      setShortfall(null);
      onDone();
    } catch (failure) {
      const shortage = approving ? shortfallFrom(failure, adjustment) : null;
      if (shortage) {
        setShortfall(shortage);
      } else {
        setError(failure instanceof ApiError ? failure.message : 'ثبت نتیجه بررسی متراژ ناموفق بود.');
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3" aria-label="بررسی متراژ واقعی">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-extrabold text-slate-800">بررسی متراژ واقعی</h2>
        <p className="tabular-fa text-sm font-extrabold text-primary-900">{formatToman(adjustment.deltaAmount, 'full')} مابه‌التفاوت</p>
      </header>
      <ul className="space-y-2">
        {adjustment.readings.map((line) => (
          <li key={line.lineKey} className="space-y-1 rounded-xl bg-slate-50 p-3 text-xs">
            <p className="font-bold text-slate-800">{line.titleFa}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600">
              <span>برآورد {formatMeters(line.estimatedCm)}</span>
              <span>اندازه‌گیری {formatMeters(line.actualCm)}</span>
            </div>
            <p className="break-all text-slate-600">مرجع عکس <bdi dir="ltr" className="font-mono">{line.photoAssetId}</bdi></p>
          </li>
        ))}
      </ul>
      {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p> : null}
      {decided ? (
        <p role="status" className="rounded-xl bg-primary-50 p-3 text-xs font-bold text-primary-800">
          {decided === 'APPROVED' ? 'متراژ تأیید شد و مابه‌التفاوت در امانت قرار گرفت.' : 'اعتراض به متراژ ثبت شد.'}
        </p>
      ) : (
        <>
          {shortfall ? (
            <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-950">
              <p role="status">موجودی {formatToman(shortfall.available, 'full')} · کسری {formatToman(shortfall.amount, 'full')}</p>
              <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void decide('topup')}>
                {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
                شارژ دقیق به مبلغ کسری و ادامه
              </button>
            </div>
          ) : (
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void decide('approve')}>
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
              تأیید و پرداخت مابه‌التفاوت
            </button>
          )}
          <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => void decide('reject')}>اعتراض به متراژ</button>
        </>
      )}
    </section>
  );
}
