'use client';

const STATE_LABELS: Record<string, { labelFa: string; className: string }> = {
  DRAFT: { labelFa: 'پیش‌نویس', className: 'bg-slate-100 text-slate-600' },
  ESTIMATED: { labelFa: 'قیمت‌گذاری‌شده', className: 'bg-sky-50 text-sky-700' },
  SEARCHING_EXPERT: { labelFa: 'در جستجوی کارشناس', className: 'bg-amber-50 text-amber-700' },
  BRANCH_QUEUE: { labelFa: 'در صف شعبه', className: 'bg-purple-50 text-purple-700' },
  EXPERT_ASSIGNED: { labelFa: 'کارشناس اختصاص یافت', className: 'bg-primary-50 text-primary-700' },
  ON_THE_WAY: { labelFa: 'کارشناس در مسیر', className: 'bg-primary-50 text-primary-700' },
  INSPECTING: { labelFa: 'بازدید و کارشناسی', className: 'bg-primary-50 text-primary-700' },
  QUOTE_APPROVED: { labelFa: 'پیش‌فاکتور تأیید شد', className: 'bg-indigo-50 text-indigo-700' },
  IN_PROGRESS: { labelFa: 'در حال اجرا', className: 'bg-indigo-50 text-indigo-700' },
  HANDOVER_OTP_PENDING: { labelFa: 'در انتظار تحویل', className: 'bg-amber-50 text-amber-700' },
  COMPLETED_WARRANTY_ACTIVE: { labelFa: 'گارانتی فعال', className: 'bg-emerald-50 text-emerald-700' },
  CANCELLED: { labelFa: 'لغو‌شده', className: 'bg-red-50 text-red-600' },
};

export function StateBadge({ state }: { state: string }) {
  const meta = STATE_LABELS[state] ?? { labelFa: state, className: 'bg-slate-100 text-slate-600' };
  return <span className={`chip text-xs font-bold ${meta.className}`}>{meta.labelFa}</span>;
}

export { STATE_LABELS };
