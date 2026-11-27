import type { LocationType } from '@prisma/client';

/**
 * Structural (permissive) views over the JSONB `uiSchema` documents.
 * Engines must read them data-driven — never with service-specific branching
 * (ARCHITECTURE.md Invariants 3 & 14).
 */
export interface UiSchemaFieldLike {
  id?: string;
  type?: string;
  labelFa?: string;
  default?: unknown;
  pricingVar?: string;
  locationTypes?: LocationType[];
  [key: string]: unknown;
}

export interface UiSchemaStepLike {
  id?: string;
  titleFa?: string;
  fields?: UiSchemaFieldLike[];
  [key: string]: unknown;
}

export interface GoalCardLike {
  id?: string;
  titleFa?: string;
  locationTypes?: LocationType[];
  [key: string]: unknown;
}

export interface UiSchemaLike {
  steps?: UiSchemaStepLike[];
  goalCards?: {
    titleFa?: string;
    multiSelect?: boolean;
    cards?: GoalCardLike[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function asUiSchema(value: unknown): UiSchemaLike {
  return (value ?? {}) as UiSchemaLike;
}
