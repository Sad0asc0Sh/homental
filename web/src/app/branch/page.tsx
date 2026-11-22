'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { StateBadge } from '@/components/orders/order-state';
import { api, ApiError, type AdminTechniciansPage, type AdminWarrantyClaim, type OrdersPage, type OrderRow } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { formatToman, toPersianDigits } from '@/lib/format';

const SERVICE_LABELS: Record<string, string> = {
  ALARM: 'دزدگیر',
  CCTV: 'دوربین',
  PARKING_JACK: 'جک پارکینگی',
  ELECTRIC_SHUTTER: 'کرکره برقی',
};

const CLAIM_STATUS_OPTIONS = ['IN_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED'] as const;
const CLAIM_STATUS_FA: Record<string, string> = {
  OPEN: 'باز',
  IN_REVIEW: 'در بررسی',
  APPROVED: 'تأیید‌شده',
  RESOLVED: 'حل‌شده',
  REJECTED: 'رد‌شده',
};

type TabKey = 'queue' | 'technicians' | 'claims';

function RoleGuard({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10 text-center">
        <p className="card text-sm text-slate-600">برای ورود به پنل مدیریت، ابتدا وارد حساب شوید.</p>
      </main>
    );
  }
  if (user.role !== 'BRANCH_ADMIN' && user.role !== 'SUPER_ADMIN') {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10 text-center">
        <p className="card text-sm font-bold text-red-600">
          این پنل فقط برای مدیران شعبه فعال است.
        </p>
      </main>
    );
  }
  return <>{children}</>;
}

function Tab1Queue({ orders, reload }: { orders: OrderRow[]; reload: () => void }) {
  const [filter, setFilter] = useState<'BRANCH_QUEUE' | 'ACTIVE' | 'ALL'>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { techs } = useTechs();

  const filtered = orders.filter((order) => {
    if (filter === 'BRANCH_QUEUE') return order.state === 'BRANCH_QUEUE';
    if (filter === 'ACTIVE') return !['COMPLETED_WARRANTY_ACTIVE', 'CANCELLED', 'ESTIMATED'].includes(order.state);
    return true;
  });

  const assign = async (orderId: string, technicianUserId: string) => {
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
      <div className="flex gap-2">
        {([
          { key: 'ALL', label: 'همه' },
          { key: 'BRANCH_QUEUE', label: 'صف شعبه' },
          { key: 'ACTIVE', label: 'فعال' },
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

      {filtered.map((order) => (
        <section key={order.id} className="card space-y-3">
          <header className="flex items-center justify-between">
            <p className="font-extrabold text-slate-800">{order.orderNumber}</p>
            <StateBadge state={order.state} />
          </header>
          {order.finalQuoteAmount ? (
            <p className="text-xs text-slate-500">پیش‌فاکتور: {formatToman(order.finalQuoteAmount)}</p>
          ) : null}

          {order.state === 'BRANCH_QUEUE' ? (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-700">تخصیص دستی تکنسین:</p>
              {techs.items.length === 0 ? (
                <p className="text-xs text-slate-400">تکنسین تأیید‌شده‌ای در شعبه نیست.</p>
              ) : (
                <div className="space-y-2">
                  {techs.items.map((tech) => (
                    <button
                      key={tech.id}
                      type="button"
                      disabled={busyId === order.id}
                      onClick={() => assign(order.id, tech.userId)}
                      className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-3 text-right text-xs hover:border-primary-400 disabled:opacity-50"
                    >
                      <span className="font-bold text-slate-700">
                        {tech.user.firstName ?? ''} {tech.user.lastName ?? ''}{' '}
                        <span dir="ltr" className="text-slate-400">{tech.user.phone}</span>
                      </span>
                      <span className="flex items-center gap-1 text-emerald-600">
                        <span className="tabular-fa">⭐ {toPersianDigits(tech.rating)}</span>
                        {busyId === order.id ? <Loader2 size={13} className="animate-spin" /> : null}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function useTechs() {
  const [techs, setTechs] = useState<AdminTechniciansPage>({ items: [], total: 0 });
  const reload = useCallback(() => {
    api.adminTechnicians().then(setTechs).catch(() => undefined);
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { techs, reload };
}

function Tab2Technicians() {
  const { techs, reload } = useTechs();
  const user = useAuthStore((s) => s.user);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ phone: '', firstName: '', lastName: '', skills: ['ALARM'] as string[] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [branchId, setBranchId] = useState<string | null>(null);

  useEffect(() => {
    if (user) api.authMe().then((me) => setBranchId(me.branchId)).catch(() => undefined);
  }, [user]);

  const toggleStatus = async (profileId: string, current: string) => {
    const next = current === 'APPROVED' ? 'SUSPENDED' : 'APPROVED';
    setError(null);
    try {
      await api.updateTechnician(profileId, { status: next });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در تغییر وضعیت.');
    }
  };

  const add = async () => {
    if (!branchId) {
      setError('شناسه شعبه شما یافت نشد.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createTechnician({ ...form, branchId });
      setShowAdd(false);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'خطا در افزودن تکنسین.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => setShowAdd(true)} className="btn-ghost w-full">
        <Plus size={16} />
        افزودن تکنسین جدید
      </button>
      {error ? <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p> : null}

      {techs.items.map((tech) => (
        <section key={tech.id} className="card space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-extrabold text-slate-800">
                {tech.user.firstName ?? ''} {tech.user.lastName ?? ''}
              </p>
              <p dir="ltr" className="text-xs text-slate-500">{tech.user.phone}</p>
            </div>
            <span
              className={`chip text-[11px] font-bold ${
                tech.status === 'APPROVED'
                  ? 'bg-emerald-50 text-emerald-700'
                  : tech.status === 'SUSPENDED'
                    ? 'bg-red-50 text-red-600'
                    : 'bg-amber-50 text-amber-700'
              }`}
            >
              {tech.status === 'APPROVED' ? 'تأیید‌شده' : tech.status === 'SUSPENDED' ? 'معلق' : 'در انتظار تأیید'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tech.skills.map((skill) => (
              <span key={skill} className="chip bg-primary-50 text-[11px] text-primary-700">
                {SERVICE_LABELS[skill] ?? skill}
              </span>
            ))}
            <span className="chip bg-slate-50 text-[11px] text-slate-600">
              ⭐ {toPersianDigits(tech.rating)} ({toPersianDigits(tech.ratingCount)})
            </span>
            <span className="chip bg-slate-50 text-[11px] text-slate-600">
              نرخ خرابی: {toPersianDigits((Number(tech.warrantyClaimRate) * 100).toFixed(1))}٪
            </span>
            {tech.isOnline ? <span className="chip bg-emerald-50 text-[11px] text-emerald-700">آنلاین</span> : null}
          </div>
          <button
            type="button"
            onClick={() => toggleStatus(tech.id, tech.status)}
            className={`w-full rounded-xl py-2 text-xs font-bold ${
              tech.status === 'APPROVED'
                ? 'border border-red-200 text-red-600 hover:bg-red-50'
                : 'border border-emerald-200 text-emerald-700 hover:bg-emerald-50'
            }`}
          >
            {tech.status === 'APPROVED' ? 'تعلیق تکنسین' : 'تأیید تکنسین'}
          </button>
        </section>
      ))}

      {showAdd ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setShowAdd(false)}>
          <div className="card w-full max-w-sm space-y-3" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800">افزودن تکنسین جدید</h3>
              <button type="button" onClick={() => setShowAdd(false)} aria-label="بستن">
                <X size={16} className="text-slate-400" />
              </button>
            </div>
            <input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="09xxxxxxxxx" className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-left text-sm focus:border-primary-400 focus:outline-none" />
            <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="نام" className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none" />
            <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder="نام خانوادگی" className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none" />
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
                    form.skills.includes(key) ? 'bg-emerald-50 text-emerald-700 border border-emerald-300' : 'border border-slate-200 text-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={add} disabled={busy || form.phone.length < 10} className="btn-primary w-full">
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
    api.adminWarrantyClaims().then(setClaims).catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const update = async (claimId: string, status: string) => {
    setBusyId(claimId);
    setError(null);
    try {
      await api.updateWarrantyClaim(claimId, status, notes[claimId]);
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
      {claims && claims.length === 0 ? (
        <p className="card text-center text-sm text-slate-500">تیکت ضمانتی برای شعبه شما ثبت نشده است.</p>
      ) : null}
      {(claims ?? []).map((claim) => (
        <section key={claim.id} className="card space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-700">
              {claim.warranty?.order?.orderNumber ?? '—'} — {claim.warranty?.policyNumber ?? ''}
            </p>
            <span className="chip bg-slate-100 text-[11px]">{CLAIM_STATUS_FA[claim.status] ?? claim.status}</span>
          </div>
          <p className="text-xs leading-6 text-slate-600">{claim.descriptionFa}</p>
          <input
            value={notes[claim.id] ?? ''}
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
                onClick={() => update(claim.id, status)}
                className={`chip text-[11px] font-bold ${
                  status === 'APPROVED' || status === 'RESOLVED'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : status === 'REJECTED'
                      ? 'bg-red-50 text-red-600 border border-red-200'
                      : 'bg-sky-50 text-sky-700 border border-sky-200'
                }`}
              >
                {CLAIM_STATUS_FA[status]}
                {busyId === claim.id ? <Loader2 size={11} className="animate-spin" /> : null}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function BranchPage() {
  const [orders, setOrders] = useState<OrdersPage | null>(null);
  const [tab, setTab] = useState<TabKey>('queue');

  const reload = useCallback(() => {
    api.orders().then(setOrders).catch(() => undefined);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <RoleGuard>
      <main className="mx-auto max-w-3xl space-y-5 px-4 pb-16 pt-6">
        <h1 className="text-xl font-extrabold text-primary-950">پنل مدیریت شعبه</h1>

        <div className="flex gap-2">
          {([
            { key: 'queue' as TabKey, labelFa: 'صف سفارش‌ها' },
            { key: 'technicians' as TabKey, labelFa: 'تکنسین‌ها' },
            { key: 'claims' as TabKey, labelFa: 'تیکت‌های ضمانت' },
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

        {tab === 'queue' ? <Tab1Queue orders={orders?.items ?? []} reload={reload} /> : null}
        {tab === 'technicians' ? <Tab2Technicians /> : null}
        {tab === 'claims' ? <Tab3Claims /> : null}
      </main>
    </RoleGuard>
  );
}
