'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, LogIn, Plus, Radio, RefreshCw, X } from 'lucide-react';
import { AuthModal } from '@/components/brief/AuthModal';
import { StateBadge } from '@/components/orders/order-state';
import {
  api,
  ApiError,
  type AdminBranch,
  type AdminTechniciansPage,
  type AdminWarrantyClaim,
  type OrderRow,
  type OrdersPage,
} from '@/lib/api';
import { formatToman, toLatinDigits, toPersianDigits } from '@/lib/format';
import { useDispatchSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';

const SERVICE_LABELS: Record<string, string> = {
  ALARM: 'دزدگیر',
  CCTV: 'دوربین',
  PARKING_JACK: 'جک پارکینگی',
  ELECTRIC_SHUTTER: 'کرکره برقی',
};

const CLAIM_STATUS_OPTIONS = ['IN_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED'] as const;
const CLAIM_STATUS_FA: Record<string, { labelFa: string; className: string }> = {
  OPEN: { labelFa: 'باز', className: 'bg-amber-50 text-amber-700' },
  IN_REVIEW: { labelFa: 'در بررسی', className: 'bg-sky-50 text-sky-700' },
  APPROVED: { labelFa: 'تأیید‌شده', className: 'bg-emerald-50 text-emerald-700' },
  RESOLVED: { labelFa: 'حل‌شده', className: 'bg-emerald-50 text-emerald-700' },
  REJECTED: { labelFa: 'رد‌شده', className: 'bg-red-50 text-red-600' },
};

type TabKey = 'queue' | 'technicians' | 'claims';

function useAdminTechnicians(status?: string) {
  const [techs, setTechs] = useState<AdminTechniciansPage>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    api.adminTechnicians({ status, limit: 100 })
      .then(setTechs)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { techs, loading, error, reload };
}

function Tab1Queue({ orders, reload }: { orders: OrderRow[]; reload: () => void }) {
  const [filter, setFilter] = useState<'ALL' | 'BRANCH_QUEUE' | 'ACTIVE'>('ALL');
  const [selectedTechByOrder, setSelectedTechByOrder] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { techs } = useAdminTechnicians('APPROVED');

  const approvedTechs = techs.items.filter((t) => t.status === 'APPROVED');

  const branchQueueCount = orders.filter((o) => o.state === 'BRANCH_QUEUE').length;
  const activeCount = orders.filter(
    (o) => !['COMPLETED_WARRANTY_ACTIVE', 'CANCELLED', 'ESTIMATED'].includes(o.state),
  ).length;

  const filtered = orders.filter((order) => {
    if (filter === 'BRANCH_QUEUE') return order.state === 'BRANCH_QUEUE';
    if (filter === 'ACTIVE') {
      return !['COMPLETED_WARRANTY_ACTIVE', 'CANCELLED', 'ESTIMATED'].includes(order.state);
    }
    return true;
  });

  const assign = async (orderId: string, technicianUserId: string) => {
    if (!technicianUserId) return;
    setBusyId(orderId);
    setError(null);
    try {
      await api.assignTechnician(orderId, technicianUserId);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در تخصیص تکنسین.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {([
          { key: 'ALL', label: `همه (${toPersianDigits(orders.length)})` },
          { key: 'BRANCH_QUEUE', label: `صف شعبه (${toPersianDigits(branchQueueCount)})` },
          { key: 'ACTIVE', label: `فعال (${toPersianDigits(activeCount)})` },
        ] as Array<{ key: typeof filter; label: string }>).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`chip text-xs font-bold ${
              filter === tab.key ? 'bg-primary-900 text-white' : 'border border-slate-200 text-slate-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}

      {filtered.length === 0 ? (
        <p className="card text-center text-sm text-slate-500">سفارشی در این دسته نیست.</p>
      ) : null}

      {filtered.map((order) => {
        const chosenUserId = selectedTechByOrder[order.id] ?? approvedTechs[0]?.userId ?? '';
        const serviceTitles = (order.items ?? [])
          .map((item) => item.serviceDefinition?.titleFa)
          .filter(Boolean)
          .join('، ');

        return (
          <section key={order.id} className="card space-y-3">
            <header className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-extrabold text-slate-800">{order.orderNumber}</p>
                {serviceTitles ? <p className="text-xs text-slate-500">{serviceTitles}</p> : null}
              </div>
              <div className="flex items-center gap-2">
                <StateBadge state={order.state} />
                <Link
                  href={`/order/${order.id}`}
                  className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold text-primary-700 hover:border-primary-300"
                >
                  مشاهده پرونده
                </Link>
              </div>
            </header>

            {order.finalQuoteAmount ? (
              <p className="tabular-fa text-xs text-slate-500">
                پیش‌فاکتور: {formatToman(order.finalQuoteAmount, 'full')}
              </p>
            ) : order.pricing?.netEstimated ? (
              <p className="tabular-fa text-xs text-slate-500">
                برآورد اولیه: {formatToman(order.pricing.netEstimated, 'full')}
              </p>
            ) : null}

            {order.state === 'BRANCH_QUEUE' ? (
              <div className="space-y-2 rounded-xl bg-purple-50/60 p-3">
                <p className="text-xs font-bold text-purple-900">تخصیص دستی تکنسین تأیید‌شده:</p>
                {approvedTechs.length === 0 ? (
                  <p className="text-xs text-slate-500">تکنسین تأیید‌شده‌ای در شعبه نیست.</p>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      value={chosenUserId}
                      onChange={(event) =>
                        setSelectedTechByOrder((prev) => ({
                          ...prev,
                          [order.id]: event.target.value,
                        }))
                      }
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 focus:border-primary-400 focus:outline-none"
                    >
                      {approvedTechs.map((tech) => {
                        const skillLabels = tech.skills
                          .map((s) => SERVICE_LABELS[s] ?? s)
                          .join('، ');
                        const name =
                          `${tech.user.firstName ?? ''} ${tech.user.lastName ?? ''}`.trim() ||
                          tech.user.phone;
                        return (
                          <option key={tech.id} value={tech.userId}>
                            {name} ({tech.user.phone}) — ⭐ {toPersianDigits(tech.rating)} —{' '}
                            {skillLabels} {tech.isOnline ? '• آنلاین' : '• آفلاین'}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      type="button"
                      disabled={busyId === order.id || !chosenUserId}
                      onClick={() => void assign(order.id, chosenUserId)}
                      className="btn-primary !py-2.5 text-xs"
                    >
                      {busyId === order.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        'تخصیص دستی تکنسین'
                      )}
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

const EMPTY_TECH_FORM = {
  phone: '',
  firstName: '',
  lastName: '',
  branchId: '',
  skills: ['ALARM'] as string[],
};

function Tab2Technicians({ userRole }: { userRole: string }) {
  const { techs, loading, error: loadError, reload } = useAdminTechnicians();
  const [branches, setBranches] = useState<AdminBranch[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_TECH_FORM);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    api.adminBranches()
      .then((rows) => {
        setBranches(rows);
        if (rows[0]?.id) {
          setForm((prev) => ({ ...prev, branchId: prev.branchId || rows[0].id }));
        }
      })
      .catch(() => undefined);
  }, []);

  const toggleStatus = async (profileId: string, current: string) => {
    const next = current === 'APPROVED' ? 'SUSPENDED' : 'APPROVED';
    setTogglingId(profileId);
    setError(null);
    try {
      await api.updateTechnician(profileId, { status: next });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در تغییر وضعیت.');
    } finally {
      setTogglingId(null);
    }
  };

  const openModal = () => {
    setModalError(null);
    setForm((prev) => ({
      ...EMPTY_TECH_FORM,
      branchId: prev.branchId || branches[0]?.id || '',
    }));
    setShowAdd(true);
  };

  const add = async () => {
    const targetBranchId = form.branchId || branches[0]?.id || '';
    if (!targetBranchId) {
      setModalError('شناسه شعبه یافت نشد.');
      return;
    }
    const cleanPhone = toLatinDigits(form.phone).trim();
    if (cleanPhone.length < 10) {
      setModalError('شماره موبایل معتبر وارد کنید.');
      return;
    }
    if (form.skills.length === 0) {
      setModalError('حداقل یک مهارت انتخاب کنید.');
      return;
    }

    setBusy(true);
    setModalError(null);
    try {
      await api.createTechnician({
        phone: cleanPhone,
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        branchId: targetBranchId,
        skills: form.skills,
      });
      setShowAdd(false);
      setForm({ ...EMPTY_TECH_FORM, branchId: targetBranchId });
      reload();
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : 'خطا در افزودن تکنسین.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={openModal} className="btn-ghost w-full">
        <Plus size={16} />
        افزودن تکنسین جدید
      </button>

      {error || loadError ? (
        <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">
          {error ?? loadError}
        </p>
      ) : null}

      {loading && techs.items.length === 0 ? (
        <div className="card flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="animate-spin" size={22} />
        </div>
      ) : techs.items.length === 0 ? (
        <p className="card text-center text-sm text-slate-500">تکنسینی برای شعبه ثبت نشده است.</p>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full min-w-[680px] text-right text-xs">
            <thead className="border-b border-slate-100 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-bold">نام و تماس</th>
                <th className="px-4 py-3 font-bold">مهارت‌ها</th>
                <th className="px-4 py-3 font-bold">امتیاز</th>
                <th className="px-4 py-3 font-bold">نرخ خرابی</th>
                <th className="px-4 py-3 font-bold">حضور</th>
                <th className="px-4 py-3 font-bold">وضعیت</th>
                <th className="px-4 py-3 font-bold">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {techs.items.map((tech) => (
                <tr key={tech.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <p className="font-extrabold text-slate-800">
                      {`${tech.user.firstName ?? ''} ${tech.user.lastName ?? ''}`.trim() || 'بدون نام'}
                    </p>
                    <p dir="ltr" className="tabular-fa text-[11px] text-slate-500">
                      {tech.user.phone}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {tech.skills.map((skill) => (
                        <span key={skill} className="chip bg-primary-50 !px-2 !py-0.5 text-[11px] text-primary-700">
                          {SERVICE_LABELS[skill] ?? skill}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="tabular-fa whitespace-nowrap px-4 py-3 font-bold text-slate-700">
                    ⭐ {toPersianDigits(tech.rating)} ({toPersianDigits(tech.ratingCount)})
                  </td>
                  <td className="tabular-fa whitespace-nowrap px-4 py-3 text-slate-600">
                    {toPersianDigits((Number(tech.warrantyClaimRate) * 100).toFixed(1))}٪
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`chip !px-2 !py-0.5 text-[11px] font-bold ${
                        tech.isOnline
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {tech.isOnline ? 'آنلاین' : 'آفلاین'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`chip !px-2 !py-0.5 text-[11px] font-bold ${
                        tech.status === 'APPROVED'
                          ? 'bg-emerald-50 text-emerald-700'
                          : tech.status === 'SUSPENDED'
                            ? 'bg-red-50 text-red-600'
                            : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {tech.status === 'APPROVED'
                        ? 'تأیید‌شده'
                        : tech.status === 'SUSPENDED'
                          ? 'معلق'
                          : 'در انتظار تأیید'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <button
                      type="button"
                      disabled={togglingId === tech.id}
                      onClick={() => void toggleStatus(tech.id, tech.status)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${
                        tech.status === 'APPROVED'
                          ? 'border border-red-200 text-red-600 hover:bg-red-50'
                          : 'border border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                      }`}
                    >
                      {togglingId === tech.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : tech.status === 'APPROVED' ? (
                        'تعلیق'
                      ) : (
                        'تأیید'
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => !busy && setShowAdd(false)}
        >
          <div className="card w-full max-w-sm space-y-3" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800">افزودن تکنسین جدید</h3>
              <button type="button" onClick={() => !busy && setShowAdd(false)} aria-label="بستن">
                <X size={16} className="text-slate-400" />
              </button>
            </div>
            {userRole === 'SUPER_ADMIN' && branches.length > 0 ? (
              <select
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 focus:border-primary-400 focus:outline-none"
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.nameFa} ({branch.code})
                  </option>
                ))}
              </select>
            ) : branches[0] ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                شعبه: {branches[0].nameFa}
              </p>
            ) : null}
            <input
              dir="ltr"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="09123456789"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-left text-sm focus:border-primary-400 focus:outline-none"
            />
            <input
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              placeholder="نام"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none"
            />
            <input
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              placeholder="نام خانوادگی"
              className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none"
            />
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-slate-600">مهارت‌ها:</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(SERVICE_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        skills: prev.skills.includes(key)
                          ? prev.skills.filter((s) => s !== key)
                          : [...prev.skills, key],
                      }))
                    }
                    className={`chip text-xs ${
                      form.skills.includes(key)
                        ? 'border border-emerald-300 bg-emerald-50 font-bold text-emerald-700'
                        : 'border border-slate-200 text-slate-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {modalError ? (
              <p className="rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-600">{modalError}</p>
            ) : null}
            <button
              type="button"
              onClick={add}
              disabled={busy || toLatinDigits(form.phone).trim().length < 10 || form.skills.length === 0}
              className="btn-primary w-full"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : 'ثبت تکنسین'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Tab3Claims() {
  const [claims, setClaims] = useState<AdminWarrantyClaim[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setError(null);
    api.adminWarrantyClaims()
      .then(setClaims)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const update = async (claimId: string, status: string) => {
    setBusyId(claimId);
    setError(null);
    try {
      await api.updateWarrantyClaim(claimId, status, notes[claimId]?.trim() || undefined);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در به‌روزرسانی تیکت.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}
      {!claims && !error ? (
        <div className="card flex items-center justify-center py-10 text-slate-400">
          <Loader2 className="animate-spin" size={22} />
        </div>
      ) : null}
      {claims && claims.length === 0 ? (
        <p className="card text-center text-sm text-slate-500">تیکت ضمانتی برای شعبه شما ثبت نشده است.</p>
      ) : null}
      {(claims ?? []).map((claim) => {
        const meta = CLAIM_STATUS_FA[claim.status] ?? {
          labelFa: claim.status,
          className: 'bg-slate-100 text-slate-600',
        };
        return (
          <section key={claim.id} className="card space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-extrabold text-slate-800">
                  {claim.warranty?.order?.orderNumber ?? '—'} — {claim.warranty?.policyNumber ?? ''}
                </p>
                <p className="tabular-fa text-[10px] text-slate-400">
                  {toPersianDigits(new Date(claim.createdAt).toLocaleDateString('fa-IR'))}
                </p>
              </div>
              <span className={`chip text-[11px] font-bold ${meta.className}`}>{meta.labelFa}</span>
            </div>
            <p className="text-xs leading-6 text-slate-700">{claim.descriptionFa}</p>
            {claim.resolutionNoteFa ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                یادداشت فعلی: {claim.resolutionNoteFa}
              </p>
            ) : null}
            <input
              value={notes[claim.id] ?? claim.resolutionNoteFa ?? ''}
              onChange={(event) => setNotes((prev) => ({ ...prev, [claim.id]: event.target.value }))}
              placeholder="یادداشت رسیدگی (اختیاری)"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-primary-400 focus:outline-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {CLAIM_STATUS_OPTIONS.map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={busyId === claim.id}
                  onClick={() => void update(claim.id, status)}
                  className={`chip text-[11px] font-bold ${
                    status === 'APPROVED' || status === 'RESOLVED'
                      ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                      : status === 'REJECTED'
                        ? 'border border-red-200 bg-red-50 text-red-600'
                        : 'border border-sky-200 bg-sky-50 text-sky-700'
                  }`}
                >
                  {CLAIM_STATUS_FA[status]?.labelFa ?? status}
                  {busyId === claim.id ? <Loader2 size={11} className="animate-spin" /> : null}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BranchDashboard({ userRole }: { userRole: string }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [orders, setOrders] = useState<OrdersPage | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<TabKey>('queue');

  const reloadOrders = useCallback(() => {
    if (!accessToken) return;
    setRefreshing(true);
    api.orders({ limit: 50 })
      .then(setOrders)
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, [accessToken]);

  useEffect(() => {
    reloadOrders();
  }, [reloadOrders]);

  const { connected } = useDispatchSocket(accessToken, {
    notification: () => reloadOrders(),
  });

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 pb-16 pt-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-primary-950">پنل مدیریت شعبه</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reloadOrders}
            disabled={refreshing}
            className="btn-ghost !px-3 !py-1.5 text-xs"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            بروزرسانی
          </button>
          <span
            className={`chip text-xs font-bold ${
              connected ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'
            }`}
          >
            <Radio size={13} className={connected ? 'animate-pulse' : ''} />
            {connected ? 'متصل زنده' : 'آفلاین'}
          </span>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {([
          { key: 'queue' as TabKey, labelFa: 'صف سفارش‌ها' },
          { key: 'technicians' as TabKey, labelFa: 'مدیریت تکنسین‌ها' },
          { key: 'claims' as TabKey, labelFa: 'رسیدگی به تیکت‌های ضمانت' },
        ]).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`chip text-xs font-bold ${
              tab === item.key ? 'bg-primary-900 text-white' : 'border border-slate-200 text-slate-600'
            }`}
          >
            {item.labelFa}
          </button>
        ))}
      </div>

      {tab === 'queue' ? <Tab1Queue orders={orders?.items ?? []} reload={reloadOrders} /> : null}
      {tab === 'technicians' ? <Tab2Technicians userRole={userRole} /> : null}
      {tab === 'claims' ? <Tab3Claims /> : null}
    </main>
  );
}

export default function BranchPage() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [authOpen, setAuthOpen] = useState(false);

  if (!hasHydrated) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10">
        <div className="card flex items-center justify-center py-12 text-slate-400">
          <Loader2 className="animate-spin" size={24} />
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10 text-center">
        <div className="card space-y-4">
          <p className="text-base font-extrabold text-slate-800">پنل مدیریت شعبه هومنتال</p>
          <p className="text-xs text-slate-500">برای ورود به پنل مدیریت، با شماره موبایل مدیر شعبه وارد شوید.</p>
          <button type="button" onClick={() => setAuthOpen(true)} className="btn-primary mx-auto">
            <LogIn size={16} />
            ورود به حساب مدیر شعبه
          </button>
        </div>
        {authOpen ? <AuthModal onDone={() => setAuthOpen(false)} /> : null}
      </main>
    );
  }

  if (user.role !== 'BRANCH_ADMIN' && user.role !== 'SUPER_ADMIN') {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10 text-center">
        <div className="card space-y-3">
          <p className="text-sm font-bold text-red-600">
            این پنل فقط برای مدیران شعبه فعال است.
          </p>
          <button type="button" onClick={logout} className="btn-ghost mx-auto text-xs">
            خروج و ورود با حساب مدیر شعبه
          </button>
        </div>
      </main>
    );
  }

  return <BranchDashboard userRole={user.role} />;
}
