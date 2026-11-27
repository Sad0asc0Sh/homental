'use client';

import { useState } from 'react';
import { Loader2, LogIn, ShieldAlert } from 'lucide-react';
import { AdvisoryRulesTab } from '@/components/admin/AdvisoryRulesTab';
import { CitiesBranchesTab } from '@/components/admin/CitiesBranchesTab';
import { FinanceTab } from '@/components/admin/FinanceTab';
import { PlatformConfigTab } from '@/components/admin/PlatformConfigTab';
import { AuthModal } from '@/components/auth/AuthModal';
import { useAuthStore } from '@/store/auth.store';

type AdminTab = 'finance' | 'cities-branches' | 'advisory' | 'config';

const TABS: Array<{ key: AdminTab; labelFa: string }> = [
  { key: 'finance', labelFa: 'داشبورد مالی و صندوق ۵٪ ضمانت' },
  { key: 'cities-branches', labelFa: 'توسعه شهرها و نمایندگی‌ها' },
  { key: 'advisory', labelFa: 'قوانین مشاوره هوشمند' },
  { key: 'config', labelFa: 'تنظیمات داینامیک پلتفرم' },
];

export default function SuperAdminPage() {
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [authOpen, setAuthOpen] = useState(false);
  const [tab, setTab] = useState<AdminTab>('finance');

  if (!hasHydrated) {
    return (
      <main className="mx-auto max-w-4xl px-4 pt-10">
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
          <p className="text-base font-extrabold text-slate-800">پنل مدیریت کل هومنتال</p>
          <p className="text-xs text-slate-500">
            برای دسترسی به داشبورد مالی، شهرها و تنظیمات پلتفرم با حساب ابرادمین وارد شوید.
          </p>
          <button type="button" onClick={() => setAuthOpen(true)} className="btn-primary mx-auto">
            <LogIn size={16} />
            ورود به حساب ابرادمین
          </button>
        </div>
        {authOpen ? <AuthModal onDone={() => setAuthOpen(false)} /> : null}
      </main>
    );
  }

  if (user.role !== 'SUPER_ADMIN') {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-10 text-center">
        <div className="card space-y-3">
          <ShieldAlert size={28} className="mx-auto text-red-500" />
          <p className="text-sm font-bold text-red-600">
            این پنل منحصراً برای ابرادمین سامانه (SUPER_ADMIN) فعال است.
          </p>
          <button type="button" onClick={logout} className="btn-ghost mx-auto text-xs">
            خروج و ورود با حساب ابرادمین
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 pb-16 pt-6">
      <header>
        <h1 className="text-xl font-extrabold text-primary-950">پنل مدیریت کل هومنتال</h1>
        <p className="text-xs text-slate-500">
          کنترل متمرکز مالی، ذخیره ریسک ضمانت، توسعه شهرها و قوانین هوشمند
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
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

      {tab === 'finance' ? <FinanceTab /> : null}
      {tab === 'cities-branches' ? <CitiesBranchesTab /> : null}
      {tab === 'advisory' ? <AdvisoryRulesTab /> : null}
      {tab === 'config' ? <PlatformConfigTab /> : null}
    </main>
  );
}
