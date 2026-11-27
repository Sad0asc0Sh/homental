'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@homental/api-client';
import { formatNumberFa, formatToman, toLatinDigits } from '@homental/shared';
import type { SellerOfferView, SupplyProduct } from '@homental/shared';
import { SupplyDialog, supplyError, supplyField } from './portal-ui';

function integerText(value: string): string {
  return toLatinDigits(value).replace(/\D/g, '');
}

function readOfferValues(price: string, stock: string, reserved: number) {
  if (!/^\d{1,19}$/.test(price) || !/^\d+$/.test(stock)) return null;
  const partnerPrice = BigInt(price);
  const onHandQty = Number(stock);
  if (partnerPrice > BigInt('9223372036854775807') || !Number.isInteger(onHandQty) || onHandQty > 2_147_483_647 || onHandQty < reserved) return null;
  return { partnerPrice: partnerPrice.toString(), onHandQty };
}

function OfferPriceAndStock({ price, stock, setPrice, setStock, busy }: {
  price: string;
  stock: string;
  setPrice: (value: string) => void;
  setStock: (value: string) => void;
  busy: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="space-y-1 text-xs font-bold">قیمت همکار در هر واحد (تومان)
        <input required inputMode="numeric" dir="ltr" disabled={busy} value={price} maxLength={19}
          onChange={(event) => setPrice(integerText(event.target.value))} className={supplyField} />
      </label>
      <label className="space-y-1 text-xs font-bold">موجودی کل
        <input required inputMode="numeric" dir="ltr" disabled={busy} value={stock} maxLength={10}
          onChange={(event) => setStock(integerText(event.target.value))} className={supplyField} />
      </label>
    </div>
  );
}

function EditOffer({ offer, onSaved }: { offer: SellerOfferView; onSaved: (offer: SellerOfferView) => void }) {
  const [price, setPrice] = useState(offer.partnerPrice);
  const [stock, setStock] = useState(String(offer.onHandQty));
  const [active, setActive] = useState(offer.isActive);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const payload = readOfferValues(price, stock, offer.reservedQty);
  const changed = payload && (payload.partnerPrice !== offer.partnerPrice || payload.onHandQty !== offer.onHandQty || active !== offer.isActive);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!payload || !changed || busy) return;
    setBusy(true);
    setError('');
    try {
      onSaved(await api.updateSellerOffer(offer.id, { version: offer.version, ...payload, isActive: active }));
    } catch (failure) {
      setError(supplyError(failure, 'ذخیره پیشنهاد ناموفق بود.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="card space-y-3">
      <header className="flex flex-wrap justify-between gap-2">
        <div>
          <h3 className="text-sm font-extrabold text-primary-950">{offer.product.titleFa}</h3>
          <p className="mt-1 text-xs text-slate-500"><bdi dir="ltr" className="font-mono">{offer.sellerSku}</bdi> · {offer.product.unit === 'METER' ? 'متر' : 'عدد'}</p>
        </div>
        <p className="text-xs font-bold text-primary-800">{formatToman(offer.partnerPrice, 'full')}</p>
      </header>
      <OfferPriceAndStock price={price} stock={stock} setPrice={setPrice} setStock={setStock} busy={busy} />
      <p className="text-xs text-slate-500">قابل فروش {formatNumberFa(offer.availableQty)} · رزروشده {formatNumberFa(offer.reservedQty)}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs font-bold">
          <input type="checkbox" checked={active} disabled={busy} onChange={(event) => setActive(event.target.checked)} /> فعال در فروشگاه
        </label>
        <button type="submit" disabled={busy || !changed} className="btn-primary !py-2 text-xs">ذخیره</button>
      </div>
      {!payload && Number(stock) < offer.reservedQty ? <p className="text-xs text-amber-800">موجودی کل باید حداقل برابر مقدار رزروشده باشد.</p> : null}
      {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
    </form>
  );
}

function CreateOffer({ products, onClose, onSaved }: {
  products: SupplyProduct[];
  onClose: () => void;
  onSaved: (offer: SellerOfferView) => void;
}) {
  const [productId, setProductId] = useState('');
  const [sellerSku, setSellerSku] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const payload = readOfferValues(price, stock, 0);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!payload || !productId || !sellerSku.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      onSaved(await api.createSellerOffer({ productId, sellerSku: sellerSku.trim(), ...payload, isActive: active }));
    } catch (failure) {
      setError(supplyError(failure, 'افزودن پیشنهاد ناموفق بود.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SupplyDialog title="افزودن پیشنهاد فروش" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <label className="block space-y-1 text-xs font-bold">کالای کاتالوگ
          <select required value={productId} className={supplyField} disabled={busy}
            onChange={(event) => { const id = event.target.value; setProductId(id); setSellerSku(products.find((product) => product.id === id)?.sku ?? ''); }}>
            <option value="">انتخاب کالا</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.titleFa} · {product.sku}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-xs font-bold">شناسه کالا در فروشگاه
          <input required dir="ltr" value={sellerSku} maxLength={100} disabled={busy}
            onChange={(event) => setSellerSku(event.target.value)} className={supplyField} />
        </label>
        <OfferPriceAndStock price={price} stock={stock} setPrice={setPrice} setStock={setStock} busy={busy} />
        <label className="flex items-center gap-2 text-xs font-bold">
          <input type="checkbox" checked={active} disabled={busy} onChange={(event) => setActive(event.target.checked)} /> فعال در فروشگاه
        </label>
        <button type="submit" className="btn-primary w-full" disabled={busy || !payload || !productId || !sellerSku.trim()}>افزودن</button>
        {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
      </form>
    </SupplyDialog>
  );
}

export function SellerOfferForms({ offers, products, onSaved }: {
  offers: SellerOfferView[];
  products: SupplyProduct[];
  onSaved: (offer: SellerOfferView) => void;
}) {
  const [create, setCreate] = useState(false);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-extrabold text-primary-950">کالاها و قیمت همکار</h2>
        <button type="button" className="btn-primary text-sm" disabled={!products.length} onClick={() => setCreate(true)}><Plus size={16} /> افزودن پیشنهاد</button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {offers.map((offer) => <EditOffer key={offer.id + ':' + offer.version} offer={offer} onSaved={onSaved} />)}
      </div>
      {!offers.length ? <p className="card text-sm text-slate-500">برای فروشگاه شما پیشنهادی ثبت نشده است.</p> : null}
      {create ? <CreateOffer products={products} onClose={() => setCreate(false)} onSaved={(offer) => { setCreate(false); onSaved(offer); }} /> : null}
    </section>
  );
}
