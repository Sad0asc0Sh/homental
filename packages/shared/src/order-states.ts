import type { ServiceKey } from './types';

export const ORDER_STATES = [
  'DRAFT',
  'ESTIMATED',
  'SEARCHING_EXPERT',
  'BRANCH_QUEUE',
  'EXPERT_ASSIGNED',
  'ON_THE_WAY',
  'INSPECTING',
  'QUOTE_APPROVED',
  'IN_PROGRESS',
  'HANDOVER_OTP_PENDING',
  'COMPLETED_WARRANTY_ACTIVE',
  'CANCELLED',
] as const;

export type OrderState = (typeof ORDER_STATES)[number];

export interface OrderStateMeta {
  labelFa: string;
  className: string;
}

export const ORDER_STATE_META: Record<OrderState, OrderStateMeta> = {
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

export function getOrderStateMeta(state: string): OrderStateMeta {
  return (
    (ORDER_STATE_META as Record<string, OrderStateMeta>)[state] ?? {
      labelFa: state,
      className: 'bg-slate-100 text-slate-600',
    }
  );
}

export const SERVICE_LABELS_FA: Record<ServiceKey, string> = {
  ALARM: 'دزدگیر',
  CCTV: 'دوربین',
  PARKING_JACK: 'جک پارکینگی',
  ELECTRIC_SHUTTER: 'کرکره برقی',
};

export const WALLET_TX_TYPE_FA: Record<string, string> = {
  TOPUP: 'شارژ کیف پول',
  ESCROW_HOLD: 'وجه در امانت',
  ESCROW_RELEASE: 'آزادسازی امانت',
  REFUND: 'بازگشت وجه',
  RETURN_REFUND: 'بازگشت وجه مرجوعی',
  EXCHANGE_ADJUSTMENT: 'مابه‌التفاوت تعویض',
  ADJUSTMENT: 'اصلاح مانده',
  PLATFORM_COMMISSION: 'کمیسیون پلتفرم',
  WARRANTY_RESERVE: 'ذخیره گارانتی',
  TECHNICIAN_PAYOUT: 'تسویه نصاب',
  SELLER_PAYOUT: 'تسویه فروش',
  SELLER_APP_FEE: 'هزینه خدمات حساب فروشنده',
};
