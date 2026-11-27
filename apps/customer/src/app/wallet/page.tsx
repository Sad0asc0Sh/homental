'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, LogIn, RefreshCw } from 'lucide-react';
import { AuthModal } from '@/components/brief/AuthModal';
import { WalletBalance, WalletLedger } from '@/components/wallet/WalletLedger';
import { api, ApiError, type WalletMe } from '@homental/api-client';
import { formatToman, generateUuid, toLatinDigits } from '@homental/shared';
import { useAuthStore } from '@/store/auth.store';

const TOPUP_PRESETS = [
  { amount: '2000000', labelFa: '۲ میلیون تومان' },
  { amount: '5000000', labelFa: '۵ میلیون تومان' },
  { amount: '10000000', labelFa: '۱۰ میلیون تومان' },
  { amount: '20000000', labelFa: '۲۰ میلیون تومان' },
];

function WalletAccount({ role }: { role: string }) {
  const [data, setData] = useState<WalletMe | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [amount, setAmount] = useState('2000000');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const request = useRef(0);
  const topupAttempt = useRef<{ amount: string; key: string } | null>(null);
  const canTopUp = role === 'CUSTOMER' || role === 'TECHNICIAN';

  const reload = useCallback(async (page = 1) => {
    const sequence = ++request.current;
    setRefreshing(true);
    setError('');
    try {
      const result = await api.walletMe(page);
      if (sequence === request.current) setData(result);
    } catch (failure) {
      if (sequence === request.current) setError(failure instanceof ApiError ? failure.message : 'بارگیری کیف پول ناموفق بود.');
    } finally {
      if (sequence === request.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => { request.current += 1; };
  }, [reload]);

  const validAmount = /^\d{1,19}$/.test(amount) && BigInt(amount) > BigInt(0) && BigInt(amount) <= BigInt('9223372036854775807');

  const topUp = async () => {
    if (!validAmount || busy || !canTopUp) return;
    setBusy(true);
    setError('');
    setMessage('');
    const canonical = BigInt(amount).toString();
    const attempt = topupAttempt.current?.amount === canonical ? topupAttempt.current : { amount: canonical, key: generateUuid() };
    topupAttempt.current = attempt;
    try {
      await api.walletTopup(attempt.amount, attempt.key);
      topupAttempt.current = null;
      setMessage('شارژ با موفقیت انجام شد.');
      await reload();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'شارژ کیف پول ناموفق بود.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 pb-16 pt-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold text-primary-950">کیف پول هومنتال</h1>
        <button type="button" onClick={() => void reload(data?.page)} disabled={refreshing} className="btn-ghost !px-3 !py-2 text-xs">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> به‌روزرسانی
        </button>
      </header>
      {data ? <WalletBalance data={data} /> : refreshing ? <Loader2 size={22} className="animate-spin text-slate-500" aria-label="در حال بارگیری" /> : null}
      {canTopUp ? (
        <section className="card space-y-3">
          <h2 className="text-sm font-extrabold">شارژ سریع کیف پول</h2>
          <div className="flex flex-wrap gap-2">
            {TOPUP_PRESETS.map((preset) => (
              <button key={preset.amount} type="button" aria-pressed={amount === preset.amount} onClick={() => setAmount(preset.amount)}
                className={'chip border text-xs font-bold ' + (amount === preset.amount ? 'border-primary-500 bg-primary-50 text-primary-800' : 'border-slate-200 text-slate-700')}>
                {preset.labelFa}
              </button>
            ))}
          </div>
          <label className="block space-y-1 text-xs font-bold">مبلغ به تومان
            <input dir="ltr" inputMode="numeric" value={amount} maxLength={19}
              onChange={(event) => setAmount(toLatinDigits(event.target.value).replace(/\D/g, ''))}
              className="tabular-fa w-full rounded-xl border border-slate-200 px-4 py-2.5 font-bold focus:border-primary-400 focus:outline-none" />
          </label>
          <button type="button" onClick={() => void topUp()} disabled={busy || !validAmount} className="btn-primary w-full">
            {busy ? <Loader2 size={16} className="animate-spin" /> : null} شارژ {validAmount ? formatToman(amount, 'full') : ''}
          </button>
          {message ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">{message}</p> : null}
        </section>
      ) : null}
      {error ? <p role="alert" className="card text-sm font-bold text-red-700">{error}</p> : null}
      {data ? <WalletLedger data={data} loading={refreshing} onPage={(page) => void reload(page)} /> : null}
    </main>
  );
}

export default function WalletPage() {
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const user = useAuthStore((state) => state.user);
  const [loginOpen, setLoginOpen] = useState(false);

  if (hasHydrated && user) return <WalletAccount key={user.id} role={user.role} />;
  return (
    <main className="mx-auto max-w-2xl px-4 pt-10 text-center">
      <div className="card space-y-3">
        {hasHydrated ? (
          <>
            <p className="text-sm text-slate-600">برای مشاهده کیف پول وارد شوید.</p>
            <button type="button" onClick={() => setLoginOpen(true)} className="btn-primary"><LogIn size={16} /> ورود با شماره موبایل</button>
          </>
        ) : <Loader2 size={22} className="mx-auto animate-spin text-slate-500" aria-label="در حال بارگیری" />}
      </div>
      {loginOpen ? <AuthModal onDone={() => setLoginOpen(false)} /> : null}
    </main>
  );
}
