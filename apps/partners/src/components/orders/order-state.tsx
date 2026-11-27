'use client';

import { getOrderStateMeta, ORDER_STATE_META } from '@homental/shared';

export function StateBadge({ state }: { state: string }) {
  const meta = getOrderStateMeta(state);
  return <span className={`chip text-xs font-bold ${meta.className}`}>{meta.labelFa}</span>;
}

export const STATE_LABELS = ORDER_STATE_META as Record<string, { labelFa: string; className: string }>;
