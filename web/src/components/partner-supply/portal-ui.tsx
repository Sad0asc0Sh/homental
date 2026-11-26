'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bike, Loader2, LogIn, Truck, X } from 'lucide-react';
import { AuthModal } from '@/components/brief/AuthModal';
import { api, ApiError } from '@/lib/api';
import { formatMeters, formatNumberFa, formatToman } from '@/lib/format';
import type { DeliveryMode, FulfillmentStatus, SupplierCase, SupplierCaseStatus, SupplierCaseType, SupplyLine } from '@/lib/partner-supply.types';
import { useAuthStore } from '@/store/auth.store';

export const supplyField = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-primary-400 focus:outline-none disabled:bg-slate-100';

export const CASE_TYPE: Record<SupplierCaseType, string> = {
  UNUSED_RETURN: 'برگشت کالای استفاده‌نشده',
  EXCHANGE: 'تعویض',
  REPAIR: 'مرکز تعمیرات',
  TECH_GUIDANCE: 'راهنمایی فنی نصاب',
};

export const CASE_STATUS: Record<SupplierCaseStatus, string> = {
  OPEN: 'ثبت شده',
  IN_REVIEW: 'در حال بررسی',
  APPROVED: 'تأیید شد',
  INSPECTED_ACCEPTED: 'پس از بررسی پذیرفته شد',
  REJECTED: 'رد شد',
  RESOLVED: 'انجام شد',
  CANCELLED: 'لغو شد',
};

export const FULFILLMENT_STATUS: Record<FulfillmentStatus, string> = {
  RESERVED: 'رزروشده',
  DISPATCHED: 'ارسال‌شده',
  DELIVERED: 'تحویل‌شده',
  CANCELLED: 'لغوشده',
};

export function supplyError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function SupplyPortalAccess({ role, children }: { role: 'TECHNICIAN' | 'SELLER'; children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const hydrated = useAuthStore((state) => state.hasHydrated);
  const [loginOpen, setLoginOpen] = useState(false);
  if (hydrated && user?.role === role) return <div key={user.id}>{children}</div>;
  return (
    <main className="mx-auto max-w-lg px-4 pt-10">
      <section className="card space-y-3 text-center text-sm text-slate-700">
        {!hydrated ? <Loader2 size={22} className="mx-auto animate-spin" aria-label="در حال بارگیری" /> : (
          <>
            <p>{role === 'SELLER' ? 'برای استفاده از این بخش با حساب فروشنده وارد شوید.' : 'برای استفاده از این بخش با حساب نصاب وارد شوید.'}</p>
            {user ? null : (
              <button type="button" className="btn-primary" onClick={() => setLoginOpen(true)}><LogIn size={16} /> ورود</button>
            )}
          </>
        )}
      </section>
      {loginOpen ? <AuthModal onDone={() => setLoginOpen(false)} /> : null}
    </main>
  );
}

export function PortalTabs<T extends string>({ items, current, onChange }: {
  items: ReadonlyArray<{ id: T; label: string }>;
  current: T;
  onChange: (tab: T) => void;
}) {
  return (
    <nav aria-label="بخش‌های پنل" className="flex flex-wrap gap-1 rounded-2xl bg-white p-1.5 ring-1 ring-slate-100">
      {items.map(({ id, label }) => (
        <button key={id} type="button" aria-pressed={id === current} onClick={() => onChange(id)}
          className={'rounded-xl px-4 py-2.5 text-sm font-bold ' + (id === current ? 'bg-primary-900 text-white' : 'text-slate-600 hover:bg-primary-50')}>
          {label}
        </button>
      ))}
    </nav>
  );
}

export function DeliveryBadge({ mode }: { mode: DeliveryMode }) {
  return mode === 'BIKE'
    ? <span className="chip bg-emerald-50 text-xs font-bold text-emerald-800"><Bike size={15} aria-hidden="true" /> پیک</span>
    : <span className="chip bg-amber-50 text-xs font-bold text-amber-900"><Truck size={15} aria-hidden="true" /> ماشین</span>;
}

export function LineQuantity({ line }: { line: Pick<SupplyLine, 'unit' | 'qty' | 'quantityCm'> }) {
  return line.unit === 'METER' ? formatMeters(line.quantityCm ?? line.qty * 100) : formatNumberFa(line.qty) + ' عدد';
}

export function SupplyDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open) dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog ref={dialogRef} aria-label={title} onCancel={onClose}
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg rounded-2xl border-0 bg-white p-5 text-slate-800 shadow-xl backdrop:bg-slate-950/50">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="بستن" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button>
      </div>
      {children}
    </dialog>
  );
}

export function SupplierCaseThread({ ticket, role, children, onUpdated }: {
  ticket: SupplierCase;
  role: 'TECHNICIAN' | 'SELLER';
  children?: ReactNode;
  onUpdated: (ticket: SupplierCase) => void;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const closed = ['INSPECTED_ACCEPTED', 'REJECTED', 'RESOLVED', 'CANCELLED'].includes(ticket.status);

  const send = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending || !message.trim()) return;
    setSending(true);
    setError('');
    try {
      onUpdated(await api.messageSupplierCase(ticket.id, message.trim()));
      setMessage('');
    } catch (failure) {
      setError(supplyError(failure, 'ارسال پیام ناموفق بود.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <details className="card space-y-4">
      <summary className="cursor-pointer text-sm font-bold text-primary-900">
        {CASE_TYPE[ticket.type]} <bdi dir="ltr" className="font-mono text-xs">{ticket.caseNumber}</bdi>
        <span className="chip ms-2 bg-primary-50 text-xs text-primary-800">{CASE_STATUS[ticket.status]}</span>
      </summary>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-slate-500">
          {role === 'TECHNICIAN' ? ticket.sellerShopNameFa : null}
          {ticket.sku ? <bdi dir="ltr" className="ms-2 font-mono">{ticket.sku}</bdi> : null}
          {ticket.serialNumber ? <span className="ms-2">سریال <bdi dir="ltr">{ticket.serialNumber}</bdi></span> : null}
        </p>
        {ticket.type !== 'TECH_GUIDANCE' ? <p className="whitespace-pre-wrap break-words">{ticket.reasonFa}</p> : null}
        {ticket.requestedQty != null ? <p>تعداد درخواستی {formatNumberFa(ticket.requestedQty)}</p> : null}
        {ticket.approvedQty != null ? <p>تعداد تأییدشده {formatNumberFa(ticket.approvedQty)}</p> : null}
        {ticket.inspectionNoteFa ? <p className="rounded-xl bg-slate-50 p-3">نتیجه بررسی · {ticket.inspectionNoteFa}</p> : null}
        {ticket.refundAmount != null && BigInt(ticket.refundAmount) > BigInt(0) ? <p>بازگشت وجه · {formatToman(ticket.refundAmount, 'full')}</p> : null}
        {ticket.priceDelta != null ? <p>مابه‌التفاوت تعویض · {formatToman(ticket.priceDelta, 'full')}</p> : null}
        {ticket.messages.length > 0 ? (
          <ul aria-label="گفتگو" className="max-h-72 space-y-2 overflow-y-auto">
            {ticket.messages.map((entry, index) => (
              <li key={entry.at + index} className={'rounded-xl px-3 py-2 ' + (entry.senderRole === role ? 'bg-primary-50' : 'bg-slate-50')}>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>{entry.senderRole === role ? 'شما' : entry.senderRole === 'SELLER' ? 'فروشنده' : 'نصاب'}</span>
                  <time dateTime={entry.at}>{new Date(entry.at).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' })}</time>
                </div>
                <p className="whitespace-pre-wrap break-words">{entry.textFa}</p>
              </li>
            ))}
          </ul>
        ) : null}
        {!closed ? (
          <form onSubmit={send} className="flex flex-wrap items-end gap-2">
            <label className="min-w-40 flex-1 space-y-1 text-xs font-bold">پیام
              <textarea required rows={2} maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} className={supplyField} />
            </label>
            <button type="submit" disabled={sending || !message.trim()} className="btn-primary">ارسال پیام</button>
          </form>
        ) : null}
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        {children}
      </div>
    </details>
  );
}
