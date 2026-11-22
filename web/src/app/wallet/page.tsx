'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Loader2, Lock } from 'lucide-react';
import { api, ApiError, type WalletMe } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { formatToman, toPersianDigits } from '@/lib/format';

const TX_TYPE_FA: Record<string, { labelFa: string; icon: typeof ArrowDownToLine; className: string }> = {
  TOPUP: { labelFa: 'شارژ کیف پول', icon: ArrowDownToLine, className: 'text-emerald-600' },
  ESCROW_HOLD: { labelFa: 'مسدودسازی اسکرو', icon: Lock, className: 'text-amber-600' },
  ESCROW_RELEASE: { labelFa: 'آزادسازی اسکرو', icon: ArrowUpFromLine, className: 'text-slate-600' },
  REFUND: { labelFa: 'بازگشت وجه', icon: ArrowDownToLine, className: 'text-emerald-600' },
  PLATFORM_COMMISSION: { labelFa: 'کمیسیون پلتفرم', icon: ArrowUpFromLine, className: 'text-slate-500' },
  WARRANTY_RESERVE: { labelFa: 'ذخیره گارانتی', icon: Lock, className: 'text-slate-500' },
  TECHNICIAN_PAYOUT: { labelFa: 'تسویه تکنسین', icon: ArrowDownToLine, className: 'text-emerald-600' },
};

export default function WalletPage() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const [data, setData] = useState<WalletMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('2000000');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.walletMe()
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (accessToken) reload();
  }, [accessToken, reload]);

  const topUp = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.walletTopup(Number(amount), crypto.randomUUID());
      setMessage('شارژ با موفقیت انجام شد.');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در شارژ کیف پول.');
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10 text-center">
        <p className="card text-sm text-slate-600">برای مشاهده کیف پول ابتدا وارد شوید.</p>
      </main>
    );
  }

  const balance = data?.wallet.balance ?? '0';
  const escrow = data?.wallet.heldInEscrow ?? '0';

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 pb-16 pt-6">
      <h1 className="text-xl font-extrabold text-primary-950">کیف پول هومنتال</h1>

      <section className="card grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-primary-50 p-4">
          <p className="text-[11px] text-slate-500">موجودی قابل هزینه</p>
          <p className="tabular-fa mt-1 text-lg font-extrabold text-primary-950">{formatToman(balance)}</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-4">
          <p className="flex items-center gap-1 text-[11px] text-amber-700">
            <Lock size={12} />
            مسدود در اسکرو
          </p>
          <p className="tabular-fa mt-1 text-lg font-extrabold text-amber-800">{formatToman(escrow)}</p>
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm font-extrabold text-slate-800">شارژ سریع (MVP — درگاه پرداخت به‌زودی)</h2>
        <div className="flex gap-2">
          <input
            dir="ltr"
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="tabular-fa flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-left font-bold focus:border-primary-400 focus:outline-none"
          />
          <button type="button" onClick={topUp} disabled={busy || Number(amount) <= 0} className="btn-primary !px-4">
            {busy ? <Loader2 size={16} className="animate-spin" /> : 'شارژ'}
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          مبلغ پیشنهادی: {formatToman(amount, 'full')}
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
              <div key={tx.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-white ${meta.className}`}>
                    <Icon size={15} />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-slate-700">{meta.labelFa}</p>
                    <p className="text-[10px] text-slate-400">
                      {tx.description ?? ''} —{' '}
                      {toPersianDigits(new Date(tx.createdAt).toLocaleDateString('fa-IR'))}
                    </p>
                  </div>
                </div>
                <div className="text-left">
                  <p className={`tabular-fa text-sm font-extrabold ${credit ? 'text-emerald-600' : 'text-slate-700'}`}>
                    {credit ? '+' : '−'} {formatToman(tx.amount.replace('-', ''))}
                  </p>
                  <p className="tabular-fa text-[10px] text-slate-400">
                    مانده: {formatToman(tx.balanceAfter)}
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
