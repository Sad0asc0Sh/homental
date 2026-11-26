'use client';

import { useRef, useState } from 'react';
import { LocateFixed, Minus, Plus, ShoppingCart } from 'lucide-react';
import { api, type WalletMe } from '@/lib/api';
import { formatNumberFa, formatToman, generateUuid, toLatinDigits } from '@/lib/format';
import type { B2BSupplyOrder, DeliveryMode, SupplyCatalog } from '@/lib/partner-supply.types';
import { DeliveryBadge, supplyError, supplyField } from './portal-ui';

interface CartShipment {
  shopNameFa: string;
  weight: bigint;
  volume: bigint;
  bulky: boolean;
  goods: bigint;
}

function coordinates(value: string, bound: number): number | undefined {
  const normalized = toLatinDigits(value).trim().replace('٫', '.').replace('−', '-');
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return undefined;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && Math.abs(numeric) <= bound ? numeric : undefined;
}

export function SupplyShop({ catalog, wallet, onOrdered, onRefresh }: {
  catalog: SupplyCatalog;
  wallet: WalletMe | null;
  onOrdered: (order: B2BSupplyOrder) => void;
  onRefresh: () => Promise<void>;
}) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const topupAttempt = useRef<{ amount: string; key: string } | null>(null);

  const entries = Object.entries(cart).filter(([, qty]) => qty > 0);
  const byId = new Map(catalog.items.map((offer) => [offer.id, offer]));
  const validCart = entries.every(([id, qty]) => qty <= (byId.get(id)?.availableQty ?? 0));
  const selected = entries.flatMap(([id, qty]) => {
    const offer = byId.get(id);
    return offer ? [{ offer, qty }] : [];
  });
  const shipments = new Map<string, CartShipment>();
  for (const { offer, qty } of selected) {
    const shipment = shipments.get(offer.sellerId) ?? {
      shopNameFa: offer.seller.shopNameFa, weight: BigInt(0), volume: BigInt(0), bulky: false, goods: BigInt(0),
    };
    const quantity = BigInt(qty);
    shipment.weight += BigInt(offer.product.weightGrams) * quantity;
    shipment.volume += BigInt(offer.product.volumeCm3) * quantity;
    shipment.bulky ||= offer.product.handlingClass !== 'STANDARD';
    shipment.goods += BigInt(offer.partnerPrice) * quantity;
    shipments.set(offer.sellerId, shipment);
  }
  const { deliveryPolicy } = catalog;
  const estimates = Array.from(shipments, ([sellerId, shipment]) => {
    const bike = !shipment.bulky && shipment.weight <= BigInt(deliveryPolicy.bikeMaxGrams) && shipment.volume <= BigInt(deliveryPolicy.bikeMaxCm3);
    const mode: DeliveryMode = bike ? 'BIKE' : 'CAR';
    return { sellerId, shipment, mode, freight: BigInt(bike ? deliveryPolicy.bikeToman : deliveryPolicy.carToman) };
  });
  const goods = estimates.reduce((sum, line) => sum + line.shipment.goods, BigInt(0));
  const freight = estimates.reduce((sum, line) => sum + line.freight, BigInt(0));
  const total = goods + freight;
  const balance = wallet ? BigInt(wallet.wallet.balance) : null;
  const shortfall = balance !== null && balance < total ? total - balance : BigInt(0);
  const latitude = coordinates(lat, 90);
  const longitude = coordinates(lng, 180);

  const search = query.trim().toLocaleLowerCase('fa');
  const offers = catalog.items.filter((offer) =>
    [offer.product.titleFa, offer.product.sku, offer.seller.shopNameFa].some((value) => value.toLocaleLowerCase('fa').includes(search)),
  );

  const updateQuantity = (id: string, qty: number) => {
    setCart((old) => ({ ...old, [id]: Math.max(0, Math.min(qty, byId.get(id)?.availableQty ?? 0)) }));
    setError('');
    setNotice('');
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setError('موقعیت‌یابی دردسترس نیست. مختصات نشانی را وارد کنید.');
      return;
    }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setLat(coords.latitude.toFixed(6));
      setLng(coords.longitude.toFixed(6));
      setLocating(false);
    }, () => {
      setError('دریافت موقعیت ناموفق بود. مختصات نشانی را وارد کنید.');
      setLocating(false);
    }, { timeout: 8000 });
  };

  const charge = async () => {
    if (pending.current || shortfall <= BigInt(0)) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const amount = shortfall.toString();
    const attempt = topupAttempt.current?.amount === amount ? topupAttempt.current : { amount, key: generateUuid() };
    topupAttempt.current = attempt;
    try {
      await api.walletTopup(attempt.amount, attempt.key);
      await onRefresh();
      topupAttempt.current = null;
      setNotice('کیف پول شارژ شد.');
    } catch (failure) {
      setError(supplyError(failure, 'شارژ کیف پول ناموفق بود.'));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const order = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current || !validCart || !entries.length || entries.length > 100 || address.trim().length < 5 ||
        latitude === undefined || longitude === undefined || shortfall > BigInt(0)) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const placed = await api.createSupplyOrder({
        deliveryAddressFa: address.trim(), lat: latitude, lng: longitude,
        items: entries.map(([sellerOfferId, qty]) => ({ sellerOfferId, qty })),
      });
      setCart({});
      onOrdered(placed);
    } catch (failure) {
      setError(supplyError(failure, 'ثبت سفارش تأمین ناموفق بود.'));
      await onRefresh();
    } finally {
      setBusy(false);
      pending.current = false;
    }
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <section className="space-y-3">
        <div className="card space-y-2">
          <h2 className="font-extrabold text-primary-950">فروشگاه همکار</h2>
          <label className="block space-y-1 text-xs font-bold">جستجوی کالا یا فروشگاه
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} className={supplyField} />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {offers.map((offer) => {
            const { product } = offer;
            const qty = cart[offer.id] ?? 0;
            const specs = product.specs && typeof product.specs === 'object' && !Array.isArray(product.specs)
              ? Object.entries(product.specs).filter(([, value]) => typeof value === 'string' || typeof value === 'number')
              : [];
            return (
              <article key={offer.id} className="card flex flex-col justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-500">{offer.seller.shopNameFa}</p>
                  <h3 className="mt-1 text-sm font-extrabold text-primary-950">{product.titleFa}</h3>
                  <p className="mt-1 font-mono text-[11px] text-slate-500"><bdi dir="ltr">{product.sku}</bdi></p>
                  <p className="mt-2 text-xs text-slate-600">{formatNumberFa(product.weightGrams)} گرم · {formatNumberFa(product.volumeCm3)} سانتی‌متر مکعب</p>
                  {specs.length > 0 ? (
                    <details className="mt-2 text-xs text-slate-600">
                      <summary className="cursor-pointer font-bold">مشخصات کالا</summary>
                      <dl className="mt-1 space-y-1">
                        {specs.map(([key, value]) => (
                          <div key={key} className="flex justify-between gap-2"><dt>{key}</dt><dd>{String(value)}</dd></div>
                        ))}
                      </dl>
                    </details>
                  ) : null}
                </div>
                <div>
                  <p className="tabular-fa text-sm font-extrabold text-primary-900">
                    {formatToman(offer.partnerPrice, 'full')} / {product.unit === 'METER' ? 'متر' : 'عدد'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-600">موجودی {formatNumberFa(offer.availableQty)}</p>
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={!qty || busy} onClick={() => updateQuantity(offer.id, qty - 1)}
                        className="rounded-lg border border-slate-200 p-2 disabled:opacity-40" aria-label={'کم کردن ' + product.titleFa}><Minus size={15} /></button>
                      <input type="text" inputMode="numeric" disabled={busy || !offer.availableQty} maxLength={10}
                        value={qty ? formatNumberFa(qty).replace(/,/g, '') : ''} placeholder="۰"
                        onChange={(event) => updateQuantity(offer.id, Number(toLatinDigits(event.target.value).replace(/\D/g, '')))}
                        aria-label={'مقدار ' + product.titleFa} className="w-12 rounded-lg border border-slate-200 py-1.5 text-center text-xs font-bold" />
                      <button type="button" disabled={qty >= offer.availableQty || busy} onClick={() => updateQuantity(offer.id, qty + 1)}
                        className="rounded-lg bg-primary-50 p-2 text-primary-900 disabled:opacity-40" aria-label={'افزودن ' + product.titleFa}><Plus size={15} /></button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {offers.length === 0 ? <p className="card text-sm text-slate-500">کالایی برای نمایش یافت نشد.</p> : null}
      </section>

      <form onSubmit={order} className="card space-y-4 lg:sticky lg:top-24">
        <h2 className="flex items-center gap-2 font-extrabold text-primary-950"><ShoppingCart size={18} /> سبد تأمین</h2>
        {entries.length === 0 ? <p className="text-sm text-slate-500">کالاهای موردنیاز را به سبد اضافه کنید.</p> : null}
        {selected.map(({ offer, qty }) => (
          <div key={offer.id} className="flex justify-between gap-2 border-b border-slate-100 pb-2 text-xs">
            <p>{offer.product.titleFa} × {formatNumberFa(qty)}</p>
            <button type="button" disabled={busy} onClick={() => updateQuantity(offer.id, 0)} className="font-bold text-red-700">حذف</button>
          </div>
        ))}
        {entries.filter(([id]) => !byId.has(id)).map(([id]) => (
          <div key={id} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 text-xs text-amber-800">
            <p>این کالا دیگر در فروشگاه فعال نیست.</p>
            <button type="button" onClick={() => updateQuantity(id, 0)} className="font-bold text-red-700">حذف</button>
          </div>
        ))}
        {estimates.map(({ sellerId, shipment, mode, freight: cost }) => (
          <div key={sellerId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
            <div className="space-y-1"><p className="font-bold">{shipment.shopNameFa}</p><DeliveryBadge mode={mode} /></div>
            <p>{formatToman(cost.toString(), 'full')}</p>
          </div>
        ))}
        {entries.length > 0 ? (
          <>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-2"><dt>قیمت همکار کالاها</dt><dd>{formatToman(goods.toString(), 'full')}</dd></div>
              <div className="flex justify-between gap-2"><dt>برآورد ارسال</dt><dd>{formatToman(freight.toString(), 'full')}</dd></div>
              <div className="flex justify-between gap-2 border-t border-slate-200 pt-2 text-sm font-extrabold">
                <dt>جمع سفارش</dt><dd>{formatToman(total.toString(), 'full')}</dd>
              </div>
              {wallet ? <div className="flex justify-between gap-2"><dt>موجودی کیف پول</dt><dd>{formatToman(wallet.wallet.balance, 'full')}</dd></div> : null}
            </dl>
            <label className="block space-y-1 text-xs font-bold">نشانی تحویل
              <textarea required minLength={5} maxLength={500} value={address} onChange={(event) => setAddress(event.target.value)} className={supplyField} rows={2} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs font-bold">عرض جغرافیایی
                <input required value={lat} onChange={(event) => setLat(event.target.value)} dir="ltr" inputMode="decimal" className={supplyField} />
              </label>
              <label className="space-y-1 text-xs font-bold">طول جغرافیایی
                <input required value={lng} onChange={(event) => setLng(event.target.value)} dir="ltr" inputMode="decimal" className={supplyField} />
              </label>
            </div>
            <button type="button" disabled={locating || busy} onClick={locate} className="btn-ghost w-full"><LocateFixed size={16} /> {locating ? 'در حال دریافت…' : 'موقعیت فعلی'}</button>
            {!validCart ? <p role="alert" className="text-xs text-amber-800">موجودی برخی کالاها تغییر کرده است. سبد را بازبینی کنید.</p> : null}
            {entries.length > 100 ? <p role="alert" className="text-xs text-amber-800">هر سفارش حداکثر ۱۰۰ قلم کالا دارد.</p> : null}
            {shortfall > BigInt(0) && validCart && entries.length <= 100 ? (
              <button type="button" className="btn-primary w-full text-sm" disabled={busy} onClick={charge}>شارژ کسری · {formatToman(shortfall.toString(), 'full')}</button>
            ) : null}
            <button type="submit" className="btn-primary w-full text-sm" disabled={
              busy || address.trim().length < 5 || !validCart || entries.length > 100 || !wallet ||
              shortfall > BigInt(0) || latitude === undefined || longitude === undefined
            }>ثبت سفارش و پرداخت از کیف پول</button>
          </>
        ) : null}
        {notice ? <p role="status" className="text-xs text-emerald-700">{notice}</p> : null}
        {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{error}</p> : null}
      </form>
    </div>
  );
}
