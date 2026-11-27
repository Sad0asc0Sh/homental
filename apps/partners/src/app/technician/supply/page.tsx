'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { api, type WalletMe } from '@homental/api-client';
import { formatNumberFa, formatToman, toLatinDigits } from '@homental/shared';
import type { B2BFulfillment, B2BSupplyOrder, B2BSupplyStatus, SupplierCase, SupplyCatalog } from '@homental/shared';
import { SupplyShop } from '@/components/partner-supply/SupplyShop';
import {
  CASE_TYPE, DeliveryBadge, FULFILLMENT_STATUS, LineQuantity, PortalTabs, SupplierCaseThread, SupplyDialog,
  SupplyPortalAccess, supplyError, supplyField,
} from '@/components/partner-supply/portal-ui';

const TABS = [
  { id: 'shop', label: 'فروشگاه همکار' },
  { id: 'orders', label: 'سفارش‌های تأمین و خدمات پس از فروش' },
  { id: 'guidance', label: 'راهنمایی فنی نصاب' },
] as const;

const ORDER_STATUS: Record<B2BSupplyStatus, string> = {
  FUNDED_RESERVED: 'پرداخت و رزرو شد',
  DISPATCHED: 'در حال ارسال',
  DELIVERED: 'تحویل کامل',
  CANCELLED: 'لغوشده',
};

const CASE_CHOICES = ['UNUSED_RETURN', 'EXCHANGE', 'REPAIR'] as const;
type CaseChoice = (typeof CASE_CHOICES)[number];

interface CaseLine {
  type: CaseChoice;
  fulfillment: B2BFulfillment;
  line: B2BFulfillment['lines'][number];
}

function LineCaseForm({ target, onClose, onCreated }: { target: CaseLine; onClose: () => void; onCreated: (ticket: SupplierCase) => void }) {
  const [qty, setQty] = useState('1');
  const [serialNumber, setSerialNumber] = useState('');
  const [reasonFa, setReasonFa] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const needsQuantity = target.type !== 'REPAIR';
  const count = Number(qty);
  const ready = reasonFa.trim().length > 0 && (!needsQuantity || (Number.isInteger(count) && count > 0 && count <= target.line.qty));

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      onCreated(await api.createSupplierCase({
        type: target.type,
        sellerId: target.fulfillment.sellerId,
        fulfillmentId: target.fulfillment.id,
        lineKey: target.line.lineKey,
        sku: target.line.sku ?? undefined,
        requestedQty: needsQuantity ? count : undefined,
        serialNumber: serialNumber.trim() || undefined,
        reasonFa: reasonFa.trim(),
      }));
    } catch (failure) {
      setError(supplyError(failure, 'ثبت درخواست ناموفق بود.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SupplyDialog title={CASE_TYPE[target.type]} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <p className="rounded-xl bg-slate-50 p-3 text-sm">{target.line.titleFa} · {target.fulfillment.shopNameFa}</p>
        {needsQuantity ? (
          <label className="block space-y-1 text-xs font-bold">مقدار درخواستی (حداکثر {formatNumberFa(target.line.qty)})
            <input required value={qty} onChange={(event) => setQty(toLatinDigits(event.target.value).replace(/\D/g, ''))} inputMode="numeric" dir="ltr" className={supplyField} />
          </label>
        ) : (
          <label className="block space-y-1 text-xs font-bold">شماره سریال در صورت دسترسی
            <input value={serialNumber} maxLength={160} onChange={(event) => setSerialNumber(event.target.value)} dir="ltr" className={supplyField} />
          </label>
        )}
        <label className="block space-y-1 text-xs font-bold">شرح درخواست
          <textarea required maxLength={2000} value={reasonFa} onChange={(event) => setReasonFa(event.target.value)} rows={3} className={supplyField} />
        </label>
        <button type="submit" disabled={!ready || busy} className="btn-primary w-full">ثبت درخواست</button>
        {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
      </form>
    </SupplyDialog>
  );
}

function GuidanceForm({ catalog, onCreated }: { catalog: SupplyCatalog | null; onCreated: (ticket: SupplierCase) => void }) {
  const [sellerId, setSellerId] = useState('');
  const [sku, setSku] = useState('');
  const [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const offers = catalog?.items ?? [];
  const shops = Array.from(new Map(offers.map((offer) => [offer.sellerId, offer.seller.shopNameFa])));
  const products = Array.from(new Map(offers.filter((offer) => offer.sellerId === sellerId).map(({ product }) => [product.sku, product.titleFa])));

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !sellerId || !question.trim()) return;
    setBusy(true);
    setError('');
    try {
      onCreated(await api.createSupplierCase({
        type: 'TECH_GUIDANCE', sellerId, sku: sku || undefined, reasonFa: question.trim(),
      }));
      setQuestion('');
    } catch (failure) {
      setError(supplyError(failure, 'ثبت سؤال ناموفق بود.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-3">
      <h2 className="font-extrabold text-primary-950">سؤال از فروشنده</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-bold">فروشنده
          <select required value={sellerId} onChange={(event) => { setSellerId(event.target.value); setSku(''); }} className={supplyField}>
            <option value="">انتخاب فروشگاه</option>
            {shops.map(([id, shopName]) => <option key={id} value={id}>{shopName}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-bold">کالا (اختیاری)
          <select value={sku} onChange={(event) => setSku(event.target.value)} className={supplyField} disabled={!sellerId}>
            <option value="">سؤال عمومی</option>
            {products.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-xs font-bold">سؤال فنی
        <textarea required maxLength={2000} value={question} onChange={(event) => setQuestion(event.target.value)} className={supplyField} rows={3} />
      </label>
      <button type="submit" disabled={busy || !sellerId || !question.trim()} className="btn-primary">ثبت سؤال</button>
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
    </form>
  );
}

function TechnicianSupplyPortal() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('shop');
  const [orders, setOrders] = useState<B2BSupplyOrder[]>([]);
  const [catalog, setCatalog] = useState<SupplyCatalog | null>(null);
  const [wallet, setWallet] = useState<WalletMe | null>(null);
  const [cases, setCases] = useState<SupplierCase[]>([]);
  const [caseLine, setCaseLine] = useState<CaseLine | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useRef(0);

  const reload = useCallback(async () => {
    const sequence = ++refresh.current;
    setLoading(true);
    setError('');
    const result = await Promise.allSettled([api.supplyCatalog(), api.supplyOrders(), api.walletMe(), api.supplierCases()]);
    if (sequence !== refresh.current) return;
    if (result[0].status === 'fulfilled') setCatalog(result[0].value);
    if (result[1].status === 'fulfilled') setOrders(result[1].value);
    if (result[2].status === 'fulfilled') setWallet(result[2].value);
    if (result[3].status === 'fulfilled') setCases(result[3].value);
    const failure = result.find((entry) => entry.status === 'rejected');
    if (failure?.status === 'rejected') setError(supplyError(failure.reason, 'بارگیری اطلاعات تأمین ناموفق بود.'));
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    return () => { refresh.current += 1; };
  }, [reload]);

  const updateCase = (ticket: SupplierCase) => {
    setCases((current) => current.some(({ id }) => id === ticket.id)
      ? current.map((entry) => entry.id === ticket.id ? ticket : entry) : [ticket, ...current]);
  };

  const runOrderAction = async (action: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await reload();
      setNotice(success);
    } catch (failure) {
      setError(supplyError(failure, 'به‌روزرسانی سفارش ناموفق بود.'));
    } finally {
      setBusy(false);
    }
  };

  const relevantCases = cases.filter(({ type }) => tab === 'guidance' ? type === 'TECH_GUIDANCE' : type !== 'TECH_GUIDANCE');

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 pb-16 pt-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold text-primary-950">تأمین کالا و خدمات همکار</h1>
        <button type="button" className="btn-ghost" onClick={() => void reload()} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> به‌روزرسانی
        </button>
      </header>
      <PortalTabs items={TABS} current={tab} onChange={(next) => { setTab(next); setNotice(''); }} />
      {error ? <p role="alert" className="card text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</p> : null}
      {loading && !catalog ? <Loader2 size={20} className="animate-spin text-slate-500" aria-label="در حال بارگیری" /> : null}
      {catalog ? (
        <div hidden={tab !== 'shop'}>
          <SupplyShop catalog={catalog} wallet={wallet} onRefresh={reload} onOrdered={(order) => {
            setOrders((current) => [order, ...current.filter(({ id }) => id !== order.id)]);
            setTab('orders');
            setNotice('وجه سفارش در امانت قرار گرفت.');
            void reload();
          }} />
        </div>
      ) : null}
      {tab === 'orders' ? (
        <section className="space-y-3">
          {orders.map((order) => (
            <article key={order.id} className="card space-y-4">
              <header className="flex flex-wrap justify-between gap-2">
                <div>
                  <h2 className="font-extrabold">سفارش تأمین <bdi dir="ltr" className="font-mono">{order.orderNumber}</bdi></h2>
                  <p className="mt-1 text-xs text-slate-500">{order.deliveryAddressFa}</p>
                </div>
                <div className="text-left">
                  <p className="font-extrabold text-primary-900">{formatToman(order.grandTotal, 'full')}</p>
                  <p className="text-xs text-slate-600">{ORDER_STATUS[order.status]}</p>
                </div>
              </header>
              {order.fulfillments.map((shipment) => (
                <section key={shipment.id} className="space-y-3 rounded-xl border border-slate-200 p-3">
                  <header className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-bold">{shipment.shopNameFa}<DeliveryBadge mode={shipment.deliveryMode} /></div>
                    <p className="text-xs text-slate-600">{FULFILLMENT_STATUS[shipment.status]} · {formatToman(shipment.freightCost, 'full')}</p>
                  </header>
                  <ul className="space-y-2">
                    {shipment.lines.map((line) => (
                      <li key={line.lineKey} className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
                        <div className="flex flex-wrap justify-between gap-2">
                          <span>{line.titleFa} · <LineQuantity line={line} /></span>
                          <strong>{formatToman(line.lineTotal, 'full')}</strong>
                        </div>
                        {shipment.status === 'DELIVERED' ? (
                          <div className="flex flex-wrap gap-2">
                            {CASE_CHOICES.map((type) => (
                              <button key={type} type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setCaseLine({ type, fulfillment: shipment, line })}>
                                {CASE_TYPE[type]}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {shipment.status === 'DISPATCHED' ? (
                    <button type="button" disabled={busy} onClick={() => void runOrderAction(() => api.confirmSupplyDelivery(shipment.id), 'تحویل ثبت شد.')} className="btn-primary text-sm">تأیید تحویل</button>
                  ) : null}
                </section>
              ))}
              {order.status === 'FUNDED_RESERVED' && order.fulfillments.every(({ status }) => status === 'RESERVED') ? (
                <button type="button" disabled={busy} onClick={() => void runOrderAction(() => api.cancelSupplyOrder(order.id), 'سفارش لغو و مبلغ به کیف پول بازگردانده شد.')} className="btn-ghost !text-red-700">لغو و بازگشت وجه</button>
              ) : null}
            </article>
          ))}
          {!loading && orders.length === 0 ? <p className="card text-sm text-slate-500">سفارش تأمینی ثبت نشده است.</p> : null}
        </section>
      ) : null}
      {tab === 'guidance' ? <GuidanceForm catalog={catalog} onCreated={updateCase} /> : null}
      {tab !== 'shop' && relevantCases.length > 0 ? (
        <section className="space-y-3" aria-label="درخواست‌های من">
          <h2 className="font-extrabold text-primary-950">{tab === 'guidance' ? 'گفتگوهای فنی' : 'درخواست‌های خدمات پس از فروش'}</h2>
          {relevantCases.map((ticket) => <SupplierCaseThread key={ticket.id} ticket={ticket} role="TECHNICIAN" onUpdated={updateCase} />)}
        </section>
      ) : null}
      {caseLine ? <LineCaseForm target={caseLine} onClose={() => setCaseLine(null)} onCreated={(ticket) => {
        updateCase(ticket);
        setCaseLine(null);
        setNotice('درخواست برای فروشنده ارسال شد.');
      }} /> : null}
    </main>
  );
}

export default function TechnicianSupplyPage() {
  return <SupplyPortalAccess role="TECHNICIAN"><TechnicianSupplyPortal /></SupplyPortalAccess>;
}
