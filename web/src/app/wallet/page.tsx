'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Loader2, Lock, LogIn, RefreshCw } from 'lucide-react';
import { AuthModal } from '@/components/brief/AuthModal';
import { api, ApiError, type WalletMe } from '@/lib/api';
import { formatToman, generateUuid, toLatinDigits, toPersianDigits } from '@/lib/format';
import { useAuthStore } from '@/store/auth.store';

const TX_TYPE_FA: Record<string, { labelFa: string; icon: typeof ArrowDownToLine; className: string }> = {
  TOPUP: { labelFa: 'شارژ کیف پول', icon: ArrowDownToLine, className: 'text-emerald-600' },
  ESCROW_HOLD: { labelFa: 'مسدودسازی اسکرو', icon: Lock, className: 'text-amber-600' },
  ESCROW_RELEASE: { labelFa: 'آزادسازی اسکرو', icon: ArrowUpFromLine, className: 'text-slate-600' },
  REFUND: { labelFa: 'بازگشت وجه', icon: ArrowDownToLine, className: 'text-emerald-600' },
  PLATFORM_COMMISSION: { labelFa: 'کمیسیون پلتفرم', icon: ArrowUpFromLine, className: 'text-slate-500' },
  WARRANTY_RESERVE: { labelFa: 'ذخیره گارانتی', icon: Lock, className: 'text-slate-500' },
  TECHNICIAN_PAYOUT: { labelFa: 'تسویه تکنسین', icon: ArrowDownToLine, className: 'text-emerald-600' },
};

const TOPUP_PRESETS = [
  { amount: '2000000', labelFa: '۲ میلیون تومان' },
  { amount: '5000000', labelFa: '۵ میلیون تومان' },
  { amount: '10000000', labelFa: '۱۰ میلیون تومان' },
  { amount: '20000000', labelFa: '۲۰ میلیون تومان' },
];

export default function WalletPage() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [data, setData] = useState<WalletMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [amount, setAmount] = useState('2000000');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

  const reload = useCallback(() => {
    if (!accessToken) return;
    setRefreshing(true);
    setError(null);
    api.walletMe()
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setRefreshing(false));
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      setData(null);
      setError(null);
      return;
    }
    reload();
  }, [accessToken, reload]);

  const numericAmount = Number(toLatinDigits(amount).replace(/\D/g, '') || '0');

  const topUp = async () => {
    if (numericAmount <= 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.walletTopup(numericAmount, generateUuid());
      setMessage('شارژ با موفقیت انجام شد.');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در شارژ کیف پول.');
    } finally {
      setBusy(false);
    }
  };

  if (!hasHydrated) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10">
        <div className="card flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="animate-spin" size={22} />
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10 text-center">
        <div className="card space-y-3">
          <p className="text-sm text-slate-600">برای مشاهده کیف پول ابتدا وارد شوید.</p>
          <button type="button" onClick={() => setAuthOpen(true)} className="btn-primary mx-auto">
            <LogIn size={16} />
            ورود با شماره موبایل
          </button>
        </div>
        {authOpen ? <AuthModal onDone={() => setAuthOpen(false)} /> : null}
      </main>
    );
  }

  const balance = data?.wallet.balance ?? '0';
  const escrow = data?.wallet.heldInEscrow ?? '0';

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 pb-16 pt-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold text-primary-950">کیف پول هومنتال</h1>
        <button
          type="button"
          onClick={reload}
          disabled={refreshing}
          className="btn-ghost !px-3 !py-2 text-xs"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          بروزرسانی
        </button>
      </header>

      <section className="card grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-primary-50 p-4">
          <p className="text-[11px] text-slate-500">موجودی قابل هزینه</p>
          <p className="tabular-fa mt-1 text-lg font-extrabold text-primary-950">
            {formatToman(balance, 'full')}
          </p>
        </div>
        <div className="rounded-xl bg-amber-50 p-4">
          <p className="flex items-center gap-1 text-[11px] text-amber-700">
            <Lock size={12} />
            مسدود در اسکرو
          </p>
          <p className="tabular-fa mt-1 text-lg font-extrabold text-amber-800">
            {formatToman(escrow, 'full')}
          </p>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-extrabold text-slate-800">شارژ سریع (MVP — درگاه پرداخت به‌زودی)</h2>
        <div className="flex flex-wrap gap-2">
          {TOPUP_PRESETS.map((preset) => (
            <button
              key={preset.amount}
              type="button"
              onClick={() => setAmount(preset.amount)}
              className={`chip border text-xs font-bold ${
                toLatinDigits(amount) === preset.amount
                  ? 'border-primary-600 bg-primary-50 text-primary-800'
                  : 'border-slate-200 text-slate-600 hover:border-primary-300'
              }`}
            >
              {preset.labelFa}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            dir="ltr"
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(toLatinDigits(event.target.value).replace(/\D/g, ''))}
            placeholder="مبلغ به تومان"
            className="tabular-fa flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-left font-bold focus:border-primary-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={topUp}
            disabled={busy || numericAmount <= 0}
            className="btn-primary !px-5"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : 'شارژ'}
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          مبلغ انتخابی: {numericAmount > 0 ? formatToman(numericAmount, 'full') : '—'}
        </p>
        {message ? <p className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">{message}</p> : null}
      </section>

      {error ? <p className="card text-sm font-bold text-red-600">{error}</p> : null}

      <section className="card">
        <h2 className="mb-3 text-sm font-extrabold text-slate-800">گردش حساب</h2>
        <div className="space-y-2">
          {(data?.transactions ?? []).map((tx) => {
            const meta = TX_TYPE_FA[tx.type] ?? { labelFa: tx.type, icon: ArrowDownToLine, className: 'text-slate-500' };
            const Icon = meta.icon;
            const credit = Number(tx.amount) > 0;
            return (
              <div key={tx.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white ${meta.className}`}>
                    <Icon size={15} />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-slate-700">{meta.labelFa}</p>
                    <p className="text-[10px] text-slate-400">
                      {tx.description ? `${tx.description} — ` : ''}
                      {toPersianDigits(new Date(tx.createdAt).toLocaleDateString('fa-IR'))}
                    </p>
                  </div>
                </div>
                <div className="text-left">
                  <p className={`tabular-fa text-sm font-extrabold ${credit ? 'text-emerald-600' : 'text-slate-700'}`}>
                    {credit ? '+' : '−'} {formatToman(tx.amount.replace('-', ''), 'full')}
                  </p>
                  <p className="tabular-fa text-[10px] text-slate-400">
                    مانده: {formatToman(tx.balanceAfter, 'full')}
                  </p>
                </div>
              </div>
            );
          })}
          {data && data.transactions.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">تراکنشی ثبت نشده است.</p>
          ) : null}
        </div>
        {data ? (
          <p className="mt-3 text-center text-[11px] text-slate-400">
            {toPersianDigits(data.total)} تراکنش
          </p>
        ) : null}
      </section>
    </main>
  );
}
