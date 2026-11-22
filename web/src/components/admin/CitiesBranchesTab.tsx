'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Edit3, Globe, Loader2, Plus, Store, X } from 'lucide-react';
import { api, ApiError, type AdminBranch, type AdminCity } from '@/lib/api';
import { toLatinDigits, toPersianDigits } from '@/lib/format';

interface CityForm {
  slug: string;
  nameFa: string;
  nameEn: string;
  centerLat: string;
  centerLng: string;
  launchOrder: string;
}

const EMPTY_CITY_FORM: CityForm = {
  slug: '',
  nameFa: '',
  nameEn: '',
  centerLat: '35.6892',
  centerLng: '51.3890',
  launchOrder: '10',
};

interface BranchForm {
  id?: string;
  cityId: string;
  code: string;
  nameFa: string;
  addressFa: string;
  phone: string;
  lat: string;
  lng: string;
  serviceRadiusMeters: string;
  hasPhysicalShowroom: boolean;
  commissionRateOverride: string;
  warrantyReserveOverride: string;
}

const EMPTY_BRANCH_FORM: BranchForm = {
  cityId: '',
  code: '',
  nameFa: '',
  addressFa: '',
  phone: '',
  lat: '36.3105',
  lng: '59.5663',
  serviceRadiusMeters: '15000',
  hasPhysicalShowroom: false,
  commissionRateOverride: '',
  warrantyReserveOverride: '',
};

function toNum(raw: string): number {
  return Number(toLatinDigits(raw).trim());
}

export function CitiesBranchesTab() {
  const [cities, setCities] = useState<AdminCity[]>([]);
  const [branches, setBranches] = useState<AdminBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [cityModalOpen, setCityModalOpen] = useState(false);
  const [cityForm, setCityForm] = useState<CityForm>(EMPTY_CITY_FORM);
  const [cityModalError, setCityModalError] = useState<string | null>(null);

  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [branchForm, setBranchForm] = useState<BranchForm>(EMPTY_BRANCH_FORM);
  const [branchModalError, setBranchModalError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([api.adminCities(), api.adminBranches()])
      .then(([cityRows, branchRows]) => {
        setCities(cityRows);
        setBranches(branchRows);
      })
      .catch((err: Error) =>
        setError(err instanceof ApiError ? err.message : 'خطا در دریافت شهرها و شعب.'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const toggleCityActive = async (city: AdminCity) => {
    setBusyKey(`city:${city.id}`);
    setError(null);
    try {
      await api.updateCity(city.id, { isActive: !city.isActive });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در تغییر وضعیت شهر.');
    } finally {
      setBusyKey(null);
    }
  };

  const toggleBranchActive = async (branch: AdminBranch) => {
    setBusyKey(`branch:${branch.id}`);
    setError(null);
    try {
      await api.updateBranch(branch.id, { isActive: !branch.isActive });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در تغییر وضعیت شعبه.');
    } finally {
      setBusyKey(null);
    }
  };

  const submitCity = async () => {
    setBusyKey('city-submit');
    setCityModalError(null);
    try {
      await api.createCity({
        slug: cityForm.slug.trim().toLowerCase(),
        nameFa: cityForm.nameFa.trim(),
        nameEn: cityForm.nameEn.trim(),
        centerLat: toNum(cityForm.centerLat),
        centerLng: toNum(cityForm.centerLng),
        launchOrder: toNum(cityForm.launchOrder || '0'),
      });
      setCityModalOpen(false);
      setCityForm(EMPTY_CITY_FORM);
      reload();
    } catch (err) {
      setCityModalError(err instanceof ApiError ? err.message : 'خطا در ثبت شهر جدید.');
    } finally {
      setBusyKey(null);
    }
  };

  const openCreateBranch = () => {
    setBranchModalError(null);
    setBranchForm({
      ...EMPTY_BRANCH_FORM,
      cityId: cities[0]?.id ?? '',
    });
    setBranchModalOpen(true);
  };

  const openEditBranch = (branch: AdminBranch) => {
    setBranchModalError(null);
    setBranchForm({
      id: branch.id,
      cityId: branch.cityId,
      code: branch.code,
      nameFa: branch.nameFa,
      addressFa: branch.addressFa,
      phone: branch.phone ?? '',
      lat: String(branch.lat),
      lng: String(branch.lng),
      serviceRadiusMeters: String(branch.serviceRadiusMeters),
      hasPhysicalShowroom: branch.hasPhysicalShowroom,
      commissionRateOverride:
        branch.commissionRateOverride !== null ? String(branch.commissionRateOverride) : '',
      warrantyReserveOverride:
        branch.warrantyReserveOverride !== null ? String(branch.warrantyReserveOverride) : '',
    });
    setBranchModalOpen(true);
  };

  const submitBranch = async () => {
    setBusyKey('branch-submit');
    setBranchModalError(null);
    const commissionText = toLatinDigits(branchForm.commissionRateOverride).trim();
    const reserveText = toLatinDigits(branchForm.warrantyReserveOverride).trim();
    const commissionOverride = commissionText === '' ? null : Number(commissionText);
    const reserveOverride = reserveText === '' ? null : Number(reserveText);

    try {
      if (branchForm.id) {
        await api.updateBranch(branchForm.id, {
          nameFa: branchForm.nameFa.trim(),
          addressFa: branchForm.addressFa.trim(),
          phone: branchForm.phone.trim() || undefined,
          lat: toNum(branchForm.lat),
          lng: toNum(branchForm.lng),
          serviceRadiusMeters: toNum(branchForm.serviceRadiusMeters || '15000'),
          hasPhysicalShowroom: branchForm.hasPhysicalShowroom,
          commissionRateOverride: commissionOverride,
          warrantyReserveOverride: reserveOverride,
        });
      } else {
        await api.createBranch({
          cityId: branchForm.cityId,
          code: branchForm.code.trim().toUpperCase(),
          nameFa: branchForm.nameFa.trim(),
          addressFa: branchForm.addressFa.trim(),
          phone: branchForm.phone.trim() || undefined,
          lat: toNum(branchForm.lat),
          lng: toNum(branchForm.lng),
          serviceRadiusMeters: toNum(branchForm.serviceRadiusMeters || '15000'),
          hasPhysicalShowroom: branchForm.hasPhysicalShowroom,
          commissionRateOverride: commissionOverride,
          warrantyReserveOverride: reserveOverride,
        });
      }
      setBranchModalOpen(false);
      reload();
    } catch (err) {
      setBranchModalError(err instanceof ApiError ? err.message : 'خطا در ذخیره اطلاعات شعبه.');
    } finally {
      setBusyKey(null);
    }
  };

  if (loading && cities.length === 0) {
    return (
      <div className="card flex items-center justify-center py-12 text-slate-400">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}

      {/* Cities Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
            <Globe size={16} className="text-primary-700" />
            شهرهای فعال و در صف راه‌اندازی ({toPersianDigits(cities.length)})
          </h2>
          <button
            type="button"
            onClick={() => {
              setCityModalError(null);
              setCityModalOpen(true);
            }}
            className="btn-ghost !px-3 !py-1.5 text-xs"
          >
            <Plus size={14} />
            افزودن شهر جدید
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cities.map((city) => (
            <div key={city.id} className="card flex items-center justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-extrabold text-slate-800">
                  {city.nameFa}
                  <span className="text-xs font-normal text-slate-400">({city.nameEn})</span>
                </p>
                <p className="tabular-fa mt-1 text-[11px] text-slate-500">
                  <span dir="ltr">{city.slug}</span> • اولویت: {toPersianDigits(city.launchOrder)} •{' '}
                  {toPersianDigits(city._count?.branches ?? 0)} شعبه
                </p>
              </div>
              <button
                type="button"
                disabled={busyKey === `city:${city.id}`}
                onClick={() => void toggleCityActive(city)}
                className={`chip text-xs font-bold ${
                  city.isActive
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border border-slate-200 bg-slate-100 text-slate-500'
                }`}
              >
                {busyKey === `city:${city.id}` ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : city.isActive ? (
                  'فعال'
                ) : (
                  'غیرفعال'
                )}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Branches Section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-slate-800">
            <Building2 size={16} className="text-primary-700" />
            نمایندگی‌ها و شعب ({toPersianDigits(branches.length)})
          </h2>
          <button
            type="button"
            disabled={cities.length === 0}
            onClick={openCreateBranch}
            className="btn-primary !px-3 !py-1.5 text-xs"
          >
            <Plus size={14} />
            افزودن شعبه / شریک
          </button>
        </div>

        <div className="space-y-3">
          {branches.map((branch) => (
            <div key={branch.id} className="card space-y-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-extrabold text-slate-800">
                    {branch.nameFa}
                    <span dir="ltr" className="chip bg-slate-100 text-[11px] text-slate-600">
                      {branch.code}
                    </span>
                    {branch.hasPhysicalShowroom ? (
                      <span className="chip bg-emerald-50 text-[11px] font-bold text-emerald-700">
                        <Store size={12} />
                        شوروم فیزیکی
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {branch.city?.nameFa ? `${branch.city.nameFa} — ` : ''}
                    {branch.addressFa}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEditBranch(branch)}
                    className="btn-ghost !px-2.5 !py-1 text-xs"
                  >
                    <Edit3 size={12} />
                    ویرایش قرارداد
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === `branch:${branch.id}`}
                    onClick={() => void toggleBranchActive(branch)}
                    className={`chip text-xs font-bold ${
                      branch.isActive
                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border border-red-200 bg-red-50 text-red-600'
                    }`}
                  >
                    {branch.isActive ? 'فعال' : 'معلق'}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-[11px] text-slate-600">
                <span className="chip bg-slate-50">
                  شعاع پوشش: {toPersianDigits(Math.round(branch.serviceRadiusMeters / 1000))} کیلومتر
                </span>
                <span className="chip bg-primary-50 text-primary-800">
                  کمیسیون اختصاصی:{' '}
                  {branch.commissionRateOverride !== null
                    ? `${toPersianDigits((branch.commissionRateOverride * 100).toFixed(1).replace(/\.0$/, ''))}٪`
                    : 'نرخ پایه پلتفرم'}
                </span>
                <span className="chip bg-slate-50">
                  ذخیره ضمانت اختصاصی:{' '}
                  {branch.warrantyReserveOverride !== null
                    ? `${toPersianDigits((branch.warrantyReserveOverride * 100).toFixed(1).replace(/\.0$/, ''))}٪`
                    : 'نرخ پایه (۵٪)'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Add City Modal */}
      {cityModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => busyKey !== 'city-submit' && setCityModalOpen(false)}
        >
          <div className="card w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800">افزودن شهر جدید</h3>
              <button type="button" onClick={() => setCityModalOpen(false)} aria-label="بستن">
                <X size={16} className="text-slate-400" />
              </button>
            </div>
            <input
              dir="ltr"
              value={cityForm.slug}
              onChange={(e) => setCityForm({ ...cityForm, slug: e.target.value })}
              placeholder="slug (e.g. tehran)"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs focus:border-primary-400 focus:outline-none"
            />
            <input
              value={cityForm.nameFa}
              onChange={(e) => setCityForm({ ...cityForm, nameFa: e.target.value })}
              placeholder="نام فارسی شهر (مثلاً: تهران)"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-primary-400 focus:outline-none"
            />
            <input
              dir="ltr"
              value={cityForm.nameEn}
              onChange={(e) => setCityForm({ ...cityForm, nameEn: e.target.value })}
              placeholder="English name (Tehran)"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs focus:border-primary-400 focus:outline-none"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                dir="ltr"
                value={cityForm.centerLat}
                onChange={(e) => setCityForm({ ...cityForm, centerLat: e.target.value })}
                placeholder="Lat"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs"
              />
              <input
                dir="ltr"
                value={cityForm.centerLng}
                onChange={(e) => setCityForm({ ...cityForm, centerLng: e.target.value })}
                placeholder="Lng"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs"
              />
              <input
                dir="ltr"
                value={cityForm.launchOrder}
                onChange={(e) => setCityForm({ ...cityForm, launchOrder: e.target.value })}
                placeholder="Order"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs"
              />
            </div>
            {cityModalError ? (
              <p className="rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-600">{cityModalError}</p>
            ) : null}
            <button
              type="button"
              disabled={busyKey === 'city-submit' || !cityForm.slug || !cityForm.nameFa || !cityForm.nameEn}
              onClick={() => void submitCity()}
              className="btn-primary w-full"
            >
              {busyKey === 'city-submit' ? <Loader2 size={15} className="animate-spin" /> : 'ثبت شهر'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Create / Edit Branch Modal */}
      {branchModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => busyKey !== 'branch-submit' && setBranchModalOpen(false)}
        >
          <div
            className="card max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800">
                {branchForm.id ? 'ویرایش شعبه و نرخ کمیسیون' : 'افزودن شعبه جدید'}
              </h3>
              <button type="button" onClick={() => setBranchModalOpen(false)} aria-label="بستن">
                <X size={16} className="text-slate-400" />
              </button>
            </div>

            {!branchForm.id ? (
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={branchForm.cityId}
                  onChange={(e) => setBranchForm({ ...branchForm, cityId: e.target.value })}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                >
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameFa}
                    </option>
                  ))}
                </select>
                <input
                  dir="ltr"
                  value={branchForm.code}
                  onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })}
                  placeholder="Code (e.g. MSHD-W2)"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-left text-xs"
                />
              </div>
            ) : null}

            <input
              value={branchForm.nameFa}
              onChange={(e) => setBranchForm({ ...branchForm, nameFa: e.target.value })}
              placeholder="نام فارسی شعبه"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
            <input
              value={branchForm.addressFa}
              onChange={(e) => setBranchForm({ ...branchForm, addressFa: e.target.value })}
              placeholder="نشانی کامل شعبه"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                dir="ltr"
                value={branchForm.phone}
                onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
                placeholder="Phone (+98...)"
                className="rounded-xl border border-slate-200 px-3 py-2 text-left text-xs"
              />
              <input
                dir="ltr"
                value={branchForm.lat}
                onChange={(e) => setBranchForm({ ...branchForm, lat: e.target.value })}
                placeholder="Lat"
                className="rounded-xl border border-slate-200 px-3 py-2 text-left text-xs"
              />
              <input
                dir="ltr"
                value={branchForm.lng}
                onChange={(e) => setBranchForm({ ...branchForm, lng: e.target.value })}
                placeholder="Lng"
                className="rounded-xl border border-slate-200 px-3 py-2 text-left text-xs"
              />
            </div>

            <label className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-bold text-emerald-900">
              <input
                type="checkbox"
                checked={branchForm.hasPhysicalShowroom}
                onChange={(e) =>
                  setBranchForm({ ...branchForm, hasPhysicalShowroom: e.target.checked })
                }
              />
              دارای شوروم فیزیکی (شریک تجاری با کمیسیون ترجیحی)
            </label>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">
                  کمیسیون اختصاصی (۰ تا ۱ — خالی = پایه)
                </label>
                <input
                  dir="ltr"
                  value={branchForm.commissionRateOverride}
                  onChange={(e) =>
                    setBranchForm({ ...branchForm, commissionRateOverride: e.target.value })
                  }
                  placeholder="مثلاً 0.10"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold text-slate-600">
                  ذخیره ضمانت (۰ تا ۱ — خالی = پایه)
                </label>
                <input
                  dir="ltr"
                  value={branchForm.warrantyReserveOverride}
                  onChange={(e) =>
                    setBranchForm({ ...branchForm, warrantyReserveOverride: e.target.value })
                  }
                  placeholder="مثلاً 0.05"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-bold text-slate-600">
                شعاع پوشش سرویس (متر)
              </label>
              <input
                dir="ltr"
                value={branchForm.serviceRadiusMeters}
                onChange={(e) =>
                  setBranchForm({ ...branchForm, serviceRadiusMeters: e.target.value })
                }
                placeholder="15000"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-left text-xs"
              />
            </div>

            {branchModalError ? (
              <p className="rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-600">
                {branchModalError}
              </p>
            ) : null}

            <button
              type="button"
              disabled={busyKey === 'branch-submit' || !branchForm.nameFa || !branchForm.addressFa}
              onClick={() => void submitBranch()}
              className="btn-primary w-full"
            >
              {busyKey === 'branch-submit' ? (
                <Loader2 size={15} className="animate-spin" />
              ) : branchForm.id ? (
                'ذخیره تغییرات شعبه'
              ) : (
                'ایجاد شعبه'
              )}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
