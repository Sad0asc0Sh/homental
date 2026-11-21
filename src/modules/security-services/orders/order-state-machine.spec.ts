import { ConflictException } from '@nestjs/common';
import { OrderState } from '@prisma/client';
import {
  ALLOWED_TRANSITIONS,
  assertValidTransition,
  isLegalTransition,
} from './order-state-machine';

const LEGAL_TRANSITIONS: Array<[OrderState, OrderState]> = [
  ['DRAFT', 'ESTIMATED'],
  ['DRAFT', 'CANCELLED'],
  ['ESTIMATED', 'SEARCHING_EXPERT'],
  ['ESTIMATED', 'CANCELLED'],
  ['SEARCHING_EXPERT', 'EXPERT_ASSIGNED'],
  ['SEARCHING_EXPERT', 'BRANCH_QUEUE'],
  ['SEARCHING_EXPERT', 'CANCELLED'],
  ['BRANCH_QUEUE', 'EXPERT_ASSIGNED'],
  ['BRANCH_QUEUE', 'CANCELLED'],
  ['EXPERT_ASSIGNED', 'ON_THE_WAY'],
  ['EXPERT_ASSIGNED', 'BRANCH_QUEUE'],
  ['EXPERT_ASSIGNED', 'CANCELLED'],
  ['ON_THE_WAY', 'INSPECTING'],
  ['ON_THE_WAY', 'CANCELLED'],
  ['INSPECTING', 'QUOTE_APPROVED'],
  ['INSPECTING', 'CANCELLED'],
  ['QUOTE_APPROVED', 'IN_PROGRESS'],
  ['QUOTE_APPROVED', 'CANCELLED'],
  ['IN_PROGRESS', 'HANDOVER_OTP_PENDING'],
  ['HANDOVER_OTP_PENDING', 'COMPLETED_WARRANTY_ACTIVE'],
];

const ILLEGAL_TRANSITIONS: Array<[OrderState, OrderState]> = [
  ['DRAFT', 'IN_PROGRESS'],
  ['DRAFT', 'COMPLETED_WARRANTY_ACTIVE'],
  ['DRAFT', 'BRANCH_QUEUE'],
  ['ESTIMATED', 'ON_THE_WAY'],
  ['SEARCHING_EXPERT', 'INSPECTING'],
  ['IN_PROGRESS', 'CANCELLED'], // work started — cannot cancel
  ['IN_PROGRESS', 'ESTIMATED'],
  ['HANDOVER_OTP_PENDING', 'CANCELLED'],
  ['HANDOVER_OTP_PENDING', 'IN_PROGRESS'],
  ['COMPLETED_WARRANTY_ACTIVE', 'CANCELLED'],
  ['COMPLETED_WARRANTY_ACTIVE', 'ESTIMATED'],
  ['CANCELLED', 'ESTIMATED'],
  ['CANCELLED', 'IN_PROGRESS'],
  ['QUOTE_APPROVED', 'ON_THE_WAY'],
];

describe('OrderStateMachine — strict 12-state map (Invariant 8)', () => {
  it.each(LEGAL_TRANSITIONS)('allows %s → %s', (from, to) => {
    expect(isLegalTransition(from, to)).toBe(true);
    expect(() => assertValidTransition(from, to)).not.toThrow();
  });

  it.each(ILLEGAL_TRANSITIONS)('rejects %s → %s with Persian 409', (from, to) => {
    expect(isLegalTransition(from, to)).toBe(false);
    expect(() => assertValidTransition(from, to)).toThrow(ConflictException);
    try {
      assertValidTransition(from, to);
    } catch (error) {
      const body = (error as ConflictException).getResponse() as Record<string, unknown>;
      expect(body['message']).toContain('مجاز نیست');
    }
  });

  it('terminal states allow no transitions at all', () => {
    expect(ALLOWED_TRANSITIONS['COMPLETED_WARRANTY_ACTIVE']).toEqual([]);
    expect(ALLOWED_TRANSITIONS['CANCELLED']).toEqual([]);
  });

  it('covers exactly the 12 OrderState values', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual(
      Object.values(OrderState).sort(),
    );
  });
});
