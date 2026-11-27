'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { api, type WalletMe } from '@homental/api-client';
import { formatNumberFa, formatToman, toLatinDigits } from '@homental/shared';
import type {
  ResolveSupplierCaseInput, SellerOfferView, SellerProfileView, SellerShipmentView, SupplierCase, SupplyProduct,
} from '@homental/shared';
import { WalletBalance, WalletLedger } from '@/components/wallet/WalletLedger';
import { SellerOfferForms } from '@/components/partner-supply/SellerOfferForms';
import {
  DeliveryBadge, FULFILLMENT_STATUS, LineQuantity, PortalTabs, SupplierCaseThread, SupplyPortalAccess, supplyError, supplyField,
} from '@/components/partner-supply/portal-ui';

const TABS = [
  { id: 'offers', label: 'کالاها و قیمت همکار' },
  { id: 'shipments', label: 'سفارش‌های ارسالی' },
  { id: 'cases', label: 'مرجوعی، تعویض، تعمیرات و راهنمایی فنی' },
  { id: 'wallet', label: 'کیف پول و تسویه' },
] as const;

const SHOP_STATUS: Record<SellerProfileView['status'], string> = {
  APPROVED: 'فعال',
  SUSPENDED: 'تعلیق‌شده',
  PENDING_APPROVAL: 'در انتظار تأیید',
};

function CaseResolution({ ticket, offers, onUpdated }: {
  ticket: SupplierCase;
  offers: SellerOfferView[];
  onUpdated: (ticket: SupplierCase) => void;
}) {
  const [note, setNote] = useState('');
  const [approvedQty, setApprovedQty] = useState(String(ticket.requestedQty ?? 1));
  const [sealed, setSealed] = useState(false);
  const [cut, setCut] = useState(false);
  const [replacementOfferId, setReplacementOfferId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (['INSPECTED_ACCEPTED', 'RESOLVED', 'REJECTED', 'CANCELLED'].includes(ticket.status)) return null;

  const qty = Number(approvedQty);
  const quantityValid = Number.isInteger(qty) && qty > 0 && qty <= (ticket.requestedQty ?? 0);
  const replacementOffers = offers.filter((offer) => offer.isActive && offer.availableQty >= qty);
  const validReplacement = replacementOffers.some(({ id }) => id === replacementOfferId);
  const isExchange = ticket.type === 'EXCHANGE';
  const isUnusedReturn = ticket.type === 'UNUSED_RETURN';

  const resolve = async (input: ResolveSupplierCaseInput) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.resolveSupplierCase(ticket.id, { inspectionNoteFa: note.trim() || undefined, ...input });
      onUpdated(result);
      setNote('');
    } catch (failure) {
      setError(supplyError(failure, 'ثبت نتیجه بررسی ناموفق بود.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="نتیجه بررسی فروشنده" className="space-y-3 rounded-xl border border-slate-200 p-3">
      {isExchange || isUnusedReturn ? (
        <>
          <label className="block space-y-1 text-xs font-bold">مقدار پذیرفته‌شده
            <input inputMode="numeric" dir="ltr" value={approvedQty} className={supplyField}
              onChange={(event) => setApprovedQty(toLatinDigits(event.target.value).replace(/\D/g, ''))} />
          </label>
          {isUnusedReturn ? (
            <div className="flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-xs font-bold">
                <input type="checkbox" checked={sealed} onChange={(event) => setSealed(event.target.checked)} /> پلمب سالم است
              </label>
              <label className="flex items-center gap-2 text-xs font-bold">
                <input type="checkbox" checked={cut} onChange={(event) => setCut(event.target.checked)} /> کابل یا داکت بریده شده است
              </label>
            </div>
          ) : (
            <label className="block space-y-1 text-xs font-bold">کالای جایگزین از موجودی فروشگاه
              <select value={replacementOfferId} className={supplyField} onChange={(event) => setReplacementOfferId(event.target.value)}>
                <option value="">انتخاب کالا</option>
                {replacementOffers.map((offer) => <option key={offer.id} value={offer.id}>
                  {offer.product.titleFa} · {formatToman(offer.partnerPrice, 'full')}
                </option>)}
              </select>
            </label>
          )}
        </>
      ) : null}
      {ticket.type !== 'TECH_GUIDANCE' ? (
        <label className="block space-y-1 text-xs font-bold">نتیجه یا یادداشت بررسی
          <textarea rows={2} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} className={supplyField} />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {isUnusedReturn ? (
          <button type="button" disabled={busy || !quantityValid || !sealed || cut} className="btn-primary !py-2 text-xs"
            onClick={() => void resolve({
              status: 'INSPECTED_ACCEPTED', approvedQty: qty, sealIntact: sealed, cutCable: cut, idempotencyKey: 'seller-case:' + ticket.id,
            })}>پذیرش و بازگشت وجه</button>
        ) : null}
        {isExchange ? (
          <button type="button" disabled={busy || !quantityValid || !validReplacement} className="btn-primary !py-2 text-xs"
            onClick={() => void resolve({
              status: 'INSPECTED_ACCEPTED', approvedQty: qty, replacementOfferId, idempotencyKey: 'seller-case:' + ticket.id,
            })}>تأیید تعویض و تسویه تفاوت</button>
        ) : null}
        {ticket.type === 'REPAIR' && (ticket.status === 'OPEN' || ticket.status === 'APPROVED') ? (
          <button type="button" disabled={busy} className="btn-primary !py-2 text-xs"
            onClick={() => void resolve({ status: 'IN_REVIEW' })}>پذیرش برای بررسی و تعمیر</button>
        ) : null}
        {ticket.type === 'REPAIR' && ticket.status === 'IN_REVIEW' ? (
          <button type="button" disabled={busy || !note.trim()} className="btn-primary !py-2 text-xs"
            onClick={() => void resolve({ status: 'RESOLVED' })}>ثبت نتیجه تعمیر</button>
        ) : null}
        {ticket.type === 'TECH_GUIDANCE' ? (
          <button type="button" disabled={busy} className="btn-ghost !py-2 text-xs" onClick={() => void resolve({ status: 'RESOLVED' })}>بستن گفتگو</button>
        ) : (
          <button type="button" disabled={busy || !note.trim()} className="btn-ghost !py-2 text-xs !text-red-700 disabled:opacity-40"
            onClick={() => void resolve({ status: 'REJECTED', sealIntact: isUnusedReturn ? sealed : undefined, cutCable: isUnusedReturn ? cut : undefined })}>رد درخواست</button>
        )}
      </div>
      {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
    </section>
  );
}

function SellerPortal() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('offers');
  const [profile, setProfile] = useState<SellerProfileView | null>(null);
  const [products, setProducts] = useState<SupplyProduct[]>([]);
  const [offers, setOffers] = useState<SellerOfferView[]>([]);
  const [shipments, setShipments] = useState<SellerShipmentView[]>([]);
  const [cases, setCases] = useState<SupplierCase[]>([]);
  const [wallet, setWallet] = useState<WalletMe | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useRef(0);

  const reload = useCallback(async (walletPage = 1) => {
    const sequence = ++refresh.current;
    setLoading(true);
    setError('');
    const result = await Promise.allSettled([
      api.sellerProfile(), api.sellerProducts(), api.sellerOffers(), api.sellerFulfillments(), api.supplierCases(), api.walletMe(walletPage),
    ]);
    if (sequence !== refresh.current) return;
    if (result[0].status === 'fulfilled') setProfile(result[0].value);
    if (result[1].status === 'fulfilled') setProducts(result[1].value);
    if (result[2].status === 'fulfilled') setOffers(result[2].value);
    if (result[3].status === 'fulfilled') setShipments(result[3].value);
    if (result[4].status === 'fulfilled') setCases(result[4].value);
    if (result[5].status === 'fulfilled') setWallet(result[5].value);
    const failure = result.find((entry) => entry.status === 'rejected');
    if (failure?.status === 'rejected') setError(supplyError(failure.reason, 'بارگیری پنل فروشنده ناموفق بود.'));
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
    return () => { refresh.current += 1; };
  }, [reload]);

  const updateOffer = (offer: SellerOfferView) => {
    setOffers((current) => current.some(({ id }) => id === offer.id)
      ? current.map((entry) => entry.id === offer.id ? offer : entry) : [offer, ...current]);
    setNotice('پیشنهاد فروش ذخیره شد.');
  };

  const updateCase = (ticket: SupplierCase) => {
    setCases((current) => current.map((entry) => entry.id === ticket.id ? ticket : entry));
    if (ticket.status === 'INSPECTED_ACCEPTED' || ticket.status === 'RESOLVED' || ticket.status === 'REJECTED') void reload();
  };

  const moveShipment = async (shipment: SellerShipmentView) => {
    if (actionId) return;
    setActionId(shipment.fulfillmentId);
    setError('');
    setNotice('');
    try {
      if (shipment.status === 'RESERVED') {
        await api.dispatchSellerFulfillment(shipment.fulfillmentId);
        setNotice('ارسال ثبت شد.');
      } else {
        await api.confirmSupplyDelivery(shipment.fulfillmentId);
        setNotice('تحویل ثبت شد.');
      }
      await reload();
    } catch (failure) {
      setError(supplyError(failure, 'ثبت وضعیت ارسال ناموفق بود.'));
    } finally {
      setActionId(null);
    }
  };

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 pb-16 pt-6">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-primary-950">پنل فروشنده</h1>
          {profile ? <p className="mt-2 text-sm text-slate-600">{profile.shopNameFa} · {SHOP_STATUS[profile.status]}</p> : null}
        </div>
        <button type="button" onClick={() => void reload(wallet?.page)} disabled={loading} className="btn-ghost self-start">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> به‌روزرسانی
        </button>
      </header>
      <PortalTabs items={TABS} current={tab} onChange={(next) => { setTab(next); setNotice(''); }} />
      {error ? <p role="alert" className="card text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</p> : null}
      {loading && !profile ? <Loader2 size={21} className="animate-spin text-slate-500" aria-label="در حال بارگیری" /> : null}
      {tab === 'offers' && profile ? <SellerOfferForms offers={offers} products={products} onSaved={updateOffer} /> : null}

      {tab === 'shipments' ? (
        <section className="space-y-3">
          {shipments.map((shipment) => (
            <article key={shipment.fulfillmentId} className="card space-y-3">
              <header className="flex flex-wrap justify-between gap-3">
                <div>
                  <h2 className="text-sm font-extrabold text-primary-950">
                    {shipment.orderKind === 'B2B' ? 'تأمین نصاب' : 'سفارش نصب'} · <bdi dir="ltr" className="font-mono">{shipment.orderNumber}</bdi>
                  </h2>
                  {shipment.deliveryAddressFa ? <p className="mt-1 text-xs text-slate-500">{shipment.deliveryAddressFa}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-1"><DeliveryBadge mode={shipment.deliveryMode} /><span className="chip bg-slate-50 text-xs">{FULFILLMENT_STATUS[shipment.status]}</span></div>
              </header>
              <ul className="space-y-2">
                {shipment.lines.map((line) => (
                  <li key={line.lineKey} className="flex flex-wrap justify-between gap-2 rounded-xl bg-slate-50 p-3 text-xs">
                    <span>{line.titleFa} · <LineQuantity line={line} /></span>
                    <span className="font-bold">{formatToman(line.lineTotal, 'full')}</span>
                  </li>
                ))}
              </ul>
              <dl className="space-y-1 text-xs">
                {BigInt(shipment.ownAppFee) > BigInt(0) ? (
                  <div className="flex justify-between gap-2"><dt>هزینه خدمات حساب فروشنده</dt><dd>{formatToman(shipment.ownAppFee, 'full')}</dd></div>
                ) : null}
                <div className="flex justify-between gap-2 text-sm font-extrabold">
                  <dt>{shipment.settlementStatus === 'SETTLED' ? 'مبلغ تسویه‌شده' : shipment.settlementStatus === 'REFUNDED' ? 'مبلغ سفارش لغوشده' : 'خالص قابل دریافت'}</dt>
                  <dd>{formatToman(shipment.netReceivable, 'full')}</dd>
                </div>
              </dl>
              {shipment.status === 'DISPATCHED' || shipment.status === 'RESERVED' ? (
                <button type="button" onClick={() => void moveShipment(shipment)} disabled={actionId !== null} className="btn-primary !py-2 text-xs">
                  {shipment.status === 'RESERVED' ? 'ثبت ارسال' : 'تأیید تحویل'}
                </button>
              ) : null}
            </article>
          ))}
          {!loading && !shipments.length ? <p className="card text-sm text-slate-500">سفارشی برای فروشگاه ثبت نشده است.</p> : null}
        </section>
      ) : null}

      {tab === 'cases' ? (
        <section className="space-y-3">
          {cases.map((ticket) => (
            <SupplierCaseThread key={ticket.id} ticket={ticket} role="SELLER" onUpdated={updateCase}>
              <CaseResolution ticket={ticket} offers={offers} onUpdated={updateCase} />
            </SupplierCaseThread>
          ))}
          {!loading && !cases.length ? <p className="card text-sm text-slate-500">درخواستی از نصاب‌ها ثبت نشده است.</p> : null}
        </section>
      ) : null}

      {tab === 'wallet' && wallet ? (
        <div className="space-y-3">
          <WalletBalance data={wallet} />
          <WalletLedger data={wallet} loading={loading} onPage={(page) => void reload(page)} />
        </div>
      ) : null}
      {tab === 'wallet' && !wallet && loading ? <p className="card text-sm text-slate-500">در حال بارگیری گردش حساب…</p> : null}
    </main>
  );
}

export default function SellerPage() {
  return <SupplyPortalAccess role="SELLER"><SellerPortal /></SupplyPortalAccess>;
}
