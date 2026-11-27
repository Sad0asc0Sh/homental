import { ArrowDownToLine, ArrowUpFromLine, Lock } from 'lucide-react';
import type { WalletMe } from '@homental/api-client';
import { formatNumberFa, formatToman, WALLET_TX_TYPE_FA } from '@homental/shared';

export function WalletBalance({ data }: { data: WalletMe | null }) {
  return (
    <section className="card grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-xl bg-primary-50 p-4">
        <p className="text-xs text-slate-500">موجودی قابل هزینه</p>
        <p className="tabular-fa mt-1 text-lg font-extrabold text-primary-950">{formatToman(data?.wallet.balance ?? '0', 'full')}</p>
      </div>
      <div className="rounded-xl bg-amber-50 p-4">
        <p className="flex items-center gap-1 text-xs text-amber-800"><Lock size={13} /> مبلغ در امانت</p>
        <p className="tabular-fa mt-1 text-lg font-extrabold text-amber-900">{formatToman(data?.wallet.heldInEscrow ?? '0', 'full')}</p>
      </div>
    </section>
  );
}

export function WalletLedger({ data, onPage, loading }: { data: WalletMe; onPage?: (page: number) => void; loading?: boolean }) {
  return (
    <section className="card space-y-3">
      <h2 className="text-sm font-extrabold">گردش حساب</h2>
      <ul className="space-y-2">
        {data.transactions.map((entry) => {
          const amount = BigInt(entry.amount);
          const credit = amount > BigInt(0);
          const Icon = credit ? ArrowDownToLine : ArrowUpFromLine;
          return (
            <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={'shrink-0 rounded-lg bg-white p-2 ' + (credit ? 'text-emerald-700' : 'text-slate-600')}><Icon size={15} /></span>
                <div>
                  <p className="text-xs font-bold">{WALLET_TX_TYPE_FA[entry.type] ?? entry.type}</p>
                  <p className="break-words text-xs text-slate-600">{entry.description}</p>
                  <time dateTime={entry.createdAt} className="text-xs text-slate-500">{new Date(entry.createdAt).toLocaleDateString('fa-IR')}</time>
                </div>
              </div>
              <div className="tabular-fa text-left">
                <p className={'text-sm font-extrabold ' + (credit ? 'text-emerald-700' : 'text-slate-800')}>
                  {credit ? '+ ' : amount < BigInt(0) ? '− ' : ''}{formatToman((amount < BigInt(0) ? -amount : amount).toString(), 'full')}
                </p>
                <p className="text-xs text-slate-500">مانده · {formatToman(entry.balanceAfter, 'full')}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {data.transactions.length === 0 ? <p className="text-sm text-slate-500">تراکنشی ثبت نشده است.</p> : null}
      <footer className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <p>{formatNumberFa(data.total)} تراکنش</p>
        {onPage && data.total > data.limit ? (
          <div className="flex items-center gap-1">
            <button type="button" disabled={loading || data.page <= 1} onClick={() => onPage(data.page - 1)} className="btn-ghost !px-2 !py-1.5 text-xs disabled:opacity-40">قبلی</button>
            <span className="px-1">{formatNumberFa(data.page)}</span>
            <button type="button" disabled={loading || data.page * data.limit >= data.total} onClick={() => onPage(data.page + 1)} className="btn-ghost !px-2 !py-1.5 text-xs disabled:opacity-40">بعدی</button>
          </div>
        ) : null}
      </footer>
    </section>
  );
}
