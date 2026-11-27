import { ConflictException } from '@nestjs/common';
import { OrderState } from '@prisma/client';

/**
 * Strict 12-state order machine (ARCHITECTURE.md Invariant 8).
 * `IN_PROGRESS` cannot be cancelled — installation work has started;
 * `HANDOVER_OTP_PENDING` must complete the full handover gate.
 */
export const ALLOWED_TRANSITIONS: Record<OrderState, OrderState[]> = {
  DRAFT: ['ESTIMATED', 'CANCELLED'],
  ESTIMATED: ['SEARCHING_EXPERT', 'CANCELLED'],
  SEARCHING_EXPERT: ['EXPERT_ASSIGNED', 'BRANCH_QUEUE', 'CANCELLED'],
  BRANCH_QUEUE: ['EXPERT_ASSIGNED', 'CANCELLED'],
  EXPERT_ASSIGNED: ['ON_THE_WAY', 'BRANCH_QUEUE', 'CANCELLED'],
  ON_THE_WAY: ['INSPECTING', 'CANCELLED'],
  INSPECTING: ['QUOTE_APPROVED', 'CANCELLED'],
  QUOTE_APPROVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['HANDOVER_OTP_PENDING'],
  HANDOVER_OTP_PENDING: ['COMPLETED_WARRANTY_ACTIVE'],
  COMPLETED_WARRANTY_ACTIVE: [],
  CANCELLED: [],
};

const STATE_FA: Record<OrderState, string> = {
  DRAFT: 'پیش‌نویس',
  ESTIMATED: 'قیمت‌گذاری‌شده',
  SEARCHING_EXPERT: 'در جستجوی تکنسین',
  EXPERT_ASSIGNED: 'تکنسین اختصاص یافت',
  ON_THE_WAY: 'تکنسین در مسیر',
  INSPECTING: 'در حال بازدید و کارشناسی',
  QUOTE_APPROVED: 'پیش‌فاکتور تأیید شد',
  IN_PROGRESS: 'در حال اجرا',
  HANDOVER_OTP_PENDING: 'در انتظار تحویل و کد تأیید',
  COMPLETED_WARRANTY_ACTIVE: 'تکمیل‌شده با گارانتی فعال',
  CANCELLED: 'لغو‌شده',
  BRANCH_QUEUE: 'در صف شعبه',
};

export function stateFa(state: OrderState): string {
  return STATE_FA[state];
}

export function isLegalTransition(from: OrderState, to: OrderState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidTransition(from: OrderState, to: OrderState): void {
  if (!isLegalTransition(from, to)) {
    throw new ConflictException({
      statusCode: 409,
      message: `گذار وضعیت سفارش از «${stateFa(from)}» به «${stateFa(to)}» مجاز نیست.`,
      metadata: { from, to },
    });
  }
}
