import type { SecurityPillar, ServiceKey } from '@prisma/client';
import type { AdvisoryFacts, ServiceConfigAnswer, ServiceFacts } from './advisory.types';

export interface FactsDefinition {
  key: ServiceKey;
  pillar: SecurityPillar;
  pricingSchema: unknown;
}

export interface BuildFactsInput {
  locationType: string;
  buildingContext?: Record<string, unknown> | null;
  servicesConfig?: Record<string, ServiceConfigAnswer> | null;
}

/** Extracts `pricingSchema.variables` (engine defaults) from a definition. */
function extractVariables(pricingSchema: unknown): Record<string, unknown> {
  const schema = pricingSchema as { variables?: Record<string, unknown> } | null;
  return { ...(schema?.variables ?? {}) };
}

/**
 * Builds the advisory facts document. For EVERY known ServiceKey it produces
 * `services[key] = { active, ...pricingDefaults, ...userAnswers }` — the
 * pricing-schema defaults are merged UNDER the user's partial answers, so a
 * rule like `upsBackup == false` or `nightPlate == false` fires reliably even
 * when the customer never touched that optional switch (rules stay decoupled
 * from the UI, Invariant 14).
 */
export function buildAdvisoryFacts(
  input: BuildFactsInput,
  definitions: FactsDefinition[],
): AdvisoryFacts {
  const services: Record<string, ServiceFacts> = {};
  for (const definition of definitions) {
    const answer = input.servicesConfig?.[definition.key];
    const isActive = answer?.active === true;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { active: _active, goals, ...answers } = answer ?? {};
    services[definition.key] = {
      active: isActive,
      ...extractVariables(definition.pricingSchema),
      ...(goals && goals.length > 0 ? { goals } : {}),
      ...answers,
    };
  }
  return {
    locationType: input.locationType,
    building: input.buildingContext ?? {},
    services,
  };
}
