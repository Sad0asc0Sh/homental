'use client';

import { useState } from 'react';
import { Loader2, Smartphone, X } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';

/** Phone OTP login modal — surfaces backend Persian errors + devCode hint in dev. */
export function AuthModal({ onDone }: { onDone: () => void }) {
  const requestOtp = useAuthStore((s) => s.requestOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitPhone = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await requestOtp(phone);
      setDevCode(result.devCode ?? null);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در ارسال کد.');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(phone, code);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در تأیید کد.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onDone}>
      <div className="card w-full max-w-sm" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-extrabold text-slate-800">
            <Smartphone size={18} className="text-primary-700" />
            ورود با شماره موبایل
          </h3>
          <button type="button" onClick={onDone} aria-label="بستن">
            <X size={18} className="text-slate-400" />
          </button>
        </div>

        {step === 'phone' ? (
          <div className="space-y-3">
            <input
              dir="ltr"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="09123456789"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-left font-bold focus:border-primary-400 focus:outline-none"
            />
            <button type="button" onClick={submitPhone} disabled={busy || phone.length < 10} className="btn-primary w-full">
              {busy ? <Loader2 size={16} className="animate-spin" /> : 'دریافت کد تأیید'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {devCode ? (
              <p className="rounded-xl bg-amber-50 p-3 text-center text-xs text-amber-700">
                حالت توسعه — کد آزمایشی: <span className="font-extrabold">{devCode}</span>
              </p>
            ) : null}
            <input
              dir="ltr"
              inputMode="numeric"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="کد ۶ رقمی"
              className="tabular-fa w-full rounded-xl border border-slate-200 px-4 py-3 text-center text-lg font-extrabold tracking-widest focus:border-primary-400 focus:outline-none"
            />
            <button type="button" onClick={submitCode} disabled={busy || code.length !== 6} className="btn-primary w-full">
              {busy ? <Loader2 size={16} className="animate-spin" /> : 'تأیید و ورود'}
            </button>
          </div>
        )}

        {error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
