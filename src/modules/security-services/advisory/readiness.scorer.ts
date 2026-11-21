import type { SecurityPillar } from '@prisma/client';
import type { LocationType } from '@prisma/client';
import { asUiSchema } from '../shared/ui-schema.types';
import type { AdvisoryFacts, PillarWeights, ReadinessScore } from './advisory.types';

export interface ScoringDefinition {
  /** ServiceKey (string so the scorer stays decoupled from Prisma enums). */
  key: string;
  pillar: SecurityPillar;
  baseReadinessScore: number;
  uiSchema: unknown;
}

/**
 * Location-specific pillar weights (product spec) — data, not code branching:
 * a SHOP values intrusion/monitoring heavily; a PARKING is mostly physical.
 */
export const LOCATION_PILLAR_WEIGHTS: Record<LocationType, PillarWeights> = {
  SHOP: { physical: 0.35, intrusion: 0.35, monitoring: 0.3 },
  VILLA: { physical: 0.3, intrusion: 0.4, monitoring: 0.3 },
  APARTMENT: { physical: 0.2, intrusion: 0.45, monitoring: 0.35 },
  PARKING: { physical: 0.5, intrusion: 0.15, monitoring: 0.35 },
  WAREHOUSE: { physical: 0.35, intrusion: 0.4, monitoring: 0.25 },
};

/** Bounded configuration-depth bonuses — purely schema-driven (no service names). */
export const SCORING = {
  /** +4 per protective switch enabled beyond its schema default. */
  switchBonus: 4,
  /** +2 per selected goal card (qualitative intent). */
  goalCardBonus: 2,
  /** Cap per active service so stacking switches can never exceed the base. */
  maxServiceBonus: 20,
} as const;

const READINESS_TIERS = [
  { minTotal: 85, levelFa: 'امنیت مهندسی کامل' },
  { minTotal: 60, levelFa: 'پوشش استاندارد' },
  { minTotal: 35, levelFa: 'پوشش پایه' },
  { minTotal: 0, levelFa: 'نیاز به تقویت فوری' },
] as const;

const PILLAR_SCORE_KEY: Record<SecurityPillar, 'physical' | 'intrusion' | 'monitoring'> = {
  PHYSICAL: 'physical',
  INTRUSION: 'intrusion',
  MONITORING: 'monitoring',
};

/** Bonus from non-default protective switches + selected goal cards (schema-driven). */
function serviceConfigBonus(uiSchema: unknown, serviceFacts: Record<string, unknown>): number {
  const schema = asUiSchema(uiSchema);
  let enabledSwitches = 0;
  for (const step of schema.steps ?? []) {
    for (const field of step.fields ?? []) {
      if (
        field.type === 'SWITCH' &&
        field.default === false &&
        typeof field.pricingVar === 'string' &&
        serviceFacts[field.pricingVar] === true
      ) {
        enabledSwitches += 1;
      }
    }
  }
  const goalCount = Array.isArray(serviceFacts['goals']) ? serviceFacts['goals'].length : 0;
  return Math.min(
    enabledSwitches * SCORING.switchBonus + goalCount * SCORING.goalCardBonus,
    SCORING.maxServiceBonus,
  );
}

function tierFor(total: number): string {
  return READINESS_TIERS.find((tier) => total >= tier.minTotal)?.levelFa ?? 'نیاز به تقویت فوری';
}

/**
 * Context-aware 3-pillar readiness (0–100): pillar = Σ(base + bounded config
 * bonus) of active services in that pillar; total = Σ pillar × location weight.
 * Applying an advisory's `suggestedConfig` or adding a service measurably
 * raises the pillar and total scores.
 */
export function computeReadinessScore(
  facts: AdvisoryFacts,
  definitions: ScoringDefinition[],
): ReadinessScore {
  const weights = LOCATION_PILLAR_WEIGHTS[facts.locationType as LocationType] ?? {
    physical: 1 / 3,
    intrusion: 1 / 3,
    monitoring: 1 / 3,
  };

  const rawPillars: Record<'physical' | 'intrusion' | 'monitoring', number> = {
    physical: 0,
    intrusion: 0,
    monitoring: 0,
  };

  for (const definition of definitions) {
    const serviceFacts = facts.services[definition.key];
    if (!serviceFacts?.active) continue;
    const bonus = serviceConfigBonus(definition.uiSchema, serviceFacts);
    const contribution = Math.min(definition.baseReadinessScore + bonus, 100);
    const pillarKey = PILLAR_SCORE_KEY[definition.pillar];
    rawPillars[pillarKey] = Math.min(rawPillars[pillarKey] + contribution, 100);
  }

  const pillarScores = {
    physical: Math.round(rawPillars.physical),
    intrusion: Math.round(rawPillars.intrusion),
    monitoring: Math.round(rawPillars.monitoring),
  };
  const total = Math.round(
    rawPillars.physical * weights.physical +
      rawPillars.intrusion * weights.intrusion +
      rawPillars.monitoring * weights.monitoring,
  );

  return { ...pillarScores, total, levelFa: tierFor(total) };
}
