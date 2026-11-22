'use client';

import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Loader2, ShieldCheck, Wrench, X } from 'lucide-react';
import { api, ApiError, type WarrantyCard } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { formatToman, toPersianDigits } from '@/lib/format';

const CLAIM_STATUS_FA: Record<string, { labelFa: string; className: string }> = {
  OPEN: { labelFa: 'باز', className: 'bg-amber-50 text-amber-700' },
  IN_REVIEW: { labelFa: 'در بررسی', className: 'bg-sky-50 text-sky-700' },
  APPROVED: { labelFa: 'تأیید‌شده', className: 'bg-emerald-50 text-emerald-700' },
  RESOLVED: { labelFa: 'حل‌شده', className: 'bg-emerald-50 text-emerald-700' },
  REJECTED: { labelFa: 'رد‌شده', className: 'bg-red-50 text-red-600' },
};

function WarrantyCertificate({ card, onClaim }: { card: WarrantyCard; onClaim: (card: WarrantyCard) => void }) {
  const active = card.status === 'ACTIVE';
  const expiring = card.daysRemaining <= 30;
  return (
    <div className="overflow-hidden rounded-2xl">
      <div
        className={`relative p-5 text-white ${
          active ? 'bg-gradient-to-bl from-primary-900 to-primary-700' : 'bg-slate-500'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={22} className="text-emerald-300" />
            <span className="text-sm font-extrabold">گارانتی دیجیتال هومنتال</span>
          </div>
          <span className="chip text-[11px] font-bold">
            {active ? 'فعال' : card.status === 'IN_CLAIM' ? 'در حال پیگیری خرابی' : 'منقضی'}
          </span>
        </div>
        <p className="tabular-fa mt-3 text-lg font-extrabold tracking-wide">{card.policyNumber}</p>
        <p className="mt-1 text-[11px] text-primary-200">
          پوشش {toPersianDigits(card.coverageMonths)} ماهه — سفارش {card.order?.orderNumber ?? ''}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-primary-200">مهلت اعتبار</span>
          <span
            className={`tabular-fa text-sm font-extrabold ${expiring ? 'text-amber-300' : 'text-emerald-300'}`}
          >
            {toPersianDigits(card.daysRemaining)} روز باقی‌مانده
          </span>
        </div>
      </div>
      <div className="rounded-b-2xl bg-white p-4 ring-1 ring-slate-100">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-700">
          <Wrench size={14} className="text-primary-600" />
          تجهیزات ثبت‌شده (شماره سریال‌ها):
        </p>
        <div className="space-y-1">
          {(card.coverage ?? []).map((entry, index) => (
            <div key={index} className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-xs font-bold text-slate-700">{entry.titleFa ?? entry.serviceKey}</p>
              <p className="tabular-fa text-[11px] text-slate-500" dir="ltr">
                {entry.serials?.length ? entry.serials.join(' · ') : '—'}
              </p>
            </div>
          ))}
        </div>

        {card.claims.length > 0 ? (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs font-bold text-slate-600">تیکت‌های خرابی:</p>
            {card.claims.map((claim) => {
              const meta = CLAIM_STATUS_FA[claim.status] ?? { labelFa: claim.status, className: 'bg-slate-100' };
              return (
                <div key={claim.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                  <span className="truncate text-slate-600">{claim.descriptionFa}</span>
                  <span className={`chip text-[10px] font-bold ${meta.className}`}>{meta.labelFa}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        {active ? (
          <button
            type="button"
            onClick={() => onClaim(card)}
            className="mt-3 w-full rounded-xl border border-amber-300 bg-amber-50 py-2.5 text-xs font-bold text-amber-700 hover:bg-amber-100"
          >
            ثبت تیکت خرابی ضمانت
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ClaimModal({ card, onClose, onDone }: { card: WarrantyCard; onClose: () => void; onDone: () => void }) {
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createWarrantyClaim(card.id, description);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در ثبت تیکت.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm space-y-3" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
            <BadgeCheck size={16} className="text-amber-500" />
            تیکت خرابی ضمانت — {card.policyNumber}
          </h3>
          <button type="button" onClick={onClose} aria-label="بستن">
            <X size={16} className="text-slate-400" />
          </button>
        </div>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          placeholder="شرح مشکل را بنویسید (مثلاً: آژیر بیرونی صدا ندارد)"
          className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none"
        />
        <button type="button" onClick={submit} disabled={busy || description.length < 5} className="btn-primary w-full">
          {busy ? <Loader2 size={15} className="animate-spin" /> : 'ثبت تیکت'}
        </button>
        {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}

export default function WarrantiesPage() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [cards, setCards] = useState<WarrantyCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimCard, setClaimCard] = useState<WarrantyCard | null>(null);

  const reload = useCallback(() => {
    api.warrantiesMe()
      .then(setCards)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (accessToken) reload();
  }, [accessToken, reload]);

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl px-4 pt-10 text-center">
        <p className="card text-sm text-slate-600">برای مشاهده گارانتی‌ها ابتدا وارد شوید.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16 pt-6">
      <h1 className="mb-1 text-xl font-extrabold text-primary-950">ضمانت دیجیتال</h1>
      <p className="mb-6 text-xs text-slate-500">کارت‌های گارانتی فعال و تاریخچه تیکت‌ها</p>

      {error ? <p className="card text-sm font-bold text-red-600">{error}</p> : null}
      {!cards && !error ? (
        <div className="card flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="animate-spin" size={22} />
        </div>
      ) : null}

      {cards && cards.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          هنوز گارانتی فعالی ندارید — پس از تکمیل اولین نصب، کارت گارانتی اینجا نمایش داده می‌شود.
        </div>
      ) : null}

      <div className="space-y-5">
        {(cards ?? []).map((card) => (
          <WarrantyCertificate key={card.id} card={card} onClaim={setClaimCard} />
        ))}
      </div>

      {claimCard ? (
        <ClaimModal
          card={claimCard}
          onClose={() => setClaimCard(null)}
          onDone={() => {
            setClaimCard(null);
            reload();
          }}
        />
      ) : null}

      {cards && cards.length > 0 ? (
        <p className="mt-6 text-center text-[11px] text-slate-400">
          {formatToman(0)} هزینه ثبت تیکت — خدمات گارانتی رایگان است.
        </p>
      ) : null}
    </main>
  );
}
