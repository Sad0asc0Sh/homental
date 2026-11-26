import { Lock } from 'lucide-react';
import { formatMeters, formatNumberFa, formatToman } from '@/lib/format';
import type { ManagedInvoice } from '@/lib/types';

const BUCKET_LABELS = {
  FIXED: 'تجهیزات با قیمت ثابت',
  SERVICE_PACKAGE: 'بسته اجرا، لجستیک، پشتیبانی و ضمانت هومنتال',
  METERED: 'اقلام و اجرت متری برآوردشده',
};

export const ESCROW_AT_SUBMIT = 'با ثبت نهایی، مبلغ پیش‌فاکتور از کیف پول شما برای این سفارش در امانت (اسکرو) قرار می‌گیرد.';

export function TransparentInvoice({ invoice, escrowNote }: { invoice: ManagedInvoice; escrowNote: string }) {
  return (
    <section className="card space-y-3">
      <h2 className="text-base font-extrabold text-slate-800">پیش‌فاکتور شفاف هومنتال</h2>
      {invoice.buckets.map(({ bucket, titleFa, badgeFa, subtotal, lines }) => (
        <div key={bucket} className="space-y-2 rounded-xl bg-slate-50 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
            <h3 className="text-sm font-extrabold text-slate-800">{titleFa || BUCKET_LABELS[bucket]}</h3>
            <span className="tabular-fa text-sm font-extrabold text-slate-800">{formatToman(subtotal, 'full')}</span>
          </div>
          {bucket === 'FIXED' ? (
            <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
              {badgeFa || 'تأمین مستقیم به قیمت همکار — ۰٪ اضافه‌قیمت'}
            </span>
          ) : null}
          {lines.length ? (
            <ul className="space-y-2 border-t border-slate-200 pt-2">
              {lines.map((line) => (
                <li key={line.lineKey} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span>
                    {line.titleFa}
                    {line.unit === 'METER' || line.qty > 1 ? (
                      <span className="mr-1 text-slate-500">
                        ({line.quantityCm != null ? formatMeters(line.quantityCm) : `${formatNumberFa(line.qty)} ${line.unit === 'METER' ? 'متر' : 'عدد'}`} × {formatToman(line.unitPrice, 'full')})
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-fa">{formatToman(line.lineTotal, 'full')}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-500">قلمی در این بخش ثبت نشده است.</p>}
        </div>
      ))}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-200 pt-3 text-sm font-extrabold text-primary-950">
        <span>جمع پیش‌فاکتور</span>
        <span className="tabular-fa text-lg">{formatToman(invoice.total, 'full')}</span>
      </div>
      <p className="flex items-start gap-2 rounded-xl bg-primary-50 p-3 text-xs leading-6 text-primary-900">
        <Lock size={15} className="mt-1 shrink-0" aria-hidden="true" />
        {escrowNote}
      </p>
    </section>
  );
}
