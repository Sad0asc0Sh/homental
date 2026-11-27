'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  Box,
  Building2,
  Camera,
  Edit3,
  Loader2,
  LocateFixed,
  LogIn,
  MapPin,
  Plus,
  RefreshCw,
  Scan,
  Upload,
  X,
} from 'lucide-react';
import { api, ApiError } from '@homental/api-client';
import { deviceBridge } from '@homental/device-bridge';
import {
  formatNumberFa,
  PROPERTY_ASSET_KIND_LABELS_FA,
  PROPERTY_ASSET_STATUS_META,
  PROPERTY_TYPE_LABELS_FA,
  toLatinDigits,
  toPersianDigits,
  type CityDto,
  type CustomerPropertyView,
  type PropertyAssetKind,
  type PropertyType,
} from '@homental/shared';
import { AuthModal } from '@/components/brief/AuthModal';
import { useAuthStore } from '@/store/auth.store';

const MASHHAD_PRESETS = [
  { nameFa: 'وکیل‌آباد', lat: 36.3105, lng: 59.5663 },
  { nameFa: 'احمدآباد', lat: 36.2873, lng: 59.6123 },
  { nameFa: 'سجاد', lat: 36.3018, lng: 59.5838 },
];

const PROPERTY_TYPES = Object.keys(PROPERTY_TYPE_LABELS_FA) as PropertyType[];
const ASSET_KINDS = Object.keys(PROPERTY_ASSET_KIND_LABELS_FA) as PropertyAssetKind[];

interface PropertyFormState {
  id?: string;
  title: string;
  propertyType: PropertyType;
  cityId: string;
  address: string;
  lat: string;
  lng: string;
  areaM2: string;
  ceilingHeightCm: string;
  notes: string;
}

const EMPTY_FORM: PropertyFormState = {
  title: '',
  propertyType: 'RESIDENTIAL',
  cityId: '',
  address: '',
  lat: '36.3105',
  lng: '59.5663',
  areaM2: '',
  ceilingHeightCm: '',
  notes: '',
};

const FIELD_CLASS =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 focus:border-primary-400 focus:outline-none';

function formatBytesFa(raw: string): string {
  const bytes = Number(raw);
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1024 * 1024) {
    return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(1))} مگابایت`;
  }
  return `${formatNumberFa(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
}

function toNum(raw: string): number {
  return Number(toLatinDigits(raw).trim().replace('٫', '.'));
}

export default function PropertiesPage() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);

  const [authOpen, setAuthOpen] = useState(false);
  const [properties, setProperties] = useState<CustomerPropertyView[] | null>(null);
  const [cities, setCities] = useState<CityDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<PropertyFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [mediaTargetId, setMediaTargetId] = useState<string | null>(null);
  const [mediaKind, setMediaKind] = useState<PropertyAssetKind>('PHOTO');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaSuccess, setMediaSuccess] = useState<string | null>(null);

  const [scannerSupported, setScannerSupported] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);

  useEffect(() => {
    setScannerSupported(deviceBridge.spaceScanner.supported);
  }, []);

  const reload = useCallback(() => {
    if (!accessToken || user?.role !== 'CUSTOMER') return;
    setLoading(true);
    setError(null);
    Promise.all([api.properties(), api.cities()])
      .then(([propRows, cityRows]) => {
        setProperties(propRows);
        setCities(cityRows);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'خطا در دریافت املاک ذخیره‌شده.');
      })
      .finally(() => setLoading(false));
  }, [accessToken, user?.role]);

  useEffect(() => {
    if (!accessToken || user?.role !== 'CUSTOMER') {
      setProperties(null);
      return;
    }
    reload();
  }, [accessToken, user?.role, reload]);

  const openCreate = () => {
    const defaultCityId = cities.find((c) => c.slug === 'mashhad')?.id ?? cities[0]?.id ?? '';
    setForm({ ...EMPTY_FORM, cityId: defaultCityId });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (prop: CustomerPropertyView) => {
    setForm({
      id: prop.id,
      title: prop.title,
      propertyType: prop.propertyType,
      cityId: prop.cityId ?? '',
      address: prop.address,
      lat: String(prop.lat),
      lng: String(prop.lng),
      areaM2: prop.defaultDimensionsJson?.areaM2 ? String(prop.defaultDimensionsJson.areaM2) : '',
      ceilingHeightCm: prop.defaultDimensionsJson?.ceilingHeightCm
        ? String(prop.defaultDimensionsJson.ceilingHeightCm)
        : '',
      notes: prop.notes ?? '',
    });
    setFormError(null);
    setFormOpen(true);
  };

  const locateCurrent = () => {
    if (!deviceBridge.geolocation.supported) {
      setFormError('موقعیت‌یابی در مرورگر فعال نیست.');
      return;
    }
    void deviceBridge.geolocation
      .getCurrentPosition({ timeoutMs: 8000 })
      .then((pos) => {
        setForm((prev) => ({ ...prev, lat: pos.lat.toFixed(6), lng: pos.lng.toFixed(6) }));
      })
      .catch(() => setFormError('دریافت موقعیت مکانی ناموفق بود.'));
  };

  const saveForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const lat = toNum(form.lat);
    const lng = toNum(form.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setFormError('مختصات جغرافیایی معتبر وارد کنید.');
      return;
    }

    const areaVal = form.areaM2.trim() ? Number(toLatinDigits(form.areaM2)) : undefined;
    const ceilingVal = form.ceilingHeightCm.trim()
      ? Number(toLatinDigits(form.ceilingHeightCm))
      : undefined;

    const dimensions =
      areaVal || ceilingVal
        ? {
            ...(areaVal && Number.isFinite(areaVal) ? { areaM2: areaVal } : {}),
            ...(ceilingVal && Number.isFinite(ceilingVal) ? { ceilingHeightCm: ceilingVal } : {}),
          }
        : undefined;

    setSaving(true);
    setFormError(null);
    try {
      if (form.id) {
        await api.updateProperty(form.id, {
          cityId: form.cityId || null,
          title: form.title.trim(),
          propertyType: form.propertyType,
          address: form.address.trim(),
          lat,
          lng,
          notes: form.notes.trim() || null,
          defaultDimensionsJson: dimensions ?? null,
        });
      } else {
        await api.createProperty({
          ...(form.cityId ? { cityId: form.cityId } : {}),
          title: form.title.trim(),
          propertyType: form.propertyType,
          address: form.address.trim(),
          lat,
          lng,
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
          ...(dimensions ? { defaultDimensionsJson: dimensions } : {}),
        });
      }
      setFormOpen(false);
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'ذخیره اطلاعات ملک ناموفق بود.');
    } finally {
      setSaving(false);
    }
  };

  const archiveProperty = async (propertyId: string) => {
    setError(null);
    try {
      await api.archiveProperty(propertyId);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'بایگانی ملک ناموفق بود.');
    }
  };

  const attachMedia = async (propertyId: string) => {
    if (mediaBusy) return;
    setMediaBusy(true);
    setMediaError(null);
    setMediaSuccess(null);
    try {
      const defaultMimeByKind: Record<PropertyAssetKind, string> = {
        PHOTO: 'image/jpeg',
        SURVEY_VIDEO: 'video/mp4',
        MODEL_3D_GLB: 'model/gltf-binary',
        FLOORPLAN_JSON: 'application/json',
      };
      const defaultNameByKind: Record<PropertyAssetKind, string> = {
        PHOTO: 'site-photo.jpg',
        SURVEY_VIDEO: 'site-walkthrough.mp4',
        MODEL_3D_GLB: 'site-model.glb',
        FLOORPLAN_JSON: 'floorplan.json',
      };

      const mimeType = mediaFile?.type || defaultMimeByKind[mediaKind];
      const sizeBytes = mediaFile?.size && mediaFile.size > 0 ? mediaFile.size : 64_000;
      const fileName = mediaFile?.name || defaultNameByKind[mediaKind];

      const presigned = await api.presignPropertyMedia(propertyId, {
        kind: mediaKind,
        mimeType,
        sizeBytes,
        fileName,
      });

      await api.completePropertyMedia(propertyId, presigned.assetId, {
        spatialMetadataJson: {
          scannerSource: deviceBridge.getPlatform(),
          originalFileName: fileName,
        },
      });

      setMediaFile(null);
      setMediaSuccess('فایل رسانه با موفقیت در پرونده ملک ثبت شد.');
      reload();
    } catch (err) {
      setMediaError(err instanceof ApiError ? err.message : 'ثبت فایل رسانه ناموفق بود.');
    } finally {
      setMediaBusy(false);
    }
  };

  const triggerFutureSpaceScan = async () => {
    const result = await deviceBridge.spaceScanner.startScan();
    if (!result.supported) {
      setScanNotice(
        'اسکن سه‌بعدی فضا به‌زودی در نسخه بومی اندروید هومنتال فعال می‌شود. فعلاً می‌توانید تصویر یا ویدئوی بازدید محل را ثبت کنید.',
      );
      return;
    }
    setScanNotice('اسکن سه‌بعدی با موفقیت انجام شد.');
  };

  if (!hasHydrated) {
    return (
      <main className="mx-auto max-w-3xl px-4 pt-10">
        <div className="card flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="animate-spin" size={24} />
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-3xl px-4 pt-10 text-center">
        <section className="card space-y-3">
          <p className="text-sm text-slate-600">
            برای ذخیره و مدیریت املاک و مستندات محل، ابتدا وارد حساب خود شوید.
          </p>
          <button type="button" onClick={() => setAuthOpen(true)} className="btn-primary mx-auto">
            <LogIn size={16} />
            ورود با شماره موبایل
          </button>
        </section>
        {authOpen ? <AuthModal onDone={() => setAuthOpen(false)} /> : null}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 pb-16 pt-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-primary-950">املاک و مکان‌های من</h1>
          <p className="text-xs text-slate-500">
            ذخیره نشانی، ابعاد و مستندات محل برای ثبت سریع سفارش و اعزام دقیق‌تر کارشناس
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="btn-ghost !px-3 !py-2 text-xs"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            بروزرسانی
          </button>
          <button type="button" onClick={openCreate} className="btn-primary !px-4 !py-2 text-xs">
            <Plus size={15} />
            افزودن ملک جدید
          </button>
        </div>
      </header>

      {/* Future-ready 3D space scan hook wired to @homental/device-bridge */}
      <section className="card flex flex-wrap items-center justify-between gap-3 border border-primary-100 bg-primary-50/50">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-900 text-white">
            <Scan size={20} />
          </span>
          <div>
            <p className="flex flex-wrap items-center gap-2 text-sm font-extrabold text-primary-950">
              اسکن هوشمند سه‌بعدی فضا
              {!scannerSupported ? (
                <span className="chip bg-amber-100 !py-0.5 text-[11px] font-bold text-amber-800">
                  اسکن سه‌بعدی فضا (به‌زودی در اپ اندروید)
                </span>
              ) : null}
            </p>
            <p className="text-xs text-slate-600">
              مستندات تصویری و ابعاد ثبت‌شده، مستقیماً در اختیار کارشناس اعزامی قرار می‌گیرد.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void triggerFutureSpaceScan()}
          className="btn-ghost !px-3 !py-2 text-xs"
        >
          <Box size={14} />
          {scannerSupported ? 'شروع اسکن سه‌بعدی' : 'وضعیت اسکنر'}
        </button>
      </section>

      {scanNotice ? (
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
          {scanNotice}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="card text-sm font-bold text-red-600">
          {error}
        </p>
      ) : null}

      {formOpen ? (
        <form onSubmit={saveForm} className="card space-y-4 border-2 border-primary-200">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-primary-950">
              {form.id ? 'ویرایش مشخصات مکان' : 'ثبت مکان جدید'}
            </h2>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              aria-label="بستن فرم"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-bold">
              عنوان مکان (مثلاً: خانه وکیل‌آباد)
              <input
                required
                minLength={2}
                maxLength={120}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className={FIELD_CLASS}
              />
            </label>
            <label className="space-y-1 text-xs font-bold">
              کاربری مکان
              <select
                value={form.propertyType}
                onChange={(e) => setForm({ ...form, propertyType: e.target.value as PropertyType })}
                className={FIELD_CLASS}
              >
                {PROPERTY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {PROPERTY_TYPE_LABELS_FA[type]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs font-bold">
              شهر
              <select
                value={form.cityId}
                onChange={(e) => setForm({ ...form, cityId: e.target.value })}
                className={FIELD_CLASS}
              >
                <option value="">انتخاب شهر</option>
                {cities.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.nameFa}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-bold">
              مساحت تقریبی (مترمربع)
              <input
                dir="ltr"
                inputMode="numeric"
                value={form.areaM2}
                onChange={(e) => setForm({ ...form, areaM2: e.target.value })}
                placeholder="120"
                className={FIELD_CLASS}
              />
            </label>
            <label className="space-y-1 text-xs font-bold">
              ارتفاع سقف (سانتی‌متر)
              <input
                dir="ltr"
                inputMode="numeric"
                value={form.ceilingHeightCm}
                onChange={(e) => setForm({ ...form, ceilingHeightCm: e.target.value })}
                placeholder="290"
                className={FIELD_CLASS}
              />
            </label>
          </div>

          <label className="block space-y-1 text-xs font-bold">
            نشانی کامل
            <textarea
              required
              minLength={5}
              maxLength={500}
              rows={2}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className={FIELD_CLASS}
            />
          </label>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700">مختصات جغرافیایی:</span>
              <div className="flex flex-wrap gap-1.5">
                {MASHHAD_PRESETS.map((preset) => (
                  <button
                    key={preset.nameFa}
                    type="button"
                    onClick={() =>
                      setForm({ ...form, lat: String(preset.lat), lng: String(preset.lng) })
                    }
                    className="chip border border-slate-200 !py-1 text-[11px] font-bold text-slate-600 hover:border-primary-300"
                  >
                    {preset.nameFa}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={locateCurrent}
                  className="chip border border-primary-200 bg-primary-50 !py-1 text-[11px] font-bold text-primary-800"
                >
                  <LocateFixed size={12} />
                  موقعیت فعلی
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-xs font-bold">
                عرض جغرافیایی
                <input
                  required
                  dir="ltr"
                  inputMode="decimal"
                  value={form.lat}
                  onChange={(e) => setForm({ ...form, lat: e.target.value })}
                  className={FIELD_CLASS}
                />
              </label>
              <label className="space-y-1 text-xs font-bold">
                طول جغرافیایی
                <input
                  required
                  dir="ltr"
                  inputMode="decimal"
                  value={form.lng}
                  onChange={(e) => setForm({ ...form, lng: e.target.value })}
                  className={FIELD_CLASS}
                />
              </label>
            </div>
          </div>

          <label className="block space-y-1 text-xs font-bold">
            یادداشت فنی و نکات محل (اختیاری)
            <textarea
              rows={2}
              maxLength={1000}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="مثلاً: سقف کاذب، نیاز به نردبان بلند یا دسترسی از پارکینگ"
              className={FIELD_CLASS}
            />
          </label>

          {formError ? (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">
              {formError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className="btn-primary flex-1 text-sm">
              {saving ? <Loader2 size={16} className="animate-spin" /> : 'ذخیره اطلاعات مکان'}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="btn-ghost text-sm"
            >
              انصراف
            </button>
          </div>
        </form>
      ) : null}

      {!properties && loading ? (
        <div className="card flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="animate-spin" size={22} />
        </div>
      ) : null}

      {properties && properties.length === 0 && !formOpen ? (
        <section className="card space-y-3 text-center">
          <Building2 size={28} className="mx-auto text-slate-400" />
          <p className="text-sm font-bold text-slate-700">هنوز ملکی ذخیره نکرده‌اید.</p>
          <p className="text-xs text-slate-500">
            با ثبت مکان‌ها، هنگام سفارش جدید دیگر نیازی به وارد کردن مجدد نشانی نخواهید داشت.
          </p>
          <button type="button" onClick={openCreate} className="btn-primary mx-auto text-sm">
            <Plus size={15} />
            ثبت اولین مکان
          </button>
        </section>
      ) : null}

      <div className="space-y-4">
        {(properties ?? []).map((prop) => {
          const isAttaching = mediaTargetId === prop.id;
          const assets = prop.mediaAssets ?? [];
          return (
            <section key={prop.id} className="card space-y-3">
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-extrabold text-primary-950">{prop.title}</h2>
                    <span className="chip bg-primary-50 !py-0.5 text-xs font-bold text-primary-800">
                      {PROPERTY_TYPE_LABELS_FA[prop.propertyType]}
                    </span>
                    {prop.city ? (
                      <span className="chip bg-slate-100 !py-0.5 text-[11px] font-bold text-slate-600">
                        {prop.city.nameFa}
                      </span>
                    ) : null}
                  </div>
                  <p className="flex items-start gap-1.5 text-xs text-slate-600">
                    <MapPin size={14} className="mt-0.5 shrink-0 text-primary-700" />
                    {prop.address}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openEdit(prop)}
                    className="btn-ghost !min-h-[38px] !px-3 !py-1.5 text-xs"
                  >
                    <Edit3 size={13} />
                    ویرایش
                  </button>
                  <button
                    type="button"
                    onClick={() => void archiveProperty(prop.id)}
                    className="btn-ghost !min-h-[38px] !px-3 !py-1.5 text-xs text-red-600 hover:border-red-200 hover:text-red-700"
                  >
                    <Archive size={13} />
                    بایگانی
                  </button>
                </div>
              </header>

              {(prop.defaultDimensionsJson?.areaM2 ||
                prop.defaultDimensionsJson?.ceilingHeightCm ||
                prop.notes) ? (
                <div className="space-y-1 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                  <div className="flex flex-wrap gap-3 font-bold">
                    {prop.defaultDimensionsJson?.areaM2 ? (
                      <span className="tabular-fa">
                        متراژ: {formatNumberFa(Number(prop.defaultDimensionsJson.areaM2))} مترمربع
                      </span>
                    ) : null}
                    {prop.defaultDimensionsJson?.ceilingHeightCm ? (
                      <span className="tabular-fa">
                        ارتفاع سقف: {formatNumberFa(Number(prop.defaultDimensionsJson.ceilingHeightCm))}{' '}
                        سانتی‌متر
                      </span>
                    ) : null}
                  </div>
                  {prop.notes ? <p className="text-slate-600">یادداشت: {prop.notes}</p> : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="chip bg-slate-100 !py-0.5 font-bold text-slate-700">
                    <Camera size={12} />
                    {toPersianDigits(prop.mediaCount)} مستندات ثبت‌شده
                  </span>
                  <span
                    className={`chip !py-0.5 text-[11px] font-bold ${
                      prop.hasReady3dModel
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <Box size={12} />
                    {prop.hasReady3dModel ? 'مدل سه‌بعدی آماده' : 'در انتظار اسکن سه‌بعدی'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMediaTargetId(isAttaching ? null : prop.id);
                    setMediaError(null);
                    setMediaSuccess(null);
                    setMediaFile(null);
                  }}
                  className="btn-ghost !min-h-[38px] !px-3 !py-1.5 text-xs"
                >
                  <Upload size={13} />
                  {isAttaching ? 'بستن بخش بارگذاری' : 'افزودن عکس / مستندات محل'}
                </button>
              </div>

              {isAttaching ? (
                <div className="space-y-3 rounded-xl border border-primary-100 bg-primary-50/40 p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1 text-xs font-bold">
                      نوع رسانه
                      <select
                        value={mediaKind}
                        onChange={(e) => setMediaKind(e.target.value as PropertyAssetKind)}
                        className={FIELD_CLASS}
                      >
                        {ASSET_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {PROPERTY_ASSET_KIND_LABELS_FA[kind]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-xs font-bold">
                      انتخاب فایل (اختیاری در محیط توسعه)
                      <input
                        type="file"
                        onChange={(e) => setMediaFile(e.target.files?.[0] ?? null)}
                        className="block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={mediaBusy}
                    onClick={() => void attachMedia(prop.id)}
                    className="btn-primary w-full !py-2.5 text-xs"
                  >
                    {mediaBusy ? <Loader2 size={14} className="animate-spin" /> : 'ثبت رسانه در پرونده مکان'}
                  </button>
                  {mediaError ? (
                    <p className="rounded-lg bg-red-50 p-2 text-xs font-bold text-red-600">
                      {mediaError}
                    </p>
                  ) : null}
                  {mediaSuccess ? (
                    <p className="rounded-lg bg-emerald-50 p-2 text-xs font-bold text-emerald-700">
                      {mediaSuccess}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {assets.length > 0 ? (
                <ul className="space-y-1.5">
                  {assets.map((asset) => {
                    const statusMeta = PROPERTY_ASSET_STATUS_META[asset.status];
                    return (
                      <li
                        key={asset.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-slate-700">
                            {PROPERTY_ASSET_KIND_LABELS_FA[asset.kind]}
                          </p>
                          <p className="truncate text-[11px] text-slate-500" dir="ltr">
                            {asset.mimeType} · {formatBytesFa(asset.sizeBytes)}
                          </p>
                        </div>
                        <span className={`chip !py-0.5 text-[11px] font-bold ${statusMeta.className}`}>
                          {statusMeta.labelFa}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
    </main>
  );
}
