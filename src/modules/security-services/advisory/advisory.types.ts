import type { SecurityPillar, ServiceKey } from '@prisma/client';
import type { PricingEstimateResult } from '../pricing/pricing.service';

// ── Facts document (the single contract between UI answers and rule logic) ──

export interface ServiceConfigAnswer {
  active?: boolean;
  /** Selected goal-card ids (qualitative signals). */
  goals?: string[];
  [key: string]: unknown;
}

export interface ServiceFacts {
  active: boolean;
  goals?: string[];
  [key: string]: unknown;
}

export interface AdvisoryFacts {
  locationType: string;
  building: Record<string, unknown>;
  services: Record<string, ServiceFacts>;
}

// ── Readiness ────────────────────────────────────────────────────────────────

export interface PillarWeights {
  physical: number;
  intrusion: number;
  monitoring: number;
}

export interface ReadinessScore {
  physical: number;
  intrusion: number;
  monitoring: number;
  total: number;
  levelFa: string;
}

// ── Advisories ───────────────────────────────────────────────────────────────

export interface SuggestedAction {
  type: 'APPLY_SERVICE_CONFIG';
  serviceKey: ServiceKey;
  configPatch: Record<string, unknown>;
}

export interface Advisory {
  code: string;
  pillar: SecurityPillar;
  priority: number;
  messageFa: string;
  scoreImpact: Record<string, unknown> | null;
  suggestedAction: SuggestedAction | null;
}

// ── Evaluate result ──────────────────────────────────────────────────────────

export interface SmartBrief {
  locationType: string;
  activeServiceKeys: ServiceKey[];
  coveredPillars: SecurityPillar[];
  missingPillars: SecurityPillar[];
}

export interface EvaluatePricingOptions {
  includePricing?: boolean;
  citySlug?: string;
  lat?: number;
  lng?: number;
  urgency?: string;
  supplyMode?: string;
  sliderBps?: number;
}

export interface EvaluateAdvisoryResult {
  readiness: ReadinessScore;
  advisories: Advisory[];
  smartBrief: SmartBrief;
  /** Present ONLY when the caller asked for the one-call Sticky Live Bar. */
  pricing?: PricingEstimateResult;
}
